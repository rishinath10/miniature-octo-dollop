import { useCallback, useEffect, useState } from "react";
import { useAuth } from "../lib/auth";
import { useRealtime, useTick } from "../lib/hooks";
import { errorMessage, supabase } from "../lib/supabase";
import { addDaysYmd, fmtClock, fmtDate, fmtDuration, fmtTime, todayLocal, workedMinutes } from "../lib/time";
import type { Attendance, Project, Task } from "../lib/types";
import { LateBadge, PriorityBadge, StatusBadge } from "../components/badges";
import { useOpenTask } from "../components/TaskDrawer";
import { IconRepeat } from "../components/icons";
import { Empty, PageHeader, Spinner, useToast } from "../components/ui";

type Action = "clock_in" | "start_lunch" | "end_lunch" | "clock_out";

export default function MyDay() {
  const { profile, settings } = useAuth();
  const toast = useToast();
  const openTask = useOpenTask();
  const [att, setAtt] = useState<Attendance | null | undefined>(undefined);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [projects, setProjects] = useState<Record<string, Project>>({});
  const [busy, setBusy] = useState<Action | null>(null);
  useTick(60000);

  const load = useCallback(async () => {
    if (!profile) return;
    const today = todayLocal();
    const [a, t, p] = await Promise.all([
      supabase.from("attendance").select("*").eq("staff_id", profile.id)
        .gte("work_date", addDaysYmd(today, -1)).order("work_date", { ascending: false }),
      supabase.from("tasks").select("*").eq("assignee_id", profile.id).neq("status", "done")
        .order("due_date", { ascending: true, nullsFirst: false }),
      supabase.from("projects").select("*"),
    ]);
    const rows = (a.data as Attendance[]) ?? [];
    // Today's record, or yesterday's if it was never closed.
    setAtt(rows.find((r) => r.work_date === today) ?? rows.find((r) => !r.clock_out_at) ?? null);
    setTasks((t.data as Task[]) ?? []);
    setProjects(Object.fromEntries(((p.data as Project[]) ?? []).map((x) => [x.id, x])));
  }, [profile]);

  useEffect(() => { load(); }, [load]);
  useRealtime(["attendance", "tasks"], load, "myday");

  const act = async (action: Action) => {
    setBusy(action);
    const { error } = await supabase.rpc(action);
    setBusy(null);
    if (error) toast(errorMessage(error), "error");
    else toast({ clock_in: "Clocked in. Have a good day!", start_lunch: "Enjoy your lunch", end_lunch: "Welcome back", clock_out: "Clocked out. See you tomorrow!" }[action]);
    load();
  };

  if (att === undefined) return <Spinner />;

  const onLunch = !!att?.lunch_start_at && !att.lunch_end_at;
  const out = !!att?.clock_out_at;
  const can: Record<Action, boolean> = {
    clock_in: !att,
    start_lunch: !!att && !out && !att.lunch_start_at,
    end_lunch: !!att && onLunch,
    clock_out: !!att && !out && !onLunch,
  };

  const today = todayLocal();
  const overdue = tasks.filter((t) => t.due_date && t.due_date < today);
  const dueToday = tasks.filter((t) => t.due_date === today);
  const inProgress = tasks.filter((t) => t.status === "in_progress" && !(t.due_date && t.due_date <= today));

  const state = !att ? "Not clocked in" : out ? "Clocked out" : onLunch ? "On lunch" : "Working";

  return (
    <div>
      <PageHeader
        title={`Hi, ${profile?.full_name.split(" ")[0] ?? ""}`}
        subtitle={<>{fmtDate(today, "EEEE, d MMMM")} · Work hours {fmtClock(settings?.start_time)}–{fmtClock(settings?.end_time)}
          {settings?.lunch_start && <> · Lunch {fmtClock(settings.lunch_start)}–{fmtClock(settings.lunch_end)}</>}</>}
      />

      <section className="card mb-6 p-4 sm:p-5">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-navy/50">Status</div>
            <div className="text-lg font-bold">{state}</div>
          </div>
          {att && (
            <div className="text-right">
              <div className="text-xs font-semibold uppercase tracking-wide text-navy/50">Worked</div>
              <div className="text-lg font-bold tabular-nums">{fmtDuration(workedMinutes(att))}</div>
            </div>
          )}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <BigButton label="Clock in" onClick={() => act("clock_in")} enabled={can.clock_in} busy={busy === "clock_in"} tone="gold" />
          <BigButton label="Start lunch" onClick={() => act("start_lunch")} enabled={can.start_lunch} busy={busy === "start_lunch"} />
          <BigButton label="End lunch" onClick={() => act("end_lunch")} enabled={can.end_lunch} busy={busy === "end_lunch"} />
          <BigButton
            label="Clock out"
            onClick={() => confirm("Clock out for today?") && act("clock_out")}
            enabled={can.clock_out}
            busy={busy === "clock_out"}
            tone="navy"
          />
        </div>

        {att && (
          <ol className="mt-5 space-y-2 border-t border-cream-200 pt-4 text-sm">
            <TimelineRow label="Clocked in" time={att.clock_in_at} extra={att.is_late && <LateBadge />} />
            {att.lunch_start_at && <TimelineRow label="Lunch started" time={att.lunch_start_at} />}
            {att.lunch_end_at && <TimelineRow label="Lunch ended" time={att.lunch_end_at} />}
            {att.clock_out_at && <TimelineRow label="Clocked out" time={att.clock_out_at} />}
          </ol>
        )}
      </section>

      <TaskSection title="Overdue" tone="red" tasks={overdue} projects={projects} onOpen={openTask} />
      <TaskSection title="Due today" tasks={dueToday} projects={projects} onOpen={openTask} />
      <TaskSection title="In progress" tasks={inProgress} projects={projects} onOpen={openTask} />
      {overdue.length + dueToday.length + inProgress.length === 0 && (
        <Empty>Nothing due today. Check the Board for your other tasks.</Empty>
      )}
    </div>
  );
}

function BigButton({ label, onClick, enabled, busy, tone }: { label: string; onClick: () => void; enabled: boolean; busy: boolean; tone?: "gold" | "navy" }) {
  const cls = !enabled
    ? "bg-cream text-navy/30 ring-1 ring-cream-200"
    : tone === "gold" ? "bg-gold text-navy shadow-md"
    : tone === "navy" ? "bg-navy text-cream shadow-md"
    : "bg-white text-navy ring-2 ring-navy shadow-md";
  return (
    <button disabled={!enabled || busy} onClick={onClick} className={`h-20 rounded-xl text-lg font-bold transition active:scale-[0.98] ${cls}`}>
      {busy ? "…" : label}
    </button>
  );
}

function TimelineRow({ label, time, extra }: { label: string; time: string; extra?: React.ReactNode }) {
  return (
    <li className="flex items-center gap-3">
      <span className="h-2 w-2 rounded-full bg-gold" />
      <span className="w-20 font-semibold tabular-nums">{fmtTime(time)}</span>
      <span className="text-navy/70">{label}</span>
      {extra}
    </li>
  );
}

export function TaskSection({
  title, tasks, projects, onOpen, tone,
}: { title: string; tasks: Task[]; projects: Record<string, Project>; onOpen: (id: string) => void; tone?: "red" }) {
  if (!tasks.length) return null;
  return (
    <section className="mb-6">
      <h2 className={`mb-2 text-sm font-bold uppercase tracking-wide ${tone === "red" ? "text-red-700" : "text-navy/60"}`}>
        {title} ({tasks.length})
      </h2>
      <ul className="space-y-2">
        {tasks.map((t) => (
          <li key={t.id}>
            <button onClick={() => onOpen(t.id)} className="card flex w-full items-center gap-3 p-3 text-left hover:ring-gold/50">
              <span className="h-8 w-1 shrink-0 rounded-full" style={{ background: projects[t.project_id]?.color ?? "#ccc" }} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 font-semibold">
                  <span className="truncate">{t.title}</span>
                  {t.recurrence !== "none" && <IconRepeat className="h-3.5 w-3.5 shrink-0 text-gold-600" />}
                </div>
                <div className="truncate text-xs text-navy/60">
                  {projects[t.project_id]?.name}
                  {t.due_date && <span className={tone === "red" ? "text-red-600" : ""}> · due {fmtDate(t.due_date, "d MMM")}</span>}
                </div>
              </div>
              <PriorityBadge p={t.priority} />
              <StatusBadge s={t.status} />
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
