# DDS Team — Clock-in & Project Tracker
## Handover brief for Claude Code

**Owner:** Rishi (super admin) · **Approved by:** Managing Director, DDS Marine Energy Services Sdn Bhd (1552670-D)
**Date:** 11 November 2026 · **Status:** Plan approved; build Phase 1 first

Save this file in the new repo as `docs/BRIEF.md` and read it fully before writing any code.

---

## 1. Why this exists

DDS Marine's Penang HQ has an admin staff member who works from home (9am–5pm). She often replies late to messages from clients and management, goes missing during work hours, and doesn't report on her work until someone asks.

The system has to show, without anyone chasing:
- who is clocked in and actually available right now
- what each person is working on, and when they last updated it
- a record of attendance, missed check-ins and task progress for management and HR

There is **1 staff user today**, with more joining later. Everything must work for many staff from day one.

---

## 2. Roles

| Role | Who | Can do |
|---|---|---|
| **super_admin** | Rishi | Everything an admin can, plus Settings (work hours, lunch hour, ping rules), add, edit and deactivate staff, assign roles |
| **admin** | Managing Director | Live status dashboard, all attendance, all projects and tasks, assign tasks, receive alerts, view reports |
| **staff** | Penang HQ staff (office or WFH) | Own clock-in/out and lunch, own attendance history, tasks assigned to them and the projects those belong to, update tasks, end-of-day report |

- **Live status visibility:** only admin and super_admin see other people's live status. Staff never see each other's presence.
- **Client access:** none. The system is internal only, with no client portal.

---

## 3. Decisions already made (do not reopen)

- **Custom build, not an off-the-shelf tool:** React + Supabase.
- **Supabase location:** a **new project** in a **new "DDS Marine" Supabase organisation**, separate from Rishi's existing Art Engine organisation and projects. Rishi creates the organisation; Claude creates the project in it.
- **Hosting:** on **DDS's own server**, as a Docker container. DDS has two VPSs:
  - Hostinger KVM2 VPS running **Dokploy**. It also hosts the Poste.io mail server, and the `ddsmarine.com` DNS is managed at Hostinger.
  - Oracle Cloud VPS running **Coolify**. It also hosts the internal payslip/invoice dashboard.

  Confirm with Rishi which one before deploying. Both deploy a Dockerfile from GitHub.
- **Web address:** a subdomain of `ddsmarine.com`, e.g. `team.ddsmarine.com`. Confirm the exact name with Rishi.
- **Install method:** a PWA installed to the phone home screen. No app-store app.
- **Messaging channel:** **Telegram** is the main channel (bot) for clock-in/out, pings and updates. **App push notifications** are the backup. WhatsApp was considered and rejected for now (Meta verification, template approval, per-message cost).
- **Telegram activity:** Telegram updates count as activity, but **pings stay random** regardless of recent activity.
- **Lunch hour:** configurable in Settings by the super admin. No default is forced, and pings must pause during it.
- **Tracker structure:** ClickUp-style, kept simple: **Project → Task → Subtask / Checklist**.
- **Tracker views:** **Board (Kanban)** and **Calendar**. No list or Gantt view needed.
- **Task features:** subtasks, checklists and **recurring tasks**. Comments, attachments and time tracking are not required in Phase 1. Photo attachments arrive via Telegram in Phase 2.
- **PDPA:** a written staff monitoring notice must be signed by staff **before go-live**. Rishi handles this separately; do not build it.

---

## 4. Build phases

### Phase 1 — build now
1. Auth (email + password, Supabase Auth). Super admin creates staff accounts; there's no public sign-up.
2. Roles and staff management (super admin only).
3. Attendance: clock in, start/end lunch, clock out. Late flag against the configured start time.
4. Live dashboard (admin/super admin): every staff member's status and current task, updated in real time.
5. Project tracker: projects, tasks, subtasks, checklists, Kanban board with drag-and-drop, calendar view, recurring tasks, task activity log.
6. Settings (super admin): work days, start and end time, lunch window, late grace minutes, ping rules (saved now, used in Phase 2).
7. PWA: manifest, icons, installable, mobile-first layout.
8. Docker packaging and deployment guide.

### Phase 2 — next
- Telegram bot (DDS bot) with account linking, clock in/out, lunch, ping replies, task updates, photo uploads and status changes.
- Random presence pings plus app push backup, with alerts on missed pings.
- End-of-day report, prompted at 4:45pm and required before clock-out.
- Auto-flags: overdue tasks, and tasks with no update for 2 working days, alert admin and super admin.

### Phase 3 — later
- Weekly and monthly reports (attendance, missed pings, tasks completed vs overdue), exported to PDF and Excel for HR.
- Leave and public holidays (Penang state holidays), so pings and late flags skip them.

---

## 5. Data model (Supabase / Postgres)

All times are stored in UTC and displayed in **Asia/Kuala_Lumpur**. Use `uuid` primary keys and `created_at` / `updated_at` on every table.

| Table | Key columns |
|---|---|
| `profiles` | `id` (= auth.users.id), `full_name`, `email`, `role` (`super_admin`/`admin`/`staff`), `work_mode` (`office`/`wfh`), `is_active`, `telegram_chat_id` (P2), `telegram_link_code` (P2), `last_activity_at`, `last_activity_source` (`app`/`telegram`) |
| `settings` | single row: `timezone`, `work_days` (int[]), `start_time`, `end_time`, `late_grace_min`, `lunch_start`, `lunch_end` (nullable until Rishi sets them), `pings_enabled`, `pings_per_day`, `ping_reply_min` (10), `ping_backup_after_min` (5), `stale_task_days` (2) |
| `attendance` | `staff_id`, `work_date`, `clock_in_at`, `clock_out_at`, `lunch_start_at`, `lunch_end_at`, `is_late`, `source_in`, `source_out` (`app`/`telegram`). Unique per staff per day |
| `projects` | `name`, `description`, `owner_id`, `status` (`active`/`on_hold`/`completed`/`archived`), `color` |
| `tasks` | `project_id`, `title`, `description`, `assignee_id`, `status`, `priority` (`low`/`normal`/`high`/`urgent`), `due_date`, `position` (board ordering), `recurrence` (`none`/`daily`/`weekly`/`monthly`), `recurrence_parent_id`, `completed_at`, `last_update_at`, `created_by` |
| `subtasks` | `task_id`, `title`, `is_done`, `position`, `assignee_id` (optional) |
| `checklist_items` | `task_id`, `text`, `is_done`, `position` |
| `task_activity` | `task_id`, `actor_id`, `type` (`created`/`status_changed`/`assigned`/`due_changed`/`note`/`subtask_done`/`checklist_done`/`photo` P2), `from_value`, `to_value`, `note`, `source` (`app`/`telegram`), `created_at`. Append-only |
| `pings` (P2) | `staff_id`, `sent_at`, `channel`, `backup_sent_at`, `replied_at`, `status` (`pending`/`replied`/`missed`) |
| `daily_reports` (P2) | `staff_id`, `work_date`, `done`, `pending`, `blockers`, `submitted_at`, `source` |
| `attachments` (P2) | `task_id`, `uploader_id`, `storage_path`, `caption`, `source` |
| `alerts` (P2) | `type`, `staff_id`, `task_id`, `message`, `created_at`, `read_by` |

**Task statuses:** `todo`, `in_progress`, `waiting_client`, `review`, `done`. These are the board columns, labelled To do, In progress, Waiting on client, Review and Done.

### Rules to implement in the database
- **Activity log:** every insert or update to a task's status, assignee or due date writes a `task_activity` row via a trigger, and sets `tasks.last_update_at`.
- **Last activity:** any staff action (clock event, task change, note) updates `profiles.last_activity_at` and `last_activity_source`.
- **Recurring tasks:** when a recurring task moves to `done`, create the next occurrence. Copy title, description, assignee, project, priority and checklist (unticked), set the next due date by the recurrence rule, set status `todo`, and link it with `recurrence_parent_id`. Do this in a trigger or a Postgres function so the app and the Telegram bot behave the same.
- **Late flag:** `is_late` is set on clock-in if it happens after `start_time + late_grace_min` in Malaysia time.
- **One open attendance per day:** a staff member can't clock in twice or clock out without clocking in.

### Row Level Security (must be on for every table)
- **Staff:** read and update own profile (limited fields only, never `role`), own attendance rows, tasks assigned to them, the projects those tasks belong to, and the subtasks, checklist items and activity of those tasks. They can create notes and change status on their own tasks.
- **Admin / super_admin:** full read on everything; create and edit projects and tasks; assign tasks.
- **Super admin only:** write `settings`, change `role` and `is_active`, create staff.
- **Staff creation:** create staff through a **Supabase Edge Function** that uses the service role key and checks the caller is super_admin. The service key must never be in the frontend.

### Realtime
Enable Realtime on `profiles`, `attendance`, `tasks` and `task_activity` so the dashboard and board update live.

---

## 6. Live presence logic

Status is computed for each staff member, shown only to admin and super_admin:

| Status | Rule |
|---|---|
| **Offline** | Not clocked in today, or clocked out |
| **On break** | Lunch started and not ended |
| **Online** | Clocked in, and the last activity (app or Telegram) was within the ping reply window, or the last ping was replied to |
| **Unresponsive** | Clocked in and the latest ping was missed (Phase 2). In Phase 1, show "Idle" if there's been no activity for 60+ minutes while clocked in |

**Dashboard card per staff member:** name, status badge, clock-in time (late badge if late), current in-progress task, last activity time and source, today's task count (done / open).

---

## 7. Screens (Phase 1)

1. **Login**
2. **My Day (staff home):**
   - large Clock In / Start Lunch / End Lunch / Clock Out buttons (only the valid next action enabled)
   - today's timeline
   - my tasks due today and overdue
3. **Live Dashboard** (admin/super_admin): staff cards from section 6, plus today's attendance table
4. **Projects:** list of projects, plus a project page
5. **Board:** Kanban across the 5 statuses, filter by project and assignee, drag to change status and order
6. **Calendar:** month and week view of tasks by due date, overdue in red, recurring tasks marked ↻
7. **Task detail (drawer or modal):**
   - title, description, assignee, due date, priority, status, recurrence
   - subtasks, checklist
   - activity timeline, with an "Add update" note box
8. **Attendance history:** staff see their own; admins see all, filterable by staff and date range
9. **Settings** (super_admin)
10. **Staff** (super_admin): list, add, edit role or work mode, deactivate

**Design:**
- **Layout:** mobile-first, since the staff member will mostly use her phone. Use a bottom nav on mobile and a sidebar on desktop.
- **Brand palette:**
  - navy `#0E2240`
  - gold `#C8973F`
  - cream `#F7F3EA`
  - font: Helvetica Neue / Arial
- **Branding:** use "DDS Team" as the app name. Ask Rishi for the official DDS logo PNG; don't redraw it.

---

## 8. Phase 2 design notes (so Phase 1 doesn't block them)

### Telegram bot
- **Bot setup:** Rishi creates the bot via @BotFather. The bot has no phone number, and the token is stored as a Supabase secret.
- **Webhook:** goes to a Supabase Edge Function, which writes to the same tables, so everything shows on the dashboard instantly.
- **Linking:** in the app, the staff member taps "Connect Telegram". This generates a one-time `telegram_link_code` and opens `t.me/<bot>?start=<code>`. The bot stores the `chat_id` on the profile. No phone number is shared.
- **Staff actions:**
  - buttons for Clock in, Start lunch, End lunch, Clock out
  - "I'm here" ping replies
  - a text update or photo, where the bot asks "Which task?" with buttons for her open tasks and saves the note or photo to that task
  - status buttons
- **Hard rule:** every update or photo must be linked to a task. No loose messages.

### Pings
- **Timing:** `pings_per_day` random times between clock-in and clock-out, skipping the lunch window and outside work hours, and only when the staff member is clocked in.
- **Sequence:** send via Telegram first. If there's no reply after `ping_backup_after_min` (5), send an app push. If there's no reply by `ping_reply_min` (10), mark it missed and alert admin and super_admin.
- **Scheduling:** use Supabase `pg_cron` plus an Edge Function.

### App push
- **Mechanism:** Web Push (VAPID), stored per device.
- **iPhone:** needs iOS 16.4+ and the app added to the Home Screen. Show install guidance in the app.

---

## 9. Tech stack

- **Frontend:**
  - React + Vite + TypeScript
  - Tailwind CSS
  - `@supabase/supabase-js`
  - `@dnd-kit` for the board
  - a lightweight calendar (e.g. FullCalendar or a custom month grid)
  - `date-fns` + `date-fns-tz`
  - `vite-plugin-pwa`
- **Backend:** Supabase (Postgres, Auth, Realtime, Storage, Edge Functions, pg_cron)
- **Migrations:** SQL in `supabase/migrations/`, plus a `supabase/seed.sql` with sample projects and tasks for testing only
- **Deployment:**
  - multi-stage `Dockerfile` that builds with Node and serves `dist/` with nginx, with SPA fallback
  - `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` passed as build args
  - add a `docs/DEPLOY.md` covering both Dokploy and Coolify, the DNS record for the subdomain at Hostinger, and HTTPS via the platform's Let's Encrypt
- **Repo:** new GitHub repo, suggested name `dds-team` (under Rishi's GitHub `rishinath10`). Never commit secrets; provide a `.env.example`.

---

## 10. Phase 1 acceptance checklist

- [ ] Super admin can create a staff account; staff can log in; there's no public sign-up
- [ ] Staff can clock in, take lunch, end lunch and clock out, with invalid sequences blocked; the late flag works in Malaysia time
- [ ] Admin dashboard shows live status changes within seconds, without a page refresh
- [ ] Staff can't see other staff's attendance or presence (verified by testing RLS as a staff user)
- [ ] Projects, tasks, subtasks and checklists can be created and edited; the board supports drag-and-drop between all 5 columns and persists
- [ ] Calendar shows tasks by due date; overdue tasks are red
- [ ] Completing a recurring task creates the next occurrence with the correct due date
- [ ] Every status, assignee or due change and every note appears in the task's activity timeline with time and actor
- [ ] Settings save, and only the super admin can change them
- [ ] App installs to the home screen on Android and iPhone
- [ ] Docker image builds and runs; `DEPLOY.md` is complete

---

## 11. Before you start (for Rishi)

1. Create a free **DDS Marine** organisation in the Supabase dashboard.
2. Create the GitHub repo `dds-team` and open it in Claude Code with this brief at `docs/BRIEF.md`.
3. Decide which server (Hostinger/Dokploy or Oracle/Coolify) and the subdomain name.
4. Have the official DDS logo PNG ready for the app icon.
5. Lunch hour can be set in Settings after go-live.

**First instruction to give Claude Code:**
> Read `docs/BRIEF.md`. Set up the project and build Phase 1 only. Start with the Supabase migration and RLS, test it, then the frontend. Ask me before creating the Supabase project or deploying.
