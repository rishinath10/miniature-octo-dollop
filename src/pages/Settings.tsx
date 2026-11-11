import { useEffect, useState } from "react";
import { useAuth } from "../lib/auth";
import { errorMessage, supabase } from "../lib/supabase";
import type { Settings as S } from "../lib/types";
import { Field, PageHeader, Spinner, useToast } from "../components/ui";

const DAYS = [[1, "Mon"], [2, "Tue"], [3, "Wed"], [4, "Thu"], [5, "Fri"], [6, "Sat"], [7, "Sun"]] as const;
const hhmm = (t: string | null) => (t ? t.slice(0, 5) : "");

export default function Settings() {
  const { settings, refresh } = useAuth();
  const toast = useToast();
  const [f, setF] = useState<S | null>(null);
  const [lunchOn, setLunchOn] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (settings) {
      setF({ ...settings, start_time: hhmm(settings.start_time), end_time: hhmm(settings.end_time), lunch_start: hhmm(settings.lunch_start), lunch_end: hhmm(settings.lunch_end) });
      setLunchOn(!!settings.lunch_start);
    }
  }, [settings]);
  if (!f) return <Spinner />;

  const set = <K extends keyof S>(k: K, v: S[K]) => setF({ ...f, [k]: v });
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const { error } = await supabase.from("settings").update({
      work_days: [...f.work_days].sort(),
      start_time: f.start_time,
      end_time: f.end_time,
      late_grace_min: f.late_grace_min,
      lunch_start: lunchOn ? f.lunch_start : null,
      lunch_end: lunchOn ? f.lunch_end : null,
      pings_enabled: f.pings_enabled,
      pings_per_day: f.pings_per_day,
      ping_reply_min: f.ping_reply_min,
      ping_backup_after_min: f.ping_backup_after_min,
      stale_task_days: f.stale_task_days,
    }).eq("id", true);
    setBusy(false);
    if (error) {
      const m = errorMessage(error);
      return toast(/settings_hours_valid/.test(m) ? "End time must be after start time" : /settings_lunch_valid/.test(m) ? "Lunch must end after it starts" : m, "error");
    }
    toast("Settings saved");
    refresh();
  };

  const num = (k: keyof S) => (e: React.ChangeEvent<HTMLInputElement>) => set(k, Number(e.target.value) as never);

  return (
    <form onSubmit={save} className="max-w-2xl space-y-6">
      <PageHeader title="Settings" subtitle="All times are Malaysia time (Asia/Kuala_Lumpur)." />

      <section className="card space-y-4 p-5">
        <h2 className="font-bold">Work hours</h2>
        <div>
          <span className="label">Work days</span>
          <div className="flex flex-wrap gap-2">
            {DAYS.map(([n, label]) => {
              const on = f.work_days.includes(n);
              return (
                <button type="button" key={n} onClick={() => set("work_days", on ? f.work_days.filter((d) => d !== n) : [...f.work_days, n])}
                  className={`w-14 rounded-lg py-2 text-sm font-semibold ${on ? "bg-navy text-cream" : "bg-cream text-navy/50 ring-1 ring-cream-200"}`}>
                  {label}
                </button>
              );
            })}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Field label="Start time"><input type="time" className="input" required value={f.start_time} onChange={(e) => set("start_time", e.target.value)} /></Field>
          <Field label="End time"><input type="time" className="input" required value={f.end_time} onChange={(e) => set("end_time", e.target.value)} /></Field>
          <Field label="Late after (min)" hint="Grace minutes after start time">
            <input type="number" min={0} max={240} className="input" value={f.late_grace_min} onChange={num("late_grace_min")} />
          </Field>
        </div>
      </section>

      <section className="card space-y-4 p-5">
        <div className="flex items-center justify-between">
          <h2 className="font-bold">Lunch hour</h2>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="h-5 w-5 accent-gold" checked={lunchOn} onChange={(e) => {
              setLunchOn(e.target.checked);
              if (e.target.checked && !f.lunch_start) setF({ ...f, lunch_start: "13:00", lunch_end: "14:00" });
            }} />
            Set a lunch window
          </label>
        </div>
        {lunchOn ? (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Lunch starts"><input type="time" className="input" required value={f.lunch_start ?? ""} onChange={(e) => set("lunch_start", e.target.value)} /></Field>
            <Field label="Lunch ends"><input type="time" className="input" required value={f.lunch_end ?? ""} onChange={(e) => set("lunch_end", e.target.value)} /></Field>
          </div>
        ) : <p className="text-sm text-navy/60">No lunch window set. Pings (Phase 2) will pause during it once set.</p>}
      </section>

      <section className="card space-y-4 p-5">
        <div>
          <h2 className="font-bold">Presence pings & alerts</h2>
          <p className="text-sm text-navy/60">Saved now; used when the Telegram bot goes live in Phase 2.</p>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" className="h-5 w-5 accent-gold" checked={f.pings_enabled} onChange={(e) => set("pings_enabled", e.target.checked)} />
          Send random presence pings
        </label>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Pings per day"><input type="number" min={0} max={50} className="input" value={f.pings_per_day} onChange={num("pings_per_day")} /></Field>
          <Field label="Reply within (min)"><input type="number" min={1} className="input" value={f.ping_reply_min} onChange={num("ping_reply_min")} /></Field>
          <Field label="App push after (min)" hint="Backup if no Telegram reply"><input type="number" min={1} className="input" value={f.ping_backup_after_min} onChange={num("ping_backup_after_min")} /></Field>
          <Field label="Stale task after (work days)"><input type="number" min={1} className="input" value={f.stale_task_days} onChange={num("stale_task_days")} /></Field>
        </div>
      </section>

      <div className="flex justify-end"><button className="btn-primary px-6" disabled={busy}>{busy ? "Saving…" : "Save settings"}</button></div>
    </form>
  );
}
