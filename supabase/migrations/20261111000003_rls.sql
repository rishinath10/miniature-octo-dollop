-- DDS Team — Row Level Security, privileges and Realtime.

-- ---------------------------------------------------------------------------
-- Visibility helpers
-- ---------------------------------------------------------------------------
create or replace function public.can_see_task(p_task uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_admin()
      or (public.is_active_user()
          and exists (select 1 from public.tasks t where t.id = p_task and t.assignee_id = auth.uid()));
$$;

create or replace function public.can_see_project(p_project uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_admin()
      or (public.is_active_user()
          and exists (select 1 from public.tasks t
                       where t.project_id = p_project and t.assignee_id = auth.uid()));
$$;

-- ---------------------------------------------------------------------------
-- Enable RLS everywhere
-- ---------------------------------------------------------------------------
alter table public.profiles        enable row level security;
alter table public.settings        enable row level security;
alter table public.attendance      enable row level security;
alter table public.projects        enable row level security;
alter table public.tasks           enable row level security;
alter table public.subtasks        enable row level security;
alter table public.checklist_items enable row level security;
alter table public.task_activity   enable row level security;

-- ---------------------------------------------------------------------------
-- Privileges: anon gets nothing. Clients never write attendance directly (RPCs only)
-- and never change or delete activity rows.
-- ---------------------------------------------------------------------------
revoke all on all tables in schema public from anon;
revoke insert, update, delete on public.attendance from authenticated;
revoke insert, delete on public.profiles from authenticated;
revoke insert, delete on public.settings from authenticated;
revoke update, delete on public.task_activity from authenticated;

-- Internal functions: not callable from the API.
revoke execute on function public.attendance_action(uuid, text, public.activity_source, timestamptz) from public, anon, authenticated;
revoke execute on function public.touch_activity(uuid, public.activity_source) from public, anon, authenticated;
revoke execute on function public.spawn_next_occurrence(public.tasks) from public, anon, authenticated;
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.handle_user_email_change() from public, anon, authenticated;
revoke execute on function public.handle_user_app_metadata_change() from public, anon, authenticated;

-- Client-facing functions: signed-in users only.
revoke execute on function public.clock_in()  from public, anon;
revoke execute on function public.start_lunch() from public, anon;
revoke execute on function public.end_lunch() from public, anon;
revoke execute on function public.clock_out() from public, anon;
revoke execute on function public.people() from public, anon;
revoke execute on function public.live_status(int) from public, anon;
grant execute on function public.clock_in(), public.start_lunch(), public.end_lunch(),
  public.clock_out(), public.people(), public.live_status(int) to authenticated;

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------
create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_admin());

-- Own name only (column guard in trigger); super admin may edit anyone.
create policy profiles_update on public.profiles for update to authenticated
  using ((id = auth.uid() and public.is_active_user()) or public.is_super_admin())
  with check ((id = auth.uid() and public.is_active_user()) or public.is_super_admin());

-- ---------------------------------------------------------------------------
-- settings
-- ---------------------------------------------------------------------------
create policy settings_select on public.settings for select to authenticated
  using (public.is_active_user());

create policy settings_update on public.settings for update to authenticated
  using (public.is_super_admin())
  with check (public.is_super_admin());

-- ---------------------------------------------------------------------------
-- attendance (writes go through clock_in / start_lunch / end_lunch / clock_out)
-- ---------------------------------------------------------------------------
create policy attendance_select on public.attendance for select to authenticated
  using ((staff_id = auth.uid() and public.is_active_user()) or public.is_admin());

-- ---------------------------------------------------------------------------
-- projects
-- ---------------------------------------------------------------------------
create policy projects_select on public.projects for select to authenticated
  using (public.can_see_project(id));

create policy projects_insert on public.projects for insert to authenticated
  with check (public.is_admin());

create policy projects_update on public.projects for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy projects_delete on public.projects for delete to authenticated
  using (public.is_admin());

-- ---------------------------------------------------------------------------
-- tasks
-- ---------------------------------------------------------------------------
create policy tasks_select on public.tasks for select to authenticated
  using (public.is_admin() or (assignee_id = auth.uid() and public.is_active_user()));

create policy tasks_insert on public.tasks for insert to authenticated
  with check (public.is_admin());

-- Staff: own tasks, status/position only (enforced by tasks_before_write).
create policy tasks_update on public.tasks for update to authenticated
  using (public.is_admin() or (assignee_id = auth.uid() and public.is_active_user()))
  with check (public.is_admin() or (assignee_id = auth.uid() and public.is_active_user()));

create policy tasks_delete on public.tasks for delete to authenticated
  using (public.is_admin());

-- ---------------------------------------------------------------------------
-- subtasks & checklist items: anyone who can see the task can add and tick items;
-- only admins delete.
-- ---------------------------------------------------------------------------
create policy subtasks_select on public.subtasks for select to authenticated
  using (public.can_see_task(task_id));
create policy subtasks_insert on public.subtasks for insert to authenticated
  with check (public.can_see_task(task_id) and (assignee_id is null or public.is_admin()));
create policy subtasks_update on public.subtasks for update to authenticated
  using (public.can_see_task(task_id)) with check (public.can_see_task(task_id));
create policy subtasks_delete on public.subtasks for delete to authenticated
  using (public.is_admin());

create policy checklist_select on public.checklist_items for select to authenticated
  using (public.can_see_task(task_id));
create policy checklist_insert on public.checklist_items for insert to authenticated
  with check (public.can_see_task(task_id));
create policy checklist_update on public.checklist_items for update to authenticated
  using (public.can_see_task(task_id)) with check (public.can_see_task(task_id));
create policy checklist_delete on public.checklist_items for delete to authenticated
  using (public.is_admin());

-- ---------------------------------------------------------------------------
-- task_activity: read with the task; clients insert notes only.
-- ---------------------------------------------------------------------------
create policy task_activity_select on public.task_activity for select to authenticated
  using (public.can_see_task(task_id));

create policy task_activity_insert on public.task_activity for insert to authenticated
  with check (type = 'note' and public.can_see_task(task_id));

-- ---------------------------------------------------------------------------
-- Realtime
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
end;
$$;

alter publication supabase_realtime add table
  public.profiles, public.attendance, public.tasks, public.task_activity,
  public.subtasks, public.checklist_items;

-- Send full old rows on update/delete so the board can react to moves and deletes.
alter table public.tasks replica identity full;
