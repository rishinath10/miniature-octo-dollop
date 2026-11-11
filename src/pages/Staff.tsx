import { useCallback, useEffect, useState } from "react";
import { useAuth } from "../lib/auth";
import { useRealtime } from "../lib/hooks";
import { adminUsers, errorMessage, supabase } from "../lib/supabase";
import { ago } from "../lib/time";
import { ROLE_LABEL, type Profile, type Role, type WorkMode } from "../lib/types";
import { IconPlus } from "../components/icons";
import { Field, Modal, PageHeader, Spinner, useToast } from "../components/ui";

export default function Staff() {
  const { profile: me, refresh } = useAuth();
  const toast = useToast();
  const [rows, setRows] = useState<Profile[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Profile | null>(null);

  const load = useCallback(async () => {
    const { data } = await supabase.from("profiles").select("*").order("is_active", { ascending: false }).order("full_name");
    setRows((data as Profile[]) ?? []);
  }, []);
  useEffect(() => { load(); }, [load]);
  useRealtime(["profiles"], load, "staff");

  const toggleActive = async (p: Profile) => {
    if (p.is_active && !confirm(`Deactivate ${p.full_name}? They will be signed out and unable to sign in. Their history is kept.`)) return;
    try {
      await adminUsers({ action: "update", user_id: p.id, is_active: !p.is_active });
      toast(p.is_active ? "Deactivated" : "Reactivated");
      load();
      refresh();
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  };

  if (!rows) return <Spinner />;
  return (
    <div>
      <PageHeader title="Staff" subtitle="Only you (super admin) can add people or change roles."
        actions={<button className="btn-primary" onClick={() => setAdding(true)}><IconPlus className="h-4 w-4" />Add person</button>} />
      <div className="card divide-y divide-cream-200">
        {rows.map((p) => (
          <div key={p.id} className={`flex flex-wrap items-center gap-3 p-4 ${p.is_active ? "" : "opacity-50"}`}>
            <div className="min-w-0 flex-1">
              <div className="font-semibold">{p.full_name} {p.id === me?.id && <span className="text-xs text-navy/50">(you)</span>}</div>
              <div className="truncate text-sm text-navy/60">{p.email}</div>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="chip bg-navy-50 text-navy">{ROLE_LABEL[p.role]}</span>
              <span className="chip bg-cream text-navy/70">{p.work_mode === "wfh" ? "WFH" : "Office"}</span>
              {!p.is_active && <span className="chip bg-slate-200 text-slate-600">Inactive</span>}
              <span className="text-navy/50">active {ago(p.last_activity_at)}</span>
            </div>
            <div className="flex gap-1">
              <button className="btn-ghost px-3 py-1.5" onClick={() => setEditing(p)}>Edit</button>
              {p.id !== me?.id && (
                <button className="btn-ghost px-3 py-1.5" onClick={() => toggleActive(p)}>{p.is_active ? "Deactivate" : "Reactivate"}</button>
              )}
            </div>
          </div>
        ))}
      </div>
      <AddModal open={adding} onClose={() => setAdding(false)} onSaved={() => { load(); refresh(); }} />
      <EditModal person={editing} onClose={() => setEditing(null)} onSaved={() => { load(); refresh(); }} />
    </div>
  );
}

function tempPassword() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  const a = crypto.getRandomValues(new Uint32Array(12));
  return Array.from(a, (n) => chars[n % chars.length]).join("");
}

function AddModal({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [f, setF] = useState({ full_name: "", email: "", role: "staff" as Role, work_mode: "wfh" as WorkMode, password: "" });
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<{ email: string; password: string } | null>(null);
  useEffect(() => {
    if (open) {
      setF({ full_name: "", email: "", role: "staff", work_mode: "wfh", password: tempPassword() });
      setCreated(null);
    }
  }, [open]);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await adminUsers({ action: "create", ...f, email: f.email.trim() });
      setCreated({ email: f.email.trim(), password: f.password });
      onSaved();
    } catch (err) {
      toast(errorMessage(err), "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Add person">
      {created ? (
        <div className="space-y-3 text-sm">
          <p>Account created. Send these sign-in details to them privately, and ask them to change the password under <b>Account</b>.</p>
          <div className="rounded-lg bg-white p-3 font-mono ring-1 ring-black/5">
            <div>{window.location.origin}</div>
            <div>{created.email}</div>
            <div>{created.password}</div>
          </div>
          <div className="flex justify-end gap-2">
            <button className="btn-ghost" onClick={() => navigator.clipboard?.writeText(`${window.location.origin}\n${created.email}\n${created.password}`).then(() => toast("Copied"))}>Copy</button>
            <button className="btn-primary" onClick={onClose}>Done</button>
          </div>
        </div>
      ) : (
        <form onSubmit={save} className="space-y-3">
          <Field label="Full name"><input className="input" required autoFocus value={f.full_name} onChange={(e) => setF({ ...f, full_name: e.target.value })} /></Field>
          <Field label="Email"><input className="input" type="email" required value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Role">
              <select className="input" value={f.role} onChange={(e) => setF({ ...f, role: e.target.value as Role })}>
                {(Object.keys(ROLE_LABEL) as Role[]).map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
              </select>
            </Field>
            <Field label="Work mode">
              <select className="input" value={f.work_mode} onChange={(e) => setF({ ...f, work_mode: e.target.value as WorkMode })}>
                <option value="wfh">Work from home</option><option value="office">Office</option>
              </select>
            </Field>
          </div>
          <Field label="Temporary password" hint="8+ characters. They should change it after first sign-in.">
            <input className="input font-mono" required minLength={8} value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} />
          </Field>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
            <button className="btn-primary" disabled={busy}>{busy ? "Creating…" : "Create account"}</button>
          </div>
        </form>
      )}
    </Modal>
  );
}

function EditModal({ person, onClose, onSaved }: { person: Profile | null; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [f, setF] = useState({ full_name: "", role: "staff" as Role, work_mode: "wfh" as WorkMode });
  const [pw, setPw] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (person) setF({ full_name: person.full_name, role: person.role, work_mode: person.work_mode });
    setPw("");
  }, [person]);
  if (!person) return null;

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await adminUsers({ action: "update", user_id: person.id, ...f });
      if (pw) await adminUsers({ action: "set_password", user_id: person.id, password: pw });
      toast("Saved");
      onSaved();
      onClose();
    } catch (err) {
      toast(errorMessage(err), "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open onClose={onClose} title={`Edit ${person.full_name}`}>
      <form onSubmit={save} className="space-y-3">
        <Field label="Full name"><input className="input" required value={f.full_name} onChange={(e) => setF({ ...f, full_name: e.target.value })} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Role">
            <select className="input" value={f.role} onChange={(e) => setF({ ...f, role: e.target.value as Role })}>
              {(Object.keys(ROLE_LABEL) as Role[]).map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
            </select>
          </Field>
          <Field label="Work mode">
            <select className="input" value={f.work_mode} onChange={(e) => setF({ ...f, work_mode: e.target.value as WorkMode })}>
              <option value="wfh">Work from home</option><option value="office">Office</option>
            </select>
          </Field>
        </div>
        <Field label="Set a new password" hint="Leave empty to keep the current password.">
          <input className="input" type="text" minLength={8} value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" />
        </Field>
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn-primary" disabled={busy}>{busy ? "Saving…" : "Save"}</button>
        </div>
      </form>
    </Modal>
  );
}
