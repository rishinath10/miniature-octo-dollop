-- LOCAL TESTING ONLY. Runs on `supabase db reset` against the local stack.
-- Never run this against production: it creates demo accounts with a known password.
--
-- Demo logins (password: password123)
--   rishi@dds.test   super admin
--   md@dds.test      admin
--   aisha@dds.test   staff (WFH)
--   ben@dds.test     staff (office)

do $$
declare
  u record;
begin
  for u in
    select * from (values
      ('00000000-0000-0000-0000-00000000a001'::uuid, 'rishi@dds.test', 'Rishi',              'super_admin', 'office'),
      ('00000000-0000-0000-0000-00000000a002'::uuid, 'md@dds.test',    'Managing Director', 'admin',       'office'),
      ('00000000-0000-0000-0000-00000000b001'::uuid, 'aisha@dds.test', 'Aisha Rahman',      'staff',       'wfh'),
      ('00000000-0000-0000-0000-00000000b002'::uuid, 'ben@dds.test',   'Ben Tan',           'staff',       'office')
    ) as t(id, email, full_name, role, work_mode)
  loop
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
      confirmation_token, recovery_token, email_change_token_new, email_change
    ) values (
      '00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated', u.email,
      extensions.crypt('password123', extensions.gen_salt('bf')), now(),
      jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email'),
                         'role', u.role, 'work_mode', u.work_mode),
      jsonb_build_object('full_name', u.full_name), now(), now(), '', '', '', ''
    );
    insert into auth.identities (id, user_id, provider_id, identity_data, provider, created_at, updated_at, last_sign_in_at)
    values (gen_random_uuid(), u.id, u.id::text,
            jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true),
            'email', now(), now(), now());
  end loop;
end;
$$;

-- Projects
insert into public.projects (id, name, description, owner_id, color) values
  ('10000000-0000-0000-0000-000000000001', 'MV Ocean Pride — dry dock', 'Documentation and supplier coordination for the dry-dock period.', '00000000-0000-0000-0000-00000000a002', '#C8973F'),
  ('10000000-0000-0000-0000-000000000002', 'Finance & invoicing', 'Supplier invoices, payment follow-ups, monthly close.', '00000000-0000-0000-0000-00000000a002', '#2563EB'),
  ('10000000-0000-0000-0000-000000000003', 'HQ admin', 'Office admin, HR paperwork and certificates.', '00000000-0000-0000-0000-00000000a001', '#059669');

-- Tasks (created as the MD so the activity log has an actor)
select set_config('app.actor_id', '00000000-0000-0000-0000-00000000a002', false);

insert into public.tasks (project_id, title, description, assignee_id, status, priority, due_date, recurrence) values
  ('10000000-0000-0000-0000-000000000001', 'Compile class survey documents', 'Collect all certificates for the surveyor.', '00000000-0000-0000-0000-00000000b001', 'in_progress', 'high', public.local_today(), 'none'),
  ('10000000-0000-0000-0000-000000000001', 'Request quotes for hull painting', '', '00000000-0000-0000-0000-00000000b001', 'waiting_client', 'normal', public.local_today() + 3, 'none'),
  ('10000000-0000-0000-0000-000000000001', 'Book crew transport', '', '00000000-0000-0000-0000-00000000b002', 'todo', 'urgent', public.local_today() - 2, 'none'),
  ('10000000-0000-0000-0000-000000000002', 'Chase overdue supplier invoices', 'Call suppliers with invoices older than 30 days.', '00000000-0000-0000-0000-00000000b001', 'todo', 'normal', public.local_today() - 1, 'none'),
  ('10000000-0000-0000-0000-000000000002', 'Weekly payment run report', '', '00000000-0000-0000-0000-00000000b001', 'todo', 'normal', public.local_today() + 2, 'weekly'),
  ('10000000-0000-0000-0000-000000000002', 'Monthly bank reconciliation', '', '00000000-0000-0000-0000-00000000b002', 'review', 'high', public.local_today() + 10, 'monthly'),
  ('10000000-0000-0000-0000-000000000003', 'Check shared inbox', '', '00000000-0000-0000-0000-00000000b001', 'todo', 'low', public.local_today(), 'daily'),
  ('10000000-0000-0000-0000-000000000003', 'Renew office insurance', '', null, 'todo', 'normal', public.local_today() + 20, 'none');

insert into public.checklist_items (task_id, text)
select id, x from public.tasks, unnest(array['Class certificate', 'Safety equipment cert', 'Load line cert']) x
 where title = 'Compile class survey documents';
insert into public.subtasks (task_id, title)
select id, x from public.tasks, unnest(array['Email surveyor for list', 'Scan originals']) x
 where title = 'Compile class survey documents';

select set_config('app.actor_id', '', false);
