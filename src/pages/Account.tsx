import { useState } from "react";
import { useAuth } from "../lib/auth";
import { errorMessage, supabase } from "../lib/supabase";
import { ROLE_LABEL } from "../lib/types";
import { Field, PageHeader, useToast } from "../components/ui";

export default function Account() {
  const { profile, refresh } = useAuth();
  const toast = useToast();
  const [name, setName] = useState(profile?.full_name ?? "");
  const [pw, setPw] = useState({ a: "", b: "" });

  const saveName = async (e: React.FormEvent) => {
    e.preventDefault();
    const { error } = await supabase.from("profiles").update({ full_name: name.trim() }).eq("id", profile!.id);
    if (error) return toast(errorMessage(error), "error");
    toast("Name updated");
    refresh();
  };
  const savePw = async (e: React.FormEvent) => {
    e.preventDefault();
    if (pw.a !== pw.b) return toast("Passwords don't match", "error");
    const { error } = await supabase.auth.updateUser({ password: pw.a });
    if (error) return toast(errorMessage(error), "error");
    setPw({ a: "", b: "" });
    toast("Password changed");
  };

  if (!profile) return null;
  return (
    <div className="max-w-lg space-y-6">
      <PageHeader title="Account" subtitle={`${profile.email} · ${ROLE_LABEL[profile.role]} · ${profile.work_mode === "wfh" ? "Work from home" : "Office"}`} />
      <form onSubmit={saveName} className="card space-y-3 p-5">
        <Field label="Your name"><input className="input" required value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <div className="flex justify-end"><button className="btn-primary" disabled={!name.trim() || name === profile.full_name}>Save</button></div>
      </form>
      <form onSubmit={savePw} className="card space-y-3 p-5">
        <Field label="New password"><input className="input" type="password" minLength={8} required autoComplete="new-password" value={pw.a} onChange={(e) => setPw({ ...pw, a: e.target.value })} /></Field>
        <Field label="Confirm new password"><input className="input" type="password" minLength={8} required autoComplete="new-password" value={pw.b} onChange={(e) => setPw({ ...pw, b: e.target.value })} /></Field>
        <div className="flex justify-end"><button className="btn-primary">Change password</button></div>
      </form>
      <section className="card space-y-2 p-5 text-sm">
        <h2 className="font-bold">Install on your phone</h2>
        <p><b>Android (Chrome):</b> open the menu ⋮ and tap <b>Install app</b> or <b>Add to Home screen</b>.</p>
        <p><b>iPhone (Safari):</b> tap <b>Share</b> then <b>Add to Home Screen</b>. Notifications need iOS 16.4 or later and the app opened from the Home Screen.</p>
      </section>
      <button className="btn-ghost text-red-700" onClick={() => supabase.auth.signOut()}>Sign out</button>
    </div>
  );
}
