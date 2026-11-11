import { useState, type ComponentType } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { supabase } from "../lib/supabase";
import { ROLE_LABEL } from "../lib/types";
import {
  IconBoard, IconCalendar, IconClock, IconFolder, IconList, IconMore, IconPulse, IconSettings, IconUser, IconUsers,
} from "./icons";
import { TaskDrawer } from "./TaskDrawer";
import { InstallBanner } from "./InstallBanner";

interface Item { to: string; label: string; icon: ComponentType<{ className?: string }> }

export function useNavItems() {
  const { isAdmin, isSuperAdmin } = useAuth();
  const items: Item[] = [];
  if (isAdmin) items.push({ to: "/dashboard", label: "Live", icon: IconPulse });
  items.push(
    { to: "/my-day", label: "My Day", icon: IconClock },
    { to: "/board", label: "Board", icon: IconBoard },
    { to: "/calendar", label: "Calendar", icon: IconCalendar },
    { to: "/projects", label: "Projects", icon: IconFolder },
    { to: "/attendance", label: "Attendance", icon: IconList },
  );
  if (isSuperAdmin) {
    items.push({ to: "/staff", label: "Staff", icon: IconUsers }, { to: "/settings", label: "Settings", icon: IconSettings });
  }
  items.push({ to: "/account", label: "Account", icon: IconUser });
  return items;
}

export function Layout() {
  const { profile } = useAuth();
  const items = useNavItems();
  const [moreOpen, setMoreOpen] = useState(false);
  const loc = useLocation();
  const primary = items.slice(0, 4);
  const overflow = items.slice(4);
  const overflowActive = overflow.some((i) => loc.pathname.startsWith(i.to));

  return (
    <div className="min-h-full md:flex">
      {/* Desktop sidebar */}
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col bg-navy text-cream md:flex">
        <div className="flex items-center gap-3 px-5 py-6">
          <img src="/icons/logo-256.png" alt="" className="h-11 w-11" />
          <div>
            <div className="text-xl font-bold tracking-wide">DDS Team</div>
            <div className="mt-1 h-0.5 w-10 bg-gold" />
          </div>
        </div>
        <nav className="flex-1 space-y-0.5 px-3">
          {items.map((i) => (
            <NavLink
              key={i.to}
              to={i.to}
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium ${
                  isActive ? "bg-gold text-navy" : "text-cream/80 hover:bg-white/10 hover:text-cream"
                }`
              }
            >
              <i.icon />
              {i.label}
            </NavLink>
          ))}
        </nav>
        <div className="border-t border-white/10 px-5 py-4 text-sm">
          <div className="font-semibold">{profile?.full_name}</div>
          <div className="text-cream/60">{profile && ROLE_LABEL[profile.role]}</div>
          <button className="mt-2 text-gold hover:underline" onClick={() => supabase.auth.signOut()}>Sign out</button>
        </div>
      </aside>

      {/* Mobile header */}
      <header className="pt-safe sticky top-0 z-30 bg-navy text-cream md:hidden">
        <div className="flex h-12 items-center justify-between px-4">
          <span className="flex items-center gap-2 font-bold tracking-wide">
            <img src="/icons/logo-256.png" alt="" className="h-7 w-7" />
            DDS Team
          </span>
          <span className="text-xs text-cream/70">{profile?.full_name}</span>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 pb-28 pt-4 md:px-8 md:pb-10 md:pt-8">
        <InstallBanner />
        <Outlet />
      </main>

      {/* Mobile bottom nav */}
      <nav className="pb-safe fixed inset-x-0 bottom-0 z-40 border-t border-cream-200 bg-white md:hidden">
        <div className="grid grid-cols-5">
          {primary.map((i) => (
            <NavLink
              key={i.to}
              to={i.to}
              className={({ isActive }) =>
                `flex flex-col items-center gap-0.5 py-2 text-[11px] font-medium ${isActive ? "text-gold-600" : "text-navy/60"}`
              }
            >
              <i.icon className="h-6 w-6" />
              {i.label}
            </NavLink>
          ))}
          <button
            className={`flex flex-col items-center gap-0.5 py-2 text-[11px] font-medium ${overflowActive ? "text-gold-600" : "text-navy/60"}`}
            onClick={() => setMoreOpen(true)}
          >
            <IconMore className="h-6 w-6" />
            More
          </button>
        </div>
      </nav>

      {moreOpen && (
        <div className="fixed inset-0 z-50 bg-navy/40 md:hidden" onClick={() => setMoreOpen(false)}>
          <div className="pb-safe absolute inset-x-0 bottom-0 rounded-t-2xl bg-cream p-3" onClick={(e) => e.stopPropagation()}>
            {overflow.map((i) => (
              <NavLink
                key={i.to}
                to={i.to}
                onClick={() => setMoreOpen(false)}
                className="flex items-center gap-3 rounded-lg px-3 py-3 text-base font-medium hover:bg-white"
              >
                <i.icon />
                {i.label}
              </NavLink>
            ))}
            <button
              className="flex w-full items-center gap-3 rounded-lg px-3 py-3 text-left text-base font-medium text-red-700 hover:bg-white"
              onClick={() => supabase.auth.signOut()}
            >
              Sign out
            </button>
          </div>
        </div>
      )}

      <TaskDrawer />
    </div>
  );
}
