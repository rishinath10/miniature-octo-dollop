import { useCallback, useEffect, useMemo, useState } from "react";
import {
  addMonths, addWeeks, eachDayOfInterval, endOfMonth, endOfWeek, format, isSameMonth, startOfMonth, startOfWeek,
} from "date-fns";
import { useAuth } from "../lib/auth";
import { useRealtime } from "../lib/hooks";
import { supabase } from "../lib/supabase";
import { isOverdue, todayLocal } from "../lib/time";
import type { Task } from "../lib/types";
import { IconRepeat } from "../components/icons";
import { NewTaskModal } from "../components/TaskForm";
import { useOpenTask } from "../components/TaskDrawer";
import { TaskFilters, useProjects, useTaskFilters } from "../components/TaskFilters";
import { PageHeader } from "../components/ui";

const ymd = (d: Date) => format(d, "yyyy-MM-dd");
const WEEK = { weekStartsOn: 1 as const };

export default function Calendar() {
  const { isAdmin } = useAuth();
  const projects = useProjects();
  const projectMap = useMemo(() => Object.fromEntries(projects.map((p) => [p.id, p])), [projects]);
  const { project, assignee } = useTaskFilters();
  const openTask = useOpenTask();
  const [view, setView] = useState<"month" | "week">(() => (window.innerWidth < 640 ? "week" : "month"));
  const [cursor, setCursor] = useState(() => {
    const [y, m, d] = todayLocal().split("-").map(Number);
    return new Date(y, m - 1, d);
  });
  const [tasks, setTasks] = useState<Task[]>([]);
  const [newDue, setNewDue] = useState<string | null>(null);

  const days = useMemo(() => {
    const start = view === "month" ? startOfWeek(startOfMonth(cursor), WEEK) : startOfWeek(cursor, WEEK);
    const end = view === "month" ? endOfWeek(endOfMonth(cursor), WEEK) : endOfWeek(cursor, WEEK);
    return eachDayOfInterval({ start, end });
  }, [cursor, view]);

  const load = useCallback(async () => {
    let q = supabase.from("tasks").select("*").gte("due_date", ymd(days[0])).lte("due_date", ymd(days[days.length - 1]));
    if (project) q = q.eq("project_id", project);
    if (assignee === "none") q = q.is("assignee_id", null);
    else if (assignee) q = q.eq("assignee_id", assignee);
    const { data } = await q.order("priority", { ascending: false });
    setTasks((data as Task[]) ?? []);
  }, [days, project, assignee]);
  useEffect(() => { load(); }, [load]);
  useRealtime(["tasks"], load, "calendar");

  const byDay = useMemo(() => {
    const m: Record<string, Task[]> = {};
    for (const t of tasks) (m[t.due_date!] ??= []).push(t);
    return m;
  }, [tasks]);

  const today = todayLocal();
  const step = (n: number) => setCursor((c) => (view === "month" ? addMonths(c, n) : addWeeks(c, n)));
  const title = view === "month" ? format(cursor, "MMMM yyyy")
    : `${format(days[0], "d MMM")} – ${format(days[6], "d MMM yyyy")}`;

  const Chip = ({ t }: { t: Task }) => {
    const late = isOverdue(t);
    return (
      <button
        onClick={(e) => { e.stopPropagation(); openTask(t.id); }}
        className={`flex w-full items-center gap-1 truncate rounded px-1.5 py-0.5 text-left text-xs font-medium ${
          late ? "bg-red-100 text-red-700" : t.status === "done" ? "bg-emerald-50 text-emerald-700 line-through" : "bg-white text-navy ring-1 ring-black/5"
        }`}
        style={!late && t.status !== "done" ? { borderLeft: `3px solid ${projectMap[t.project_id]?.color ?? "#ccc"}` } : undefined}
        title={t.title}
      >
        {t.recurrence !== "none" && <span aria-label="recurring">↻</span>}
        <span className="truncate">{t.title}</span>
      </button>
    );
  };

  return (
    <div>
      <PageHeader title="Calendar" actions={<TaskFilters projects={projects} />} />
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="flex rounded-lg bg-white p-0.5 ring-1 ring-black/5">
          {(["month", "week"] as const).map((v) => (
            <button key={v} onClick={() => setView(v)}
              className={`rounded-md px-3 py-1 text-sm font-semibold capitalize ${view === v ? "bg-navy text-cream" : "text-navy/70"}`}>
              {v}
            </button>
          ))}
        </div>
        <button className="btn-ghost px-2" onClick={() => step(-1)} aria-label="Previous">‹</button>
        <button className="btn-ghost px-2" onClick={() => step(1)} aria-label="Next">›</button>
        <button className="btn-ghost px-2 text-sm" onClick={() => { const [y, m, d] = today.split("-").map(Number); setCursor(new Date(y, m - 1, d)); }}>Today</button>
        <h2 className="ml-1 text-lg font-bold">{title}</h2>
        <span className="ml-auto flex items-center gap-3 text-xs text-navy/60">
          <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded bg-red-200" />Overdue</span>
          <span className="flex items-center gap-1"><IconRepeat className="h-3 w-3" />Recurring</span>
        </span>
      </div>

      {view === "month" ? (
        <div className="card overflow-hidden">
          <div className="grid grid-cols-7 bg-navy text-center text-xs font-semibold text-cream">
            {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => <div key={d} className="py-1.5">{d}</div>)}
          </div>
          <div className="grid grid-cols-7">
            {days.map((d) => {
              const key = ymd(d);
              const list = byDay[key] ?? [];
              return (
                <div key={key}
                  onClick={() => isAdmin && setNewDue(key)}
                  className={`min-h-20 border-b border-r border-cream-200 p-1 sm:min-h-28 ${isSameMonth(d, cursor) ? "" : "bg-cream/60 text-navy/40"} ${isAdmin ? "cursor-pointer" : ""}`}>
                  <div className={`mb-1 inline-flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold ${key === today ? "bg-gold text-navy" : ""}`}>
                    {format(d, "d")}
                  </div>
                  <div className="space-y-0.5">
                    {list.slice(0, 3).map((t) => <Chip key={t.id} t={t} />)}
                    {list.length > 3 && (
                      <button className="px-1 text-xs font-semibold text-navy/60" onClick={(e) => { e.stopPropagation(); setView("week"); setCursor(d); }}>
                        +{list.length - 3} more
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="grid gap-2 sm:grid-cols-7">
          {days.map((d) => {
            const key = ymd(d);
            const list = byDay[key] ?? [];
            return (
              <div key={key} className={`card min-h-24 p-2 ${key === today ? "ring-2 ring-gold" : ""}`}>
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-xs font-bold uppercase text-navy/60">{format(d, "EEE d")}</span>
                  {isAdmin && <button className="text-navy/40 hover:text-navy" onClick={() => setNewDue(key)} aria-label="Add task">+</button>}
                </div>
                <div className="space-y-1">
                  {list.map((t) => <Chip key={t.id} t={t} />)}
                  {!list.length && <div className="text-xs text-navy/30">—</div>}
                </div>
              </div>
            );
          })}
        </div>
      )}
      <NewTaskModal open={!!newDue} onClose={() => setNewDue(null)} defaults={{ due_date: newDue ?? undefined, project_id: project || undefined }} onCreated={load} />
    </div>
  );
}
