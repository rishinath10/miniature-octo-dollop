# DDS Team

The internal clock-in and project tracker for DDS Marine Energy Services. It is installable as a phone app (PWA), built with React and Supabase.

- **Brief:** [`docs/BRIEF.md`](docs/BRIEF.md)
- **Deployment:** [`docs/DEPLOY.md`](docs/DEPLOY.md). Self-hosted Supabase plus the app, both on Dokploy (Hostinger VPS).
- **Status:** Phase 1 built. Phase 2 (Telegram bot, pings, end-of-day report) is next.

## What's in Phase 1

| Area | What it does |
|---|---|
| Login | Email and password. No public sign-up; the super admin creates accounts. |
| My Day | Clock in, start/end lunch, clock out (only valid actions are enabled), today's timeline, overdue/due-today/in-progress tasks. |
| Live (admin) | One card per staff member with Online / Idle / On break / Offline, clock-in time and late flag, current task, last activity, and today's done/open counts, plus today's attendance table. Updates in real time. |
| Projects | Project list with progress, and a project page with tasks grouped by status. |
| Board | Kanban across the 5 statuses, drag-and-drop (mouse and touch), filters by project and assignee. |
| Calendar | Month and week views by due date. Overdue tasks are red; recurring tasks are marked ↻. |
| Task drawer | All fields, subtasks, checklist, and an activity timeline with "Add an update". |
| Attendance | Staff see their own; admins see everyone, filtered by person and date range. |
| Settings | Super admin: work days, hours, late grace, lunch window, ping rules (saved for Phase 2). |
| Staff | Super admin: add people, change role or work mode, reset password, deactivate/reactivate. |

## How it's built

```
src/                     React + Vite + TypeScript + Tailwind
  lib/                   Supabase client, auth context, types, Malaysia-time helpers
  components/            Layout (sidebar / bottom nav), task drawer, forms, badges
  pages/                 One file per screen
supabase/
  migrations/            Schema, business rules, RLS (run in order)
  functions/admin-users  Edge Function: staff creation and role changes (service role key lives only here)
  tests/database/        pgTAP tests for rules and RLS
  seed.sql               Demo data for LOCAL testing only
scripts/
  create-super-admin.mjs Bootstrap the first super admin
  smoke-test.mjs         End-to-end check against a local stack
  make-icons.mjs         PWA icons from assets/dds-logo.png
deploy/supabase/         Self-hosted Supabase for Dokploy: trimmed compose, migration job,
                         secrets generator, nightly backup script
Dockerfile, nginx.conf   Production image (static files served by nginx, SPA fallback)
```

### Rules live in the database
So the app and the Phase 2 Telegram bot behave the same way, these rules are enforced in Postgres, not in the browser:

- **Clock actions** go through `clock_in()`, `start_lunch()`, `end_lunch()` and `clock_out()`. Clients can't write `attendance` directly. Sequences are enforced: one clock-in per day, no clock-out without clock-in, no clock-out during lunch, one lunch per day.
- **Late flag:** set when clock-in is after `start_time + late_grace_min` in Malaysia time, on configured work days only.
- **Activity log:** triggers write `task_activity` for creation, status, assignee and due-date changes, and subtask/checklist ticks. Clients may only add notes. The log can't be edited or deleted.
- **Recurring tasks:** marking one done creates the next occurrence once, copying the checklist unticked.
- **Last activity:** clock events, task changes, notes and ticks update `profiles.last_activity_at`.
- **RLS on every table.**
  - Staff see only their own profile and attendance, the tasks assigned to them, and those tasks' projects, subtasks, checklists and activity.
  - Staff can change only the status/order of their tasks, add notes, and add or tick subtasks and checklist items.
  - Admins see everything and manage projects and tasks.
  - Only the super admin changes settings, roles and active status.
  - Deactivated users lose all access and can't sign in.

The Phase 2 bot can reuse all of this. It calls `attendance_action(staff, action, 'telegram')` with the service role and sets `app.source = 'telegram'` and `app.actor_id` for task changes, so activity shows "via Telegram".

## Decisions to review

These are behaviours the brief didn't spell out, so I picked a sensible default. Each is easy to change.

1. **Daily recurrence skips non-work days.** A daily task completed on Friday is next due Monday, per Settings → work days.
2. **The next due date is never in the past.** If a weekly task is finished two weeks late, the next one is due on the next upcoming weekly date, not an already-overdue one.
3. **A repeating task needs a due date** when created in the app.
4. **Lunch can be taken once per day, and you must end lunch before clocking out.**
5. **Idle** means clocked in with no activity for 60+ minutes (Phase 1 rule from the brief).
6. **Staff can add subtasks and checklist items to their own tasks and tick them**, but only admins delete items or assign subtasks.
7. **The Done column on the Board** shows tasks completed in the last 14 days, so the board stays fast. Everything is still on the project pages and calendar.
8. **There's always at least one active super admin.** The database refuses to demote or deactivate the last one.
9. **Deactivating someone** also blocks their sign-in. Their history is kept.

## Local development

Requirements: Node 22, Docker, Supabase CLI.

```bash
npm install
supabase start                       # local Postgres, Auth, Realtime, Edge runtime
supabase db reset                    # migrations + demo seed
supabase functions serve             # Edge Function (in another terminal)
cp .env.example .env                 # set the local URL and anon key printed by `supabase status`
npm run dev                          # http://localhost:5173
```

Demo logins (local only), all with password `password123`: `rishi@dds.test` (super admin), `md@dds.test` (admin), `aisha@dds.test` and `ben@dds.test` (staff).

### Tests

```bash
npm run test:db      # pgTAP: 84 tests covering roles, RLS, attendance rules, activity log, recurrence
npm run typecheck
SUPABASE_ANON_KEY=... SUPABASE_SERVICE_ROLE_KEY=... npm run smoke   # end-to-end against the local stack
```

Never commit secrets. Only `VITE_SUPABASE_URL` and the anon key (both public) are used by the frontend. The service role key exists only inside the Edge Function and, once, on your machine for `create-super-admin.mjs`.
