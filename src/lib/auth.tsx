import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "./supabase";
import { setTimezone } from "./time";
import type { Person, Profile, Settings } from "./types";

interface AuthState {
  session: Session | null;
  profile: Profile | null;
  settings: Settings | null;
  people: Person[];
  loading: boolean;
  isAdmin: boolean;
  isSuperAdmin: boolean;
  refresh: () => Promise<void>;
  personName: (id: string | null | undefined) => string;
}

const Ctx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [people, setPeople] = useState<Person[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (s: Session | null) => {
    if (!s) {
      setProfile(null);
      setSettings(null);
      setPeople([]);
      setLoading(false);
      return;
    }
    const [p, st, ppl] = await Promise.all([
      supabase.from("profiles").select("*").eq("id", s.user.id).maybeSingle(),
      supabase.from("settings").select("*").maybeSingle(),
      supabase.rpc("people"),
    ]);
    setProfile((p.data as Profile) ?? null);
    if (st.data) {
      setSettings(st.data as Settings);
      setTimezone((st.data as Settings).timezone);
    }
    setPeople((ppl.data as Person[]) ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      load(data.session);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s);
      if (event === "SIGNED_IN" || event === "SIGNED_OUT" || event === "USER_UPDATED") {
        // Defer: calling Supabase inside this callback can deadlock the auth lock.
        setTimeout(() => load(s), 0);
      }
    });
    return () => sub.subscription.unsubscribe();
  }, [load]);

  const role = profile?.is_active ? profile.role : null;
  const value: AuthState = {
    session,
    profile,
    settings,
    people,
    loading,
    isAdmin: role === "admin" || role === "super_admin",
    isSuperAdmin: role === "super_admin",
    refresh: () => load(session),
    personName: (id) => (id ? people.find((p) => p.id === id)?.full_name ?? "Unknown" : "Unassigned"),
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAuth outside AuthProvider");
  return v;
}
