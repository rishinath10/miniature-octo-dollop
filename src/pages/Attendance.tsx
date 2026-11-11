import { useCallback, useEffect, useState } from "react";
import { useAuth } from "../lib/auth";
import { useRealtime } from "../lib/hooks";
import { supabase } from "../lib/supabase";
import { addDaysYmd, fmtDate, fmtDuration, fmtTime, todayLocal, workedMinutes } from "../lib/time";
import type { Attendance as Row } from "../lib/types";
import { LateBadge } from "../components/badges";
import { Empty, PageHeader, Spinner } from "../components/ui";

export default function Attendance() {
  const { isAdmin, people, personName } = useAuth();
  const [staff, setStaff] = useState("");
  const [from, setFrom] = useState(() => todayLocal().slice(0, 8) + "01");
  const [to, setTo] = useState(todayLocal);
  const [rows, setRows] = useState<Row[] | null>(null);

  const load = useCallback(async () => {
    let q = supabase.from("attendance").select("*").gte("work_date", from).lte("work_date", to);
    if (staff) q = q.eq("staff_id", staff);
    const { data } = await q.order("work_date", { ascending: false }).order("clock_in_at");
    setRows((data as Row[]) ?? []);
  }, [staff, from, to]);
  useEffect(() => { load(); }, [load]);
  useRealtime(["attendance"], load, "attendance");

  const totalMins = rows?.reduce((s, r) => s + workedMinutes(r), 0) ?? 0;
  const late = rows?.filter((r) => r.is_late).length ?? 0;
  const preset = (days: number) => { setTo(todayLocal()); setFrom(addDaysYmd(todayLocal(), -days + 1)); };

  return (
    <div>
      <PageHeader title="Attendance" subtitle={isAdmin ? "All staff" : "Your attendance history"} />
      <div className="mb-4 flex flex-wrap items-end gap-2">
        {isAdmin && (
          <label>
            <span className="label">Staff</span>
            <select className="input w-auto" value={staff} onChange={(e) => setStaff(e.target.value)}>
              <option value="">Everyone</option>
              {people.map((p) => <option key={p.id} value={p.id}>{p.full_name}{!p.is_active && " (inactive)"}</option>)}
            </select>
          </label>
        )}
        <label><span className="label">From</span><input type="date" className="input w-auto" value={from} max={to} onChange={(e) => setFrom(e.target.value)} /></label>
        <label><span className="label">To</span><input type="date" className="input w-auto" value={to} min={from} onChange={(e) => setTo(e.target.value)} /></label>
        <button className="btn-ghost" onClick={() => preset(7)}>7 days</button>
        <button className="btn-ghost" onClick={() => preset(30)}>30 days</button>
      </div>

      {!rows ? <Spinner /> : rows.length === 0 ? <Empty>No attendance in this period.</Empty> : (
        <>
          <div className="mb-3 flex gap-4 text-sm text-navy/70">
            <span><b>{rows.length}</b> days</span>
            <span><b>{fmtDuration(totalMins)}</b> worked</span>
            <span className={late ? "text-red-700" : ""}><b>{late}</b> late</span>
          </div>
          <div className="card overflow-x-auto">
            <table className="w-full min-w-[620px] text-sm">
              <thead className="bg-cream text-left text-xs uppercase tracking-wide text-navy/60">
                <tr>
                  <th className="px-3 py-2">Date</th>
                  {isAdmin && <th className="px-3 py-2">Name</th>}
                  <th className="px-3 py-2">In</th><th className="px-3 py-2">Lunch</th><th className="px-3 py-2">Out</th>
                  <th className="px-3 py-2">Worked</th><th className="px-3 py-2">Via</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-cream-200">
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td className="whitespace-nowrap px-3 py-2">{fmtDate(r.work_date, "EEE d MMM")}</td>
                    {isAdmin && <td className="px-3 py-2 font-medium">{personName(r.staff_id)}</td>}
                    <td className="whitespace-nowrap px-3 py-2">{fmtTime(r.clock_in_at)} {r.is_late && <LateBadge />}</td>
                    <td className="whitespace-nowrap px-3 py-2">{r.lunch_start_at ? `${fmtTime(r.lunch_start_at)} – ${fmtTime(r.lunch_end_at)}` : "—"}</td>
                    <td className="whitespace-nowrap px-3 py-2">{r.clock_out_at ? fmtTime(r.clock_out_at) : <span className="text-navy/40">open</span>}</td>
                    <td className="px-3 py-2 tabular-nums">{fmtDuration(workedMinutes(r))}</td>
                    <td className="px-3 py-2 capitalize text-navy/60">{r.source_in}{r.source_out && r.source_out !== r.source_in ? ` / ${r.source_out}` : ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
