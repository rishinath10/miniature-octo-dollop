-- Phase 1 database tests: roles, RLS, attendance rules, activity log, recurring tasks.
-- Run with:  supabase test db
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select no_plan();

-- ---------------------------------------------------------------------------
-- Fixtures: four users. Role comes from app_metadata; user_metadata must be ignored.
-- ---------------------------------------------------------------------------
insert into auth.users (id, email, aud, role, raw_app_meta_data, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000000a1', 'rishi@test.local', 'authenticated', 'authenticated',
   '{"role":"super_admin"}', '{"full_name":"Rishi"}'),
  ('00000000-0000-0000-0000-0000000000a2', 'md@test.local', 'authenticated', 'authenticated',
   '{"role":"admin"}', '{"full_name":"Managing Director"}'),
  ('00000000-0000-0000-0000-0000000000b1', 'staff1@test.local', 'authenticated', 'authenticated',
   '{"work_mode":"wfh"}', '{"full_name":"Staff One","role":"super_admin"}'),
  ('00000000-0000-0000-0000-0000000000b2', 'staff2@test.local', 'authenticated', 'authenticated',
   '{}', '{"full_name":"Staff Two"}');

select is((select role::text from profiles where email = 'rishi@test.local'), 'super_admin', 'super admin role from app_metadata');
select is((select role::text from profiles where email = 'md@test.local'), 'admin', 'admin role from app_metadata');
select is((select role::text from profiles where email = 'staff1@test.local'), 'staff', 'user_metadata cannot grant a role');
select is((select work_mode::text from profiles where email = 'staff1@test.local'), 'wfh', 'work mode from app_metadata');
select is((select full_name from profiles where email = 'staff1@test.local'), 'Staff One', 'name from user_metadata');

-- GoTrue writes app_metadata after the insert; the profile must follow.
insert into auth.users (id, email, aud, role, raw_app_meta_data) values
  ('00000000-0000-0000-0000-0000000000c1', 'late@test.local', 'authenticated', 'authenticated', '{"provider":"email"}');
update auth.users set raw_app_meta_data = raw_app_meta_data || '{"role":"admin","work_mode":"wfh"}'
 where id = '00000000-0000-0000-0000-0000000000c1';
select is((select role::text || '/' || work_mode::text from profiles where id = '00000000-0000-0000-0000-0000000000c1'),
  'admin/wfh', 'role and work mode follow app_metadata written after insert');
delete from auth.users where id = '00000000-0000-0000-0000-0000000000c1';

-- Fixed settings for deterministic tests.
update settings set start_time = '09:00', end_time = '17:00', late_grace_min = 5,
  work_days = '{1,2,3,4,5}', timezone = 'Asia/Kuala_Lumpur';

-- ---------------------------------------------------------------------------
-- Attendance rules (internal function, fixed timestamps). 2026-11-11 is a Wednesday.
-- ---------------------------------------------------------------------------
select is((attendance_action('00000000-0000-0000-0000-0000000000b1', 'clock_in', 'app',
           '2026-11-11 08:55+08')).is_late, false, 'clock-in before start is on time');
select throws_ok($$ select attendance_action('00000000-0000-0000-0000-0000000000b1', 'clock_in', 'app', '2026-11-11 09:30+08') $$,
  'P0001', 'You have already clocked in today', 'cannot clock in twice in one day');
select throws_ok($$ select attendance_action('00000000-0000-0000-0000-0000000000b1', 'end_lunch', 'app', '2026-11-11 12:00+08') $$,
  'P0001', 'Lunch has not started', 'cannot end lunch before starting it');
select lives_ok($$ select attendance_action('00000000-0000-0000-0000-0000000000b1', 'start_lunch', 'app', '2026-11-11 13:00+08') $$,
  'can start lunch');
select throws_ok($$ select attendance_action('00000000-0000-0000-0000-0000000000b1', 'start_lunch', 'app', '2026-11-11 13:05+08') $$,
  'P0001', 'Lunch has already been taken today', 'cannot start lunch twice');
select throws_ok($$ select attendance_action('00000000-0000-0000-0000-0000000000b1', 'clock_out', 'app', '2026-11-11 13:30+08') $$,
  'P0001', 'End your lunch before clocking out', 'cannot clock out during lunch');
select lives_ok($$ select attendance_action('00000000-0000-0000-0000-0000000000b1', 'end_lunch', 'app', '2026-11-11 14:00+08') $$,
  'can end lunch');
select lives_ok($$ select attendance_action('00000000-0000-0000-0000-0000000000b1', 'clock_out', 'app', '2026-11-11 17:01+08') $$,
  'can clock out');
select throws_ok($$ select attendance_action('00000000-0000-0000-0000-0000000000b1', 'clock_out', 'app', '2026-11-11 17:05+08') $$,
  'P0001', 'You are not clocked in', 'cannot clock out twice');
select throws_ok($$ select attendance_action('00000000-0000-0000-0000-0000000000b2', 'clock_out', 'app', '2026-11-11 17:05+08') $$,
  'P0001', 'You are not clocked in', 'cannot clock out without clocking in');

select is((attendance_action('00000000-0000-0000-0000-0000000000b2', 'clock_in', 'app',
           '2026-11-11 09:05+08')).is_late, false, 'clock-in exactly at the grace limit is on time');
select is((attendance_action('00000000-0000-0000-0000-0000000000b2', 'clock_in', 'app',
           '2026-11-12 09:05:01+08')).is_late, true, 'clock-in after the grace limit is late (Malaysia time)');
select is((attendance_action('00000000-0000-0000-0000-0000000000b2', 'clock_in', 'app',
           '2026-11-14 11:00+08')).is_late, false, 'Saturday (not a work day) is never late');
-- 00:30 MYT on the 13th is still the 12th in UTC; work_date must follow Malaysia time.
select is((attendance_action('00000000-0000-0000-0000-0000000000a2', 'clock_in', 'app',
           '2026-11-13 00:30+08')).work_date, '2026-11-13'::date, 'work_date uses Malaysia date, not UTC');
select ok((select last_activity_at is not null from profiles where id = '00000000-0000-0000-0000-0000000000b1'),
  'clock events update last_activity_at');

-- ---------------------------------------------------------------------------
-- Projects and tasks as admin
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a2","role":"authenticated"}', true);

select lives_ok($$
  insert into projects (id, name) values
    ('10000000-0000-0000-0000-000000000001', 'Vessel inspection reports'),
    ('10000000-0000-0000-0000-000000000002', 'Supplier invoices')
$$, 'admin can create projects');

select lives_ok($$
  insert into tasks (id, project_id, title, assignee_id, due_date) values
    ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'Draft report', '00000000-0000-0000-0000-0000000000b1', '2026-11-20'),
    ('20000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000002', 'Chase invoices', '00000000-0000-0000-0000-0000000000b2', null)
$$, 'admin can create and assign tasks');

select is((select count(*)::int from task_activity where task_id = '20000000-0000-0000-0000-000000000001'),
  3, 'task creation logs created + assigned + due');
select is((select actor_id from task_activity where task_id = '20000000-0000-0000-0000-000000000001' and type = 'created'),
  '00000000-0000-0000-0000-0000000000a2'::uuid, 'activity actor is the admin');
select is((select created_by from tasks where id = '20000000-0000-0000-0000-000000000001'),
  '00000000-0000-0000-0000-0000000000a2'::uuid, 'created_by defaults to the caller');

select lives_ok($$ insert into subtasks (task_id, title) values ('20000000-0000-0000-0000-000000000002', 'Call supplier A') $$, 'admin adds subtask');
select lives_ok($$ insert into checklist_items (task_id, text) values ('20000000-0000-0000-0000-000000000001', 'Attach photos') $$, 'admin adds checklist item');

-- Admin cannot change settings or roles.
update settings set late_grace_min = 30;
update profiles set role = 'admin' where id = '00000000-0000-0000-0000-0000000000b1';
select ok(true, 'admin attempted settings + role change');
select isnt_empty($$ select live_status() $$, 'admin can read live status');
select is((select status from live_status() where staff_id = '00000000-0000-0000-0000-0000000000b1'),
  'offline', 'staff who clocked out shows offline');

reset role;
select is((select late_grace_min from settings), 5, 'admin cannot change settings');
select is((select role::text from profiles where id = '00000000-0000-0000-0000-0000000000b1'), 'staff', 'admin cannot change roles');

-- ---------------------------------------------------------------------------
-- RLS as staff1
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000b1","role":"authenticated"}', true);

select is((select count(*)::int from profiles), 1, 'staff sees only own profile');
select is((select count(*)::int from attendance), 1, 'staff sees only own attendance');
select is((select count(*)::int from tasks), 1, 'staff sees only tasks assigned to them');
select is((select count(*)::int from projects), 1, 'staff sees only projects of their tasks');
select is((select count(*)::int from subtasks), 0, 'staff cannot see subtasks of others'' tasks');
select is((select count(*)::int from task_activity where task_id = '20000000-0000-0000-0000-000000000002'),
  0, 'staff cannot see activity of others'' tasks');
select ok((select count(*) from people()) >= 4, 'staff can read the name directory');

select throws_ok($$ select * from live_status() $$, '42501', 'Only admins can view live status', 'staff cannot read live status');
select throws_ok($$ insert into attendance (staff_id, work_date) values ('00000000-0000-0000-0000-0000000000b1', '2026-12-01') $$,
  '42501', null, 'staff cannot insert attendance directly');
select throws_ok($$ select attendance_action('00000000-0000-0000-0000-0000000000b2', 'clock_in') $$,
  '42501', null, 'staff cannot call the internal attendance function');
select throws_ok($$ update profiles set role = 'super_admin' where id = '00000000-0000-0000-0000-0000000000b1' $$,
  '42501', 'You can only change your own name', 'staff cannot change own role');
select lives_ok($$ update profiles set full_name = 'Staff Uno' where id = '00000000-0000-0000-0000-0000000000b1' $$,
  'staff can change own name');

update settings set late_grace_min = 60;

select lives_ok($$ update tasks set status = 'in_progress', position = 5 where id = '20000000-0000-0000-0000-000000000001' $$,
  'staff can change status and position of own task');
select throws_ok($$ update tasks set title = 'hacked' where id = '20000000-0000-0000-0000-000000000001' $$,
  '42501', 'Staff can only change the status and board position of their tasks', 'staff cannot edit task fields');
select throws_ok($$ update tasks set assignee_id = '00000000-0000-0000-0000-0000000000b2' where id = '20000000-0000-0000-0000-000000000001' $$,
  '42501', null, 'staff cannot reassign a task');
update tasks set status = 'done' where id = '20000000-0000-0000-0000-000000000002';
select throws_ok($$ insert into tasks (project_id, title) values ('10000000-0000-0000-0000-000000000001', 'x') $$,
  '42501', null, 'staff cannot create tasks');

select lives_ok($$ insert into task_activity (task_id, type, note) values ('20000000-0000-0000-0000-000000000001', 'note', 'Started drafting') $$,
  'staff can add a note to own task');
select throws_ok($$ insert into task_activity (task_id, type, note) values ('20000000-0000-0000-0000-000000000002', 'note', 'x') $$,
  '42501', null, 'staff cannot add a note to others'' tasks');
select throws_ok($$ insert into task_activity (task_id, type, to_value) values ('20000000-0000-0000-0000-000000000001', 'status_changed', 'done') $$,
  '42501', null, 'staff cannot forge activity entries');
select throws_ok($$ update task_activity set note = 'edited' where task_id = '20000000-0000-0000-0000-000000000001' $$,
  '42501', null, 'activity cannot be edited');
select throws_ok($$ delete from task_activity where task_id = '20000000-0000-0000-0000-000000000001' $$,
  '42501', null, 'activity cannot be deleted');

select lives_ok($$ update checklist_items set is_done = true where task_id = '20000000-0000-0000-0000-000000000001' $$,
  'staff can tick checklist items');
select lives_ok($$ insert into subtasks (task_id, title) values ('20000000-0000-0000-0000-000000000001', 'Collect photos') $$,
  'staff can add subtasks to own task');

reset role;
select is((select late_grace_min from settings), 5, 'staff cannot change settings');
select is((select status::text from tasks where id = '20000000-0000-0000-0000-000000000002'), 'todo', 'staff cannot change others'' tasks');
select is((select title from tasks where id = '20000000-0000-0000-0000-000000000001'), 'Draft report', 'task title unchanged');
select is(
  (select array_agg(type::text order by created_at, type::text) from task_activity
    where task_id = '20000000-0000-0000-0000-000000000001' and actor_id = '00000000-0000-0000-0000-0000000000b1'),
  array['checklist_done', 'note', 'status_changed'],
  'status change, note and tick are logged with the staff member as actor');
select is((select to_value from task_activity where task_id = '20000000-0000-0000-0000-000000000001' and type = 'status_changed'),
  'in_progress', 'status change records the new value');
select is((select last_activity_source::text from profiles where id = '00000000-0000-0000-0000-0000000000b1'), 'app',
  'task actions update last activity source');

-- ---------------------------------------------------------------------------
-- Recurring tasks
-- ---------------------------------------------------------------------------
select is(next_due_date('2026-11-13', 'daily', '2026-11-13'), '2026-11-16'::date, 'daily after Friday skips the weekend');
select is(next_due_date('2026-11-11', 'daily', '2026-11-11'), '2026-11-12'::date, 'daily → next day');
select is(next_due_date('2026-11-11', 'weekly', '2026-11-11'), '2026-11-18'::date, 'weekly → +7 days');
select is(next_due_date('2026-10-01', 'weekly', '2026-11-11'), '2026-11-12'::date, 'late weekly task skips past dates');
select is(next_due_date('2026-01-31', 'monthly', '2026-01-31'), '2026-02-28'::date, 'monthly clamps to end of month');
select is(next_due_date('2026-01-31', 'monthly', '2026-03-01'), '2026-03-31'::date, 'monthly keeps day-of-month');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a2","role":"authenticated"}', true);
insert into tasks (id, project_id, title, assignee_id, due_date, recurrence, priority)
values ('20000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000001',
        'Weekly vessel log', '00000000-0000-0000-0000-0000000000b1', local_today(), 'weekly', 'high');
insert into checklist_items (task_id, text, is_done) values
  ('20000000-0000-0000-0000-000000000003', 'Check log A', true),
  ('20000000-0000-0000-0000-000000000003', 'Check log B', false);

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000b1","role":"authenticated"}', true);
update tasks set status = 'done' where id = '20000000-0000-0000-0000-000000000003';
select is((select count(*)::int from tasks where recurrence_parent_id = '20000000-0000-0000-0000-000000000003'), 1,
  'completing a recurring task creates the next occurrence (visible to the assignee)');
select results_eq(
  $$ select title, status::text, priority::text, assignee_id, recurrence::text, due_date
       from tasks where recurrence_parent_id = '20000000-0000-0000-0000-000000000003' $$,
  $$ values ('Weekly vessel log', 'todo', 'high', '00000000-0000-0000-0000-0000000000b1'::uuid, 'weekly', local_today() + 7) $$,
  'next occurrence copies fields with the next due date');
select is((select count(*)::int from checklist_items c join tasks t on t.id = c.task_id
            where t.recurrence_parent_id = '20000000-0000-0000-0000-000000000003' and not c.is_done), 2,
  'checklist copied unticked');
select ok((select completed_at is not null from tasks where id = '20000000-0000-0000-0000-000000000003'), 'completed_at set on done');

update tasks set status = 'todo' where id = '20000000-0000-0000-0000-000000000003';
update tasks set status = 'done' where id = '20000000-0000-0000-0000-000000000003';
select is((select count(*)::int from tasks where recurrence_parent_id = '20000000-0000-0000-0000-000000000003'), 1,
  're-completing does not create a duplicate occurrence');
select is((select completed_at from tasks where id = '20000000-0000-0000-0000-000000000001'), null,
  'completed_at empty while not done');

-- ---------------------------------------------------------------------------
-- Super admin powers; deactivation
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);
select lives_ok($$ update settings set late_grace_min = 10, lunch_start = '13:00', lunch_end = '14:00' $$, 'super admin can change settings');
select throws_ok($$ update settings set lunch_start = '13:00', lunch_end = null $$, '23514', null, 'lunch window must be complete');
select throws_ok($$ update settings set timezone = 'Mars/Olympus' $$, '22023', null, 'timezone is validated');
select lives_ok($$ update profiles set work_mode = 'office' where id = '00000000-0000-0000-0000-0000000000b1' $$, 'super admin can edit work mode');
select lives_ok($$ update profiles set is_active = false where id = '00000000-0000-0000-0000-0000000000b2' $$, 'super admin can deactivate staff');
select throws_ok($$ update profiles set role = 'admin' where id = '00000000-0000-0000-0000-0000000000a1' $$,
  'P0001', 'There must always be at least one active super admin', 'last super admin cannot be demoted');

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000b2","role":"authenticated"}', true);
select is((select count(*)::int from tasks), 0, 'deactivated user sees no tasks');
select is((select count(*)::int from attendance), 0, 'deactivated user sees no attendance');
select throws_ok($$ select clock_in() $$, 'P0001', 'This account is deactivated', 'deactivated user cannot clock in');

reset role;
select is((select late_grace_min from settings), 10, 'settings saved by super admin');

select * from finish();
rollback;
