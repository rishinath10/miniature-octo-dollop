import { useEffect, useRef, useState } from "react";
import { supabase } from "./supabase";

/**
 * Calls `onChange` (debounced) whenever any of the given tables change.
 * RLS applies, so people only get events for rows they can see.
 */
export function useRealtime(tables: string[], onChange: () => void, key = "") {
  const cb = useRef(onChange);
  cb.current = onChange;
  const tablesKey = tables.join(",");
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const fire = () => {
      clearTimeout(timer);
      timer = setTimeout(() => cb.current(), 250);
    };
    const ch = supabase.channel(`rt-${tablesKey}-${key}-${Math.random().toString(36).slice(2)}`);
    for (const t of tablesKey.split(",")) {
      ch.on("postgres_changes", { event: "*", schema: "public", table: t }, fire);
    }
    ch.subscribe();
    // Catch up after the phone wakes or the tab comes back.
    const onVisible = () => document.visibilityState === "visible" && fire();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
      supabase.removeChannel(ch);
    };
  }, [tablesKey, key]);
}

/** Re-renders every `ms` milliseconds (for "x minutes ago" labels and idle status). */
export function useTick(ms = 30000) {
  const [, setN] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setN((n) => n + 1), ms);
    return () => clearInterval(id);
  }, [ms]);
}
