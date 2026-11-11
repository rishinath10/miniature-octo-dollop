-- DDS Team — Phase 1 core schema
-- All timestamps are stored as timestamptz (UTC). Business-day logic uses settings.timezone
-- (Asia/Kuala_Lumpur).

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
create type public.user_role as enum ('super_admin', 'admin', 'staff');
create type public.work_mode as enum ('office', 'wfh');
create type public.activity_source as enum ('app', 'telegram');
create type public.project_status as enum ('active', 'on_hold', 'completed', 'archived');
create type public.task_status as enum ('todo', 'in_progress', 'waiting_client', 'review', 'done');
create type public.task_priority as enum ('low', 'normal', 'high', 'urgent');
create type public.recurrence_rule as enum ('none', 'daily', 'weekly', 'monthly');
create type public.task_activity_type as enum (
  'created', 'status_changed', 'assigned', 'due_changed', 'note',
  'subtask_done', 'checklist_done', 'photo'
);

-- ---------------------------------------------------------------------------
-- Generic helpers
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- Where a change came from. The app never sets it (defaults to 'app'); the Phase 2 Telegram
-- Edge Function calls set_config('app.source', 'telegram', true) inside its transaction.
create or replace function public.request_source()
returns public.activity_source
language sql
stable
set search_path = ''
as $$
  select case when current_setting('app.source', true) = 'telegram'
              then 'telegram'::public.activity_source
              else 'app'::public.activity_source end;
$$;

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------
create table public.profiles (
  id                    uuid primary key references auth.users (id) on delete cascade,
  full_name             text not null default '',
  email                 text not null,
  role                  public.user_role not null default 'staff',
  work_mode             public.work_mode not null default 'office',
  is_active             boolean not null default true,
  telegram_chat_id      bigint unique,           -- Phase 2
  telegram_link_code    text unique,             -- Phase 2
  last_activity_at      timestamptz,
  last_activity_source  public.activity_source,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create trigger profiles_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- settings (single row)
-- ---------------------------------------------------------------------------
create table public.settings (
  id                     boolean primary key default true check (id),
  timezone               text not null default 'Asia/Kuala_Lumpur',
  work_days              int[] not null default '{1,2,3,4,5}',   -- ISO: 1 = Monday … 7 = Sunday
  start_time             time not null default '09:00',
  end_time               time not null default '17:00',
  late_grace_min         int not null default 5 check (late_grace_min between 0 and 240),
  lunch_start            time,                                   -- nullable until Rishi sets it
  lunch_end              time,
  pings_enabled          boolean not null default false,         -- Phase 2
  pings_per_day          int not null default 3 check (pings_per_day between 0 and 50),
  ping_reply_min         int not null default 10 check (ping_reply_min > 0),
  ping_backup_after_min  int not null default 5 check (ping_backup_after_min > 0),
  stale_task_days        int not null default 2 check (stale_task_days > 0),
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  constraint settings_work_days_valid check (work_days <@ '{1,2,3,4,5,6,7}'::int[]),
  constraint settings_hours_valid check (end_time > start_time),
  constraint settings_lunch_valid check (
    (lunch_start is null and lunch_end is null)
    or (lunch_start is not null and lunch_end is not null and lunch_end > lunch_start)
  )
);

create or replace function public.validate_settings()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (select 1 from pg_catalog.pg_timezone_names where name = new.timezone) then
    raise exception 'Unknown timezone: %', new.timezone using errcode = '22023';
  end if;
  return new;
end;
$$;

create trigger settings_validate before insert or update on public.settings
  for each row execute function public.validate_settings();

create trigger settings_updated_at before update on public.settings
  for each row execute function public.set_updated_at();

insert into public.settings (id) values (true);

-- Settings readers used inside other functions.
create or replace function public.app_timezone()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select timezone from public.settings where id), 'Asia/Kuala_Lumpur');
$$;

create or replace function public.local_today()
returns date
language sql
stable
set search_path = ''
as $$
  select (now() at time zone public.app_timezone())::date;
$$;

-- ---------------------------------------------------------------------------
-- Role helpers (security definer so they can be used inside RLS without recursion)
-- A deactivated user has no role at all, so every policy denies them.
-- ---------------------------------------------------------------------------
create or replace function public.current_app_role()
returns public.user_role
language sql
stable
security definer
set search_path = ''
as $$
  select role from public.profiles where id = auth.uid() and is_active;
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(public.current_app_role() in ('admin', 'super_admin'), false);
$$;

create or replace function public.is_super_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(public.current_app_role() = 'super_admin', false);
$$;

create or replace function public.is_active_user()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.current_app_role() is not null;
$$;

-- Records "this person did something just now" for live presence.
create or replace function public.touch_activity(p_staff uuid, p_source public.activity_source default null)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.profiles
     set last_activity_at = now(),
         last_activity_source = coalesce(p_source, public.request_source())
   where id = p_staff;
$$;

-- ---------------------------------------------------------------------------
-- New auth user -> profile.
-- Role comes from app_metadata, which only the service role (Edge Function) can set.
-- user_metadata is user-controlled, so it is only used for the display name.
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role public.user_role := 'staff';
  v_mode public.work_mode := 'office';
begin
  if new.raw_app_meta_data ? 'role'
     and new.raw_app_meta_data ->> 'role' in ('super_admin', 'admin', 'staff') then
    v_role := (new.raw_app_meta_data ->> 'role')::public.user_role;
  end if;
  if new.raw_app_meta_data ->> 'work_mode' in ('office', 'wfh') then
    v_mode := (new.raw_app_meta_data ->> 'work_mode')::public.work_mode;
  end if;

  insert into public.profiles (id, email, full_name, role, work_mode)
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(nullif(new.raw_user_meta_data ->> 'full_name', ''), split_part(coalesce(new.email, ''), '@', 1)),
    v_role,
    v_mode
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- GoTrue's admin createUser inserts the row first and writes app_metadata afterwards, so
-- role / work_mode are also synced whenever those app_metadata keys change. app_metadata can
-- only be written with the service role, so it is trusted.
create or replace function public.handle_user_app_metadata_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (new.raw_app_meta_data ->> 'role') is distinct from (old.raw_app_meta_data ->> 'role')
     and new.raw_app_meta_data ->> 'role' in ('super_admin', 'admin', 'staff') then
    update public.profiles
       set role = (new.raw_app_meta_data ->> 'role')::public.user_role
     where id = new.id;
  end if;
  if (new.raw_app_meta_data ->> 'work_mode') is distinct from (old.raw_app_meta_data ->> 'work_mode')
     and new.raw_app_meta_data ->> 'work_mode' in ('office', 'wfh') then
    update public.profiles
       set work_mode = (new.raw_app_meta_data ->> 'work_mode')::public.work_mode
     where id = new.id;
  end if;
  return new;
end;
$$;

create trigger on_auth_user_app_metadata_changed
  after update of raw_app_meta_data on auth.users
  for each row execute function public.handle_user_app_metadata_change();

-- Keep profiles.email in sync if the auth email changes.
create or replace function public.handle_user_email_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.email is distinct from old.email then
    update public.profiles set email = coalesce(new.email, '') where id = new.id;
  end if;
  return new;
end;
$$;

create trigger on_auth_user_email_changed
  after update of email on auth.users
  for each row execute function public.handle_user_email_change();

-- Guard: signed-in users may only change their own full_name, unless they are super_admin.
-- Security-definer functions (clock actions, triggers) run as the table owner and skip this.
create or replace function public.guard_profile_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user in ('authenticated', 'anon') and not public.is_super_admin() then
    if new.id                   is distinct from old.id
       or new.email             is distinct from old.email
       or new.role              is distinct from old.role
       or new.work_mode         is distinct from old.work_mode
       or new.is_active         is distinct from old.is_active
       or new.telegram_chat_id  is distinct from old.telegram_chat_id
       or new.telegram_link_code is distinct from old.telegram_link_code
       or new.last_activity_at  is distinct from old.last_activity_at
       or new.last_activity_source is distinct from old.last_activity_source
       or new.created_at        is distinct from old.created_at then
      raise exception 'You can only change your own name'
        using errcode = '42501';
    end if;
  end if;

  -- Never leave the system without an active super admin.
  if old.role = 'super_admin' and old.is_active
     and (new.role <> 'super_admin' or not new.is_active)
     and not exists (
       select 1 from public.profiles
        where role = 'super_admin' and is_active and id <> old.id
     ) then
    raise exception 'There must always be at least one active super admin'
      using errcode = 'P0001';
  end if;

  return new;
end;
$$;

create trigger profiles_guard before update on public.profiles
  for each row execute function public.guard_profile_update();

-- ---------------------------------------------------------------------------
-- attendance
-- ---------------------------------------------------------------------------
create table public.attendance (
  id              uuid primary key default gen_random_uuid(),
  staff_id        uuid not null references public.profiles (id) on delete cascade,
  work_date       date not null,
  clock_in_at     timestamptz not null default now(),
  clock_out_at    timestamptz,
  lunch_start_at  timestamptz,
  lunch_end_at    timestamptz,
  is_late         boolean not null default false,
  source_in       public.activity_source not null default 'app',
  source_out      public.activity_source,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint attendance_one_per_day unique (staff_id, work_date),
  constraint attendance_lunch_order check (
    lunch_end_at is null or (lunch_start_at is not null and lunch_end_at >= lunch_start_at)
  ),
  constraint attendance_lunch_after_in check (lunch_start_at is null or lunch_start_at >= clock_in_at),
  constraint attendance_out_after_in check (clock_out_at is null or clock_out_at >= clock_in_at),
  constraint attendance_out_after_lunch check (
    clock_out_at is null or lunch_start_at is null or lunch_end_at is not null
  )
);

create index attendance_work_date_idx on public.attendance (work_date);

create trigger attendance_updated_at before update on public.attendance
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- projects
-- ---------------------------------------------------------------------------
create table public.projects (
  id           uuid primary key default gen_random_uuid(),
  name         text not null check (length(trim(name)) > 0),
  description  text not null default '',
  owner_id     uuid references public.profiles (id) on delete set null,
  status       public.project_status not null default 'active',
  color        text not null default '#C8973F' check (color ~ '^#[0-9A-Fa-f]{6}$'),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create trigger projects_updated_at before update on public.projects
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- tasks
-- ---------------------------------------------------------------------------
create table public.tasks (
  id                    uuid primary key default gen_random_uuid(),
  project_id            uuid not null references public.projects (id) on delete cascade,
  title                 text not null check (length(trim(title)) > 0),
  description           text not null default '',
  assignee_id           uuid references public.profiles (id) on delete set null,
  status                public.task_status not null default 'todo',
  priority              public.task_priority not null default 'normal',
  due_date              date,
  position              double precision not null default 0,
  recurrence            public.recurrence_rule not null default 'none',
  recurrence_parent_id  uuid references public.tasks (id) on delete set null,
  completed_at          timestamptz,
  last_update_at        timestamptz not null default now(),
  created_by            uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create index tasks_project_idx on public.tasks (project_id);
create index tasks_assignee_idx on public.tasks (assignee_id);
create index tasks_status_position_idx on public.tasks (status, position);
create index tasks_due_idx on public.tasks (due_date);
create unique index tasks_one_next_occurrence on public.tasks (recurrence_parent_id)
  where recurrence_parent_id is not null;

create trigger tasks_updated_at before update on public.tasks
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- subtasks & checklist items
-- ---------------------------------------------------------------------------
create table public.subtasks (
  id           uuid primary key default gen_random_uuid(),
  task_id      uuid not null references public.tasks (id) on delete cascade,
  title        text not null check (length(trim(title)) > 0),
  is_done      boolean not null default false,
  position     double precision not null default 0,
  assignee_id  uuid references public.profiles (id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index subtasks_task_idx on public.subtasks (task_id);
create trigger subtasks_updated_at before update on public.subtasks
  for each row execute function public.set_updated_at();

create table public.checklist_items (
  id          uuid primary key default gen_random_uuid(),
  task_id     uuid not null references public.tasks (id) on delete cascade,
  text        text not null check (length(trim(text)) > 0),
  is_done     boolean not null default false,
  position    double precision not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index checklist_items_task_idx on public.checklist_items (task_id);
create trigger checklist_items_updated_at before update on public.checklist_items
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- task_activity (append-only)
-- ---------------------------------------------------------------------------
create table public.task_activity (
  id          uuid primary key default gen_random_uuid(),
  task_id     uuid not null references public.tasks (id) on delete cascade,
  actor_id    uuid references public.profiles (id) on delete set null default auth.uid(),
  type        public.task_activity_type not null,
  from_value  text,
  to_value    text,
  note        text,
  source      public.activity_source not null default 'app',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint task_activity_note_has_text check (type <> 'note' or length(trim(coalesce(note, ''))) > 0)
);
create index task_activity_task_idx on public.task_activity (task_id, created_at);

create or replace function public.task_activity_append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'task_activity is append-only' using errcode = '42501';
end;
$$;

create trigger task_activity_no_update before update on public.task_activity
  for each row execute function public.task_activity_append_only();
-- Deletes are still allowed via ON DELETE CASCADE when a task is deleted (that runs as the
-- owner, not through RLS); direct deletes are blocked by RLS + revoked privileges below.
