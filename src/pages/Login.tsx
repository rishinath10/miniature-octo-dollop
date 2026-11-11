import { useState } from "react";
import { errorMessage, supabase } from "../lib/supabase";

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    setBusy(false);
    if (error) {
      setError(
        /invalid login/i.test(error.message)
          ? "Wrong email or password."
          : /banned/i.test(error.message)
            ? "This account has been deactivated. Contact your administrator."
            : errorMessage(error),
      );
    }
  };

  return (
    <div className="flex min-h-full items-center justify-center bg-navy px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center text-cream">
          <img src="/icons/logo-256.png" alt="DDS" className="mx-auto mb-4 h-24 w-24" />
          <div className="text-3xl font-bold tracking-wide">DDS Team</div>
          <div className="mx-auto mt-2 h-0.5 w-12 bg-gold" />
          <div className="mt-3 text-sm text-cream/70">DDS Marine Energy Services</div>
        </div>
        <form onSubmit={submit} className="card space-y-4 p-6">
          <label className="block">
            <span className="label">Email</span>
            <input className="input" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>
          <label className="block">
            <span className="label">Password</span>
            <input
              className="input"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
          <button className="btn-primary w-full py-3 text-base" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button>
          <p className="text-center text-xs text-navy/50">Accounts are created by your administrator.</p>
        </form>
      </div>
    </div>
  );
}
