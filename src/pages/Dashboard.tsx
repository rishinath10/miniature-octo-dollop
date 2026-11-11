import { useCallback, useEffect, useState } from "react";
import { useRealtime, useTick } from "../lib/hooks";
import { errorMessage, supabase } from "../lib/supabase";
import { ago, fmtDate, fmtDuration, fmtTime, todayLocal, workedMinutes } from "../lib/time";
import type { LiveStatus } from "../lib/types";
import { LateBadge, LiveBadge } from "../components/badges";
import { useOpenTask } from "../components/TaskDrawer";
import { Empty, PageHeader, Spinner } from "../components/ui";

export default function Dashboard() {
  const [rows, setRows] = useState<LiveStatus[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const openTask = useOpenTask();
  useTick(30000);

  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc("live_status");
    if (error) setError(errorMessage(error));
    else {
      setRows(data as LiveStatus[]);
      setError(null);
      setUpdatedAt(new Date());
    }
  }, []);

  useEffect(() => {
    load();
    // Idle is time-based, so re-check every minute even without events.
    const id = setInterval(load, 60000);
    return () => clearInterval(id);
  }, [load]);
  useRealtime(["profiles", "attendance", "tasks", "task_activity"], load, "dashboard");

  if (error) return <Empty>{error}</Empty>;
  if (!rows) return <Spinner />;

  const counts = rows.reduce<Record<string, number>>((m, r) => ({ ...m, [r.status]: (m[r.status] ?? 0) + 1 }), {});
  const present = rows.filter((r) => r.clock_in_at);

  return (
    <div>
      <PageHeader
        title="Live status"
        subtitle={<>{fmtDate(todayLocal(), "EEEE, d MMMM")} · updates automatically{updatedAt && <> · checked {fmtTime(updatedAt)}</>}</>}
      />

      <div className="mb-5 grid grid-cols-4 gap-2 text-center">
        {(["online", "idle", "on_break", "offline"] as const).map((s) => (
          <div key={s} className="card p-2">
            <div className="text-2xl font-bold">{counts[s] ?? 0}</div>
            <LiveBadge state={s} />
          </div>
        ))}
      </div>

      {rows.length === 0 ? (
        <Empty>No staff yet. The super admin can add staff from the Staff page.</Empty>
      ) : (
        <div className="mb-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map((r) => (
            <article key={r.staff_id} className="card p-4">
              <div className="mb-3 flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate font-bold">{r.full_name}</div>
                  <div className="text-xs text-navy/50">{r.work_mode === "wfh" ? "Working from home" : "Office"}</div>
                </div>
                <LiveBadge state={r.status} />
              </div>
              <dl className="space-y-1.5 text-sm">
                <Row label="Clock in">
                  {r.clock_in_at ? <span className="flex items-center gap-1.5">{fmtTime(r.clock_in_at)}{r.is_late && <LateBadge />}</span> : "—"}
                </Row>
                <Row label="Working on">
                  {r.current_task_id ? (
                    <button className="truncate text-left font-medium text-navy underline decoration-gold decoration-2 underline-offset-2" onClick={() => openTask(r.current_task_id!)}>
                      {r.current_task_title}
                    </button>
                  ) : <span className="text-navy/40">No task in progress</span>}
                </Row>
                <Row label="Last active">
                  {r.last_activity_at ? <>{ago(r.last_activity_at)} <span className="text-navy/50">· {r.last_activity_source === "telegram" ? "Telegram" : "App"}</span></> : "—"}
                </Row>
                <Row label="Tasks today">
                  <span><b>{r.tasks_done_today}</b> done · <b>{r.tasks_open}</b> open</span>
                </Row>
              </dl>
            </article>
          ))}
        </div>
      )}

      <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-navy/60">Today's attendance</h2>
      {present.length === 0 ? (
        <Empty>Nobody has clocked in yet today.</Empty>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <thead className="bg-cream text-left text-xs uppercase tracking-wide text-navy/60">
              <tr>
                <th className="px-3 py-2">Name</th><th className="px-3 py-2">In</th><th className="px-3 py-2">Lunch</th>
                <th className="px-3 py-2">Out</th><th className="px-3 py-2">Worked</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-cream-200">
              {present.map((r) => (
                <tr key={r.staff_id}>
                  <td className="px-3 py-2 font-medium">{r.full_name}</td>
                  <td className="px-3 py-2">{fmtTime(r.clock_in_at)} {r.is_late && <LateBadge />}</td>
                  <td className="px-3 py-2">{r.lunch_start_at ? `${fmtTime(r.lunch_start_at)} – ${r.lunch_end_at ? fmtTime(r.lunch_end_at) : "now"}` : "—"}</td>
                  <td className="px-3 py-2">{fmtTime(r.clock_out_at)}</td>
                  <td className="px-3 py-2 tabular-nums">
                    {fmtDuration(workedMinutes({ clock_in_at: r.clock_in_at!, clock_out_at: r.clock_out_at, lunch_start_at: r.lunch_start_at, lunch_end_at: r.lunch_end_at }))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline gap-2">
      <dt className="w-24 shrink-0 text-xs text-navy/50">{label}</dt>
      <dd className="min-w-0 flex-1 truncate">{children}</dd>
    </div>
  );
}
