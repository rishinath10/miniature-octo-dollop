import { Navigate, Route, Routes } from "react-router-dom";
import { useAuth } from "./lib/auth";
import { configError, supabase } from "./lib/supabase";
import { Layout } from "./components/Layout";
import { Spinner } from "./components/ui";
import Login from "./pages/Login";
import MyDay from "./pages/MyDay";
import Dashboard from "./pages/Dashboard";
import Board from "./pages/Board";
import Calendar from "./pages/Calendar";
import Projects, { ProjectPage } from "./pages/Projects";
import Attendance from "./pages/Attendance";
import Settings from "./pages/Settings";
import Staff from "./pages/Staff";
import Account from "./pages/Account";

export default function App() {
  const { session, profile, loading, isAdmin, isSuperAdmin } = useAuth();

  if (configError) return <div className="p-6 text-red-700">{configError}</div>;
  if (loading) return <Spinner className="pt-32" />;
  if (!session) return <Login />;
  if (!profile || !profile.is_active) {
    return (
      <div className="flex min-h-full flex-col items-center justify-center gap-4 p-6 text-center">
        <p>{profile ? "This account has been deactivated." : "Your account isn't set up yet."} Contact your administrator.</p>
        <button className="btn-primary" onClick={() => supabase.auth.signOut()}>Sign out</button>
      </div>
    );
  }

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Navigate to={isAdmin ? "/dashboard" : "/my-day"} replace />} />
        <Route path="my-day" element={<MyDay />} />
        {isAdmin && <Route path="dashboard" element={<Dashboard />} />}
        <Route path="board" element={<Board />} />
        <Route path="calendar" element={<Calendar />} />
        <Route path="projects" element={<Projects />} />
        <Route path="projects/:id" element={<ProjectPage />} />
        <Route path="attendance" element={<Attendance />} />
        {isSuperAdmin && <Route path="settings" element={<Settings />} />}
        {isSuperAdmin && <Route path="staff" element={<Staff />} />}
        <Route path="account" element={<Account />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
