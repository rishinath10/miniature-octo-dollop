export type Role = "super_admin" | "admin" | "staff";
export type WorkMode = "office" | "wfh";
export type Source = "app" | "telegram";
export type ProjectStatus = "active" | "on_hold" | "completed" | "archived";
export type TaskStatus = "todo" | "in_progress" | "waiting_client" | "review" | "done";
export type Priority = "low" | "normal" | "high" | "urgent";
export type Recurrence = "none" | "daily" | "weekly" | "monthly";
export type ActivityType =
  | "created" | "status_changed" | "assigned" | "due_changed" | "note"
  | "subtask_done" | "checklist_done" | "photo";

export interface Profile {
  id: string;
  full_name: string;
  email: string;
  role: Role;
  work_mode: WorkMode;
  is_active: boolean;
  last_activity_at: string | null;
  last_activity_source: Source | null;
  created_at: string;
}

export interface Settings {
  timezone: string;
  work_days: number[];
  start_time: string;
  end_time: string;
  late_grace_min: number;
  lunch_start: string | null;
  lunch_end: string | null;
  pings_enabled: boolean;
  pings_per_day: number;
  ping_reply_min: number;
  ping_backup_after_min: number;
  stale_task_days: number;
}

export interface Attendance {
  id: string;
  staff_id: string;
  work_date: string;
  clock_in_at: string;
  clock_out_at: string | null;
  lunch_start_at: string | null;
  lunch_end_at: string | null;
  is_late: boolean;
  source_in: Source;
  source_out: Source | null;
}

export interface Project {
  id: string;
  name: string;
  description: string;
  owner_id: string | null;
  status: ProjectStatus;
  color: string;
  created_at: string;
}

export interface Task {
  id: string;
  project_id: string;
  title: string;
  description: string;
  assignee_id: string | null;
  status: TaskStatus;
  priority: Priority;
  due_date: string | null;
  position: number;
  recurrence: Recurrence;
  recurrence_parent_id: string | null;
  completed_at: string | null;
  last_update_at: string;
  created_by: string | null;
  created_at: string;
}

export interface Subtask {
  id: string;
  task_id: string;
  title: string;
  is_done: boolean;
  position: number;
  assignee_id: string | null;
}

export interface ChecklistItem {
  id: string;
  task_id: string;
  text: string;
  is_done: boolean;
  position: number;
}

export interface Activity {
  id: string;
  task_id: string;
  actor_id: string | null;
  type: ActivityType;
  from_value: string | null;
  to_value: string | null;
  note: string | null;
  source: Source;
  created_at: string;
}

export interface Person {
  id: string;
  full_name: string;
  role: Role;
  is_active: boolean;
}

export type LiveState = "online" | "idle" | "on_break" | "offline";

export interface LiveStatus {
  staff_id: string;
  full_name: string;
  email: string;
  work_mode: WorkMode;
  status: LiveState;
  attendance_id: string | null;
  clock_in_at: string | null;
  clock_out_at: string | null;
  lunch_start_at: string | null;
  lunch_end_at: string | null;
  is_late: boolean;
  last_activity_at: string | null;
  last_activity_source: Source | null;
  current_task_id: string | null;
  current_task_title: string | null;
  current_project_name: string | null;
  tasks_done_today: number;
  tasks_open: number;
}

export const STATUSES: { key: TaskStatus; label: string }[] = [
  { key: "todo", label: "To do" },
  { key: "in_progress", label: "In progress" },
  { key: "waiting_client", label: "Waiting on client" },
  { key: "review", label: "Review" },
  { key: "done", label: "Done" },
];
export const statusLabel = (s: string) => STATUSES.find((x) => x.key === s)?.label ?? s;

export const PRIORITIES: { key: Priority; label: string }[] = [
  { key: "low", label: "Low" },
  { key: "normal", label: "Normal" },
  { key: "high", label: "High" },
  { key: "urgent", label: "Urgent" },
];

export const RECURRENCES: { key: Recurrence; label: string }[] = [
  { key: "none", label: "Does not repeat" },
  { key: "daily", label: "Daily (work days)" },
  { key: "weekly", label: "Weekly" },
  { key: "monthly", label: "Monthly" },
];

export const PROJECT_STATUSES: { key: ProjectStatus; label: string }[] = [
  { key: "active", label: "Active" },
  { key: "on_hold", label: "On hold" },
  { key: "completed", label: "Completed" },
  { key: "archived", label: "Archived" },
];

export const ROLE_LABEL: Record<Role, string> = {
  super_admin: "Super admin",
  admin: "Admin",
  staff: "Staff",
};
