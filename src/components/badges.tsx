import type { LiveState, Priority, TaskStatus } from "../lib/types";
import { statusLabel } from "../lib/types";

const LIVE: Record<LiveState, { label: string; cls: string; dot: string }> = {
  online: { label: "Online", cls: "bg-emerald-100 text-emerald-800", dot: "bg-emerald-500" },
  idle: { label: "Idle", cls: "bg-amber-100 text-amber-800", dot: "bg-amber-500" },
  on_break: { label: "On break", cls: "bg-sky-100 text-sky-800", dot: "bg-sky-500" },
  offline: { label: "Offline", cls: "bg-slate-200 text-slate-600", dot: "bg-slate-400" },
};

export function LiveBadge({ state }: { state: LiveState }) {
  const s = LIVE[state];
  return (
    <span className={`chip ${s.cls}`}>
      <span className={`h-2 w-2 rounded-full ${s.dot} ${state === "online" ? "animate-pulse" : ""}`} />
      {s.label}
    </span>
  );
}

const PRIORITY: Record<Priority, string> = {
  low: "bg-slate-100 text-slate-600",
  normal: "bg-navy-50 text-navy",
  high: "bg-orange-100 text-orange-800",
  urgent: "bg-red-100 text-red-700",
};
export function PriorityBadge({ p }: { p: Priority }) {
  if (p === "normal") return null;
  return <span className={`chip ${PRIORITY[p]} capitalize`}>{p}</span>;
}

const STATUS: Record<TaskStatus, string> = {
  todo: "bg-slate-100 text-slate-700",
  in_progress: "bg-blue-100 text-blue-800",
  waiting_client: "bg-purple-100 text-purple-800",
  review: "bg-gold-50 text-gold-600",
  done: "bg-emerald-100 text-emerald-800",
};
export function StatusBadge({ s }: { s: TaskStatus }) {
  return <span className={`chip ${STATUS[s]}`}>{statusLabel(s)}</span>;
}

export const LateBadge = () => <span className="chip bg-red-100 text-red-700">Late</span>;
