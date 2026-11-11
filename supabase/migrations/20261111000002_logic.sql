-- DDS Team — Phase 1 business rules: attendance actions, task triggers, activity log,
-- recurring tasks, live status.

-- ---------------------------------------------------------------------------
-- Who is acting? Signed-in user, or (Phase 2) the profile the Telegram bot sets with
-- set_config('app.actor_id', '<uuid>', true).
-- ---------------------------------------------------------------------------
create or replace function public.request_actor()
returns uuid
language plpgsql
stable
set search_path = ''
as $$
declare
  v text;
begin
  if auth.uid() is not null then
    return auth.uid();
  end if;
  v := nullif(current_setting('app.actor_id', true), '');
  return v::uuid;
exception when invalid_text_representation then
  return null;
end;
$$;

-- ===========================================================================
-- Attendance
-- ===========================================================================

-- Internal: performs one clock action for a staff member. Not callable by clients directly;
-- the app uses the wrappers below and the Phase 2 bot calls this with the service role.
create or replace function public.attendance_action(
  p_staff  uuid,
  p_action text,
  p_source public.activity_source default 'app',
  p_at     timestamptz default null   -- tests only; real calls use now()
)
returns public.attendance
language plpgsql
security definer
set search_path = ''
as $$
declare
  s        public.settings;
  v_now    timestamptz := coalesce(p_at, now());
  v_local  timestamp;
  v_today  date;
  v_row    public.attendance;
  v_active boolean;
begin
  select is_active into v_active from public.profiles where id = p_staff;
  if v_active is null then
    raise exception 'Unknown user' using errcode = 'P0001';
  elsif not v_active then
    raise exception 'This account is deactivated' using errcode = 'P0001';
  end if;

  select * into s from public.settings where id;
  v_local := v_now at time zone s.timezone;
  v_today := v_local::date;

  if p_action = 'clock_in' then
    if exists (select 1 from public.attendance where staff_id = p_staff and work_date = v_today) then
      raise exception 'You have already clocked in today' using errcode = 'P0001';
    end if;
    insert into public.attendance (staff_id, work_date, clock_in_at, is_late, source_in)
    values (
      p_staff, v_today, v_now,
      extract(isodow from v_local)::int = any (s.work_days)
        and v_local::time > s.start_time + make_interval(mins => s.late_grace_min),
      p_source
    )
    returning * into v_row;

  else
    -- The open record: today's, or yesterday's if someone works past midnight.
    select * into v_row
      from public.attendance
     where staff_id = p_staff
       and clock_out_at is null
       and work_date >= v_today - 1
     order by work_date desc
     limit 1
     for update;

    if v_row.id is null then
      raise exception 'You are not clocked in' using errcode = 'P0001';
    end if;

    if p_action = 'start_lunch' then
      if v_row.lunch_start_at is not null then
        raise exception 'Lunch has already been taken today' using errcode = 'P0001';
      end if;
      update public.attendance set lunch_start_at = v_now where id = v_row.id returning * into v_row;

    elsif p_action = 'end_lunch' then
      if v_row.lunch_start_at is null then
        raise exception 'Lunch has not started' using errcode = 'P0001';
      elsif v_row.lunch_end_at is not null then
        raise exception 'Lunch has already ended' using errcode = 'P0001';
      end if;
      update public.attendance set lunch_end_at = v_now where id = v_row.id returning * into v_row;

    elsif p_action = 'clock_out' then
      if v_row.lunch_start_at is not null and v_row.lunch_end_at is null then
        raise exception 'End your lunch before clocking out' using errcode = 'P0001';
      end if;
      update public.attendance set clock_out_at = v_now, source_out = p_source
       where id = v_row.id returning * into v_row;

    else
      raise exception 'Unknown action %', p_action using errcode = '22023';
    end if;
  end if;

  perform public.touch_activity(p_staff, p_source);
  return v_row;
end;
$$;

create or replace function public.clock_in()
returns public.attendance language sql security definer set search_path = '' as
$$ select public.attendance_action(auth.uid(), 'clock_in', 'app'); $$;

create or replace function public.start_lunch()
returns public.attendance language sql security definer set search_path = '' as
$$ select public.attendance_action(auth.uid(), 'start_lunch', 'app'); $$;

create or replace function public.end_lunch()
returns public.attendance language sql security definer set search_path = '' as
$$ select public.attendance_action(auth.uid(), 'end_lunch', 'app'); $$;

create or replace function public.clock_out()
returns public.attendance language sql security definer set search_path = '' as
$$ select public.attendance_action(auth.uid(), 'clock_out', 'app'); $$;

-- ===========================================================================
-- Tasks
-- ===========================================================================

-- Next due date for a recurring task. Never returns a date in the past, so finishing a
-- late task doesn't spawn an occurrence that is already overdue. Daily tasks land on the
-- next configured work day.
create or replace function public.next_due_date(
  p_base  date,
  p_rule  public.recurrence_rule,
  p_today date default null
)
returns date
language plpgsql
stable
set search_path = ''
as $$
declare
  v_today date := coalesce(p_today, public.local_today());
  v_days  int[];
  v_base  date := coalesce(p_base, v_today);
  d       date;
  n       int := 0;
begin
  select work_days into v_days from public.settings where id;

  if p_rule = 'daily' then
    d := v_base;
    loop
      d := d + 1;
      n := n + 1;
      exit when d > v_today - 1
            and (cardinality(v_days) = 0 or extract(isodow from d)::int = any (v_days));
      exit when n > 800;
    end loop;
  elsif p_rule = 'weekly' then
    d := v_base;
    loop
      d := d + 7;
      exit when d >= v_today;
    end loop;
  elsif p_rule = 'monthly' then
    -- Add whole months to the original date so 31 Jan → 28/29 Feb → 31 Mar.
    loop
      n := n + 1;
      d := (v_base + make_interval(months => n))::date;
      exit when d >= v_today;
    end loop;
  else
    return null;
  end if;
  return d;
end;
$$;

-- BEFORE INSERT/UPDATE: column guard for staff, completed_at, last_update_at, default position.
create or replace function public.tasks_before_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and current_user in ('authenticated', 'anon') and not public.is_admin() then
    if new.project_id            is distinct from old.project_id
       or new.title              is distinct from old.title
       or new.description        is distinct from old.description
       or new.assignee_id        is distinct from old.assignee_id
       or new.priority           is distinct from old.priority
       or new.due_date           is distinct from old.due_date
       or new.recurrence         is distinct from old.recurrence
       or new.recurrence_parent_id is distinct from old.recurrence_parent_id
       or new.created_by         is distinct from old.created_by
       or new.created_at         is distinct from old.created_at then
      raise exception 'Staff can only change the status and board position of their tasks'
        using errcode = '42501';
    end if;
  end if;

  if tg_op = 'INSERT' then
    new.created_by := coalesce(new.created_by, public.request_actor());
    new.last_update_at := now();
    if new.position = 0 then
      select coalesce(max(position), 0) + 1 into new.position
        from public.tasks where status = new.status;
    end if;
    if new.status = 'done' then
      new.completed_at := coalesce(new.completed_at, now());
    else
      new.completed_at := null;
    end if;
  else
    if new.status is distinct from old.status then
      new.completed_at := case when new.status = 'done' then now() else null end;
    end if;
    if new.status is distinct from old.status
       or new.assignee_id is distinct from old.assignee_id
       or new.due_date is distinct from old.due_date then
      new.last_update_at := now();
    end if;
    -- Never let a client fake these.
    if current_user in ('authenticated', 'anon') then
      if new.status is not distinct from old.status then
        new.completed_at := old.completed_at;
      end if;
      if new.status is not distinct from old.status
         and new.assignee_id is not distinct from old.assignee_id
         and new.due_date is not distinct from old.due_date then
        new.last_update_at := old.last_update_at;
      end if;
    end if;
  end if;
  return new;
end;
$$;

create trigger tasks_before_write before insert or update on public.tasks
  for each row execute function public.tasks_before_write();

create or replace function public.profile_name(p_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select full_name from public.profiles where id = p_id;
$$;

-- Creates the next occurrence of a recurring task (idempotent per parent).
create or replace function public.spawn_next_occurrence(p_task public.tasks)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if p_task.recurrence = 'none' then
    return null;
  end if;
  if exists (select 1 from public.tasks where recurrence_parent_id = p_task.id) then
    return null;
  end if;

  insert into public.tasks (
    project_id, title, description, assignee_id, status, priority, due_date,
    recurrence, recurrence_parent_id, created_by
  ) values (
    p_task.project_id, p_task.title, p_task.description, p_task.assignee_id, 'todo',
    p_task.priority, public.next_due_date(p_task.due_date, p_task.recurrence),
    p_task.recurrence, p_task.id, p_task.created_by
  )
  returning id into v_id;

  insert into public.checklist_items (task_id, text, is_done, position)
  select v_id, text, false, position
    from public.checklist_items
   where task_id = p_task.id;

  return v_id;
end;
$$;

-- AFTER INSERT/UPDATE: activity log rows, recurring tasks, last activity.
create or replace function public.tasks_after_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor  uuid := public.request_actor();
  v_source public.activity_source := public.request_source();
  v_logged boolean := false;
begin
  if tg_op = 'INSERT' then
    insert into public.task_activity (task_id, actor_id, type, to_value, source)
    values (new.id, v_actor, 'created', new.title, v_source);
    if new.assignee_id is not null then
      insert into public.task_activity (task_id, actor_id, type, to_value, source)
      values (new.id, v_actor, 'assigned', public.profile_name(new.assignee_id), v_source);
    end if;
    if new.due_date is not null then
      insert into public.task_activity (task_id, actor_id, type, to_value, source)
      values (new.id, v_actor, 'due_changed', new.due_date::text, v_source);
    end if;
    v_logged := true;
  else
    if new.status is distinct from old.status then
      insert into public.task_activity (task_id, actor_id, type, from_value, to_value, source)
      values (new.id, v_actor, 'status_changed', old.status::text, new.status::text, v_source);
      v_logged := true;
    end if;
    if new.assignee_id is distinct from old.assignee_id then
      insert into public.task_activity (task_id, actor_id, type, from_value, to_value, source)
      values (new.id, v_actor, 'assigned',
              public.profile_name(old.assignee_id), public.profile_name(new.assignee_id), v_source);
      v_logged := true;
    end if;
    if new.due_date is distinct from old.due_date then
      insert into public.task_activity (task_id, actor_id, type, from_value, to_value, source)
      values (new.id, v_actor, 'due_changed', old.due_date::text, new.due_date::text, v_source);
      v_logged := true;
    end if;

    if new.status = 'done' and old.status <> 'done' and new.recurrence <> 'none' then
      perform public.spawn_next_occurrence(new);
    end if;
  end if;

  if v_logged and v_actor is not null then
    perform public.touch_activity(v_actor, v_source);
  end if;
  return null;
end;
$$;

create trigger tasks_after_write after insert or update on public.tasks
  for each row execute function public.tasks_after_write();

-- ===========================================================================
-- Subtasks & checklist
-- ===========================================================================

create or replace function public.task_children_before_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' and new.position = 0 then
    execute format('select coalesce(max(position), 0) + 1 from %I.%I where task_id = $1',
                   tg_table_schema, tg_table_name)
       into new.position using new.task_id;
  end if;
  if tg_op = 'UPDATE' then
    if new.task_id is distinct from old.task_id then
      raise exception 'Items cannot be moved to another task' using errcode = '42501';
    end if;
    if tg_table_name = 'subtasks'
       and current_user in ('authenticated', 'anon') and not public.is_admin()
       and (to_jsonb(new) ->> 'assignee_id') is distinct from (to_jsonb(old) ->> 'assignee_id') then
      raise exception 'Only admins can assign subtasks' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

create trigger subtasks_before_write before insert or update on public.subtasks
  for each row execute function public.task_children_before_write();
create trigger checklist_items_before_write before insert or update on public.checklist_items
  for each row execute function public.task_children_before_write();

create or replace function public.task_children_after_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := public.request_actor();
  v_label text;
begin
  if new.is_done and not old.is_done then
    v_label := case when tg_table_name = 'subtasks' then to_jsonb(new) ->> 'title'
                    else to_jsonb(new) ->> 'text' end;
    insert into public.task_activity (task_id, actor_id, type, to_value, source)
    values (new.task_id, v_actor,
            case when tg_table_name = 'subtasks' then 'subtask_done' else 'checklist_done' end
              ::public.task_activity_type,
            v_label, public.request_source());
  end if;
  return null;
end;
$$;

create trigger subtasks_after_update after update on public.subtasks
  for each row execute function public.task_children_after_update();
create trigger checklist_items_after_update after update on public.checklist_items
  for each row execute function public.task_children_after_update();

-- ===========================================================================
-- Activity log
-- ===========================================================================

-- Clients may only add notes, as themselves, timestamped now.
create or replace function public.task_activity_before_insert()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user in ('authenticated', 'anon') then
    if new.type <> 'note' then
      raise exception 'Only notes can be added directly' using errcode = '42501';
    end if;
    new.actor_id   := auth.uid();
    new.source     := public.request_source();
    new.created_at := now();
    new.from_value := null;
    new.to_value   := null;
  end if;
  new.updated_at := new.created_at;
  return new;
end;
$$;

create trigger task_activity_before_insert before insert on public.task_activity
  for each row execute function public.task_activity_before_insert();

-- Notes and ticks count as an update to the task and as activity by the person.
create or replace function public.task_activity_after_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.type in ('note', 'subtask_done', 'checklist_done', 'photo') then
    update public.tasks set last_update_at = new.created_at where id = new.task_id;
    if new.actor_id is not null then
      perform public.touch_activity(new.actor_id, new.source);
    end if;
  end if;
  return null;
end;
$$;

create trigger task_activity_after_insert after insert on public.task_activity
  for each row execute function public.task_activity_after_insert();

-- ===========================================================================
-- Read helpers for the app
-- ===========================================================================

-- Names of everyone, so staff can see who assigned or commented without seeing presence.
create or replace function public.people()
returns table (id uuid, full_name text, role public.user_role, is_active boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.full_name, p.role, p.is_active
    from public.profiles p
   where public.is_active_user()
   order by p.full_name;
$$;

-- Live presence for the admin dashboard. Phase 1: Idle after 60 minutes with no activity.
create or replace function public.live_status(p_idle_minutes int default 60)
returns table (
  staff_id              uuid,
  full_name             text,
  email                 text,
  work_mode             public.work_mode,
  status                text,
  attendance_id         uuid,
  clock_in_at           timestamptz,
  clock_out_at          timestamptz,
  lunch_start_at        timestamptz,
  lunch_end_at          timestamptz,
  is_late               boolean,
  last_activity_at      timestamptz,
  last_activity_source  public.activity_source,
  current_task_id       uuid,
  current_task_title    text,
  current_project_name  text,
  tasks_done_today      int,
  tasks_open            int
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_today date := public.local_today();
  v_tz    text := public.app_timezone();
begin
  if not public.is_admin() then
    raise exception 'Only admins can view live status' using errcode = '42501';
  end if;

  return query
  select
    p.id, p.full_name, p.email, p.work_mode,
    case
      when a.id is null or a.clock_out_at is not null then 'offline'
      when a.lunch_start_at is not null and a.lunch_end_at is null then 'on_break'
      when p.last_activity_at is null
           or p.last_activity_at < now() - make_interval(mins => p_idle_minutes) then 'idle'
      else 'online'
    end,
    a.id, a.clock_in_at, a.clock_out_at, a.lunch_start_at, a.lunch_end_at, coalesce(a.is_late, false),
    p.last_activity_at, p.last_activity_source,
    ct.id, ct.title, ct.project_name,
    (select count(*)::int from public.tasks t
      where t.assignee_id = p.id and t.status = 'done'
        and (t.completed_at at time zone v_tz)::date = v_today),
    (select count(*)::int from public.tasks t
      where t.assignee_id = p.id and t.status <> 'done')
  from public.profiles p
  left join lateral (
    select att.* from public.attendance att
     where att.staff_id = p.id
       and (att.work_date = v_today or (att.work_date = v_today - 1 and att.clock_out_at is null))
     order by att.work_date desc
     limit 1
  ) a on true
  left join lateral (
    select t.id, t.title, pr.name as project_name
      from public.tasks t
      join public.projects pr on pr.id = t.project_id
     where t.assignee_id = p.id and t.status = 'in_progress'
     order by t.last_update_at desc
     limit 1
  ) ct on true
  where p.is_active and (p.role = 'staff' or a.id is not null)
  order by p.full_name;
end;
$$;
