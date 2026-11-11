import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { useRealtime } from "../lib/hooks";
import { errorMessage, supabase } from "../lib/supabase";
import { PROJECT_STATUSES, STATUSES, type Project, type ProjectStatus, type Task } from "../lib/types";
import { TaskSection } from "./MyDay";
import { NewTaskModal } from "../components/TaskForm";
import { useOpenTask } from "../components/TaskDrawer";
import { IconPlus } from "../components/icons";
import { Empty, Field, Modal, PageHeader, Spinner, useToast } from "../components/ui";

const COLORS = ["#C8973F", "#0E2240", "#2563EB", "#059669", "#DC2626", "#7C3AED", "#DB2777", "#EA580C", "#0891B2", "#64748B"];

export default function Projects() {
  const { isAdmin } = useAuth();
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [tasks, setTasks] = useState<Pick<Task, "project_id" | "status">[]>([]);
  const [editing, setEditing] = useState<Project | "new" | null>(null);
  const [showArchived, setShowArchived] = useState(false);

  const load = useCallback(async () => {
    const [p, t] = await Promise.all([
      supabase.from("projects").select("*").order("name"),
      supabase.from("tasks").select("project_id, status"),
    ]);
    setProjects((p.data as Project[]) ?? []);
    setTasks((t.data as Task[]) ?? []);
  }, []);
  useEffect(() => { load(); }, [load]);
  useRealtime(["tasks"], load, "projects");

  const counts = useMemo(() => {
    const m: Record<string, { open: number; done: number }> = {};
    for (const t of tasks) {
      const c = (m[t.project_id] ??= { open: 0, done: 0 });
      if (t.status === "done") c.done++;
      else c.open++;
    }
    return m;
  }, [tasks]);

  if (!projects) return <Spinner />;
  const visible = projects.filter((p) => showArchived || p.status !== "archived");

  return (
    <div>
      <PageHeader
        title="Projects"
        subtitle={isAdmin ? undefined : "Projects with tasks assigned to you."}
        actions={isAdmin && <button className="btn-primary" onClick={() => setEditing("new")}><IconPlus className="h-4 w-4" />New project</button>}
      />
      {visible.length === 0 ? (
        <Empty>{isAdmin ? "No projects yet. Create the first one." : "No projects yet."}</Empty>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {visible.map((p) => {
            const c = counts[p.id] ?? { open: 0, done: 0 };
            const total = c.open + c.done;
            return (
              <Link key={p.id} to={`/projects/${p.id}`} className="card block p-4 hover:ring-gold/60">
                <div className="mb-2 flex items-center gap-2">
                  <span className="h-3 w-3 rounded-full" style={{ background: p.color }} />
                  <span className="flex-1 truncate font-bold">{p.name}</span>
                  {p.status !== "active" && <span className="chip bg-cream text-navy/60">{PROJECT_STATUSES.find((s) => s.key === p.status)?.label}</span>}
                </div>
                {p.description && <p className="mb-3 line-clamp-2 text-sm text-navy/60">{p.description}</p>}
                <div className="h-1.5 overflow-hidden rounded-full bg-cream-200">
                  <div className="h-full bg-gold" style={{ width: total ? `${(c.done / total) * 100}%` : 0 }} />
                </div>
                <div className="mt-1.5 text-xs text-navy/60">{c.open} open · {c.done} done</div>
              </Link>
            );
          })}
        </div>
      )}
      {isAdmin && projects.some((p) => p.status === "archived") && (
        <button className="mt-4 text-sm font-semibold text-navy/60 hover:underline" onClick={() => setShowArchived((v) => !v)}>
          {showArchived ? "Hide archived" : "Show archived"}
        </button>
      )}
      <ProjectModal project={editing} onClose={() => setEditing(null)} onSaved={load} />
    </div>
  );
}

function ProjectModal({ project, onClose, onSaved }: { project: Project | "new" | null; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const { profile } = useAuth();
  const [f, setF] = useState({ name: "", description: "", color: COLORS[0], status: "active" as ProjectStatus });
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (project && project !== "new") setF({ name: project.name, description: project.description, color: project.color, status: project.status });
    else if (project === "new") setF({ name: "", description: "", color: COLORS[0], status: "active" });
  }, [project]);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const row = { ...f, name: f.name.trim() };
    const { error } = project === "new"
      ? await supabase.from("projects").insert({ ...row, owner_id: profile?.id })
      : await supabase.from("projects").update(row).eq("id", (project as Project).id);
    setBusy(false);
    if (error) return toast(errorMessage(error), "error");
    toast("Project saved");
    onSaved();
    onClose();
  };

  return (
    <Modal open={!!project} onClose={onClose} title={project === "new" ? "New project" : "Edit project"}>
      <form onSubmit={save} className="space-y-3">
        <Field label="Name"><input className="input" required autoFocus value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="Description"><textarea className="input min-h-20" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
        <Field label="Status">
          <select className="input" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value as ProjectStatus })}>
            {PROJECT_STATUSES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
          </select>
        </Field>
        <div>
          <span className="label">Colour</span>
          <div className="flex flex-wrap gap-2">
            {COLORS.map((c) => (
              <button type="button" key={c} onClick={() => setF({ ...f, color: c })} aria-label={c}
                className={`h-8 w-8 rounded-full ${f.color === c ? "ring-2 ring-navy ring-offset-2" : ""}`} style={{ background: c }} />
            ))}
          </div>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn-primary" disabled={busy}>{busy ? "Saving…" : "Save"}</button>
        </div>
      </form>
    </Modal>
  );
}

export function ProjectPage() {
  const { id } = useParams();
  const { isAdmin } = useAuth();
  const toast = useToast();
  const nav = useNavigate();
  const openTask = useOpenTask();
  const [project, setProject] = useState<Project | null | undefined>(undefined);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [editing, setEditing] = useState(false);
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    const [p, t] = await Promise.all([
      supabase.from("projects").select("*").eq("id", id!).maybeSingle(),
      supabase.from("tasks").select("*").eq("project_id", id!).order("position"),
    ]);
    setProject((p.data as Project) ?? null);
    setTasks((t.data as Task[]) ?? []);
  }, [id]);
  useEffect(() => { load(); }, [load]);
  useRealtime(["tasks"], load, `project-${id}`);

  if (project === undefined) return <Spinner />;
  if (!project) return <Empty>Project not found.</Empty>;

  const remove = async () => {
    if (!confirm(`Delete "${project.name}" and all its tasks? This cannot be undone. Consider archiving instead.`)) return;
    const { error } = await supabase.from("projects").delete().eq("id", project.id);
    if (error) return toast(errorMessage(error), "error");
    toast("Project deleted");
    nav("/projects");
  };

  const pmap = { [project.id]: project };
  return (
    <div>
      <Link to="/projects" className="mb-2 inline-block text-sm text-navy/60 hover:underline">← Projects</Link>
      <PageHeader
        title={project.name}
        subtitle={project.description}
        actions={<>
          <Link className="btn-ghost" to={`/board?project=${project.id}`}>Board</Link>
          <Link className="btn-ghost" to={`/calendar?project=${project.id}`}>Calendar</Link>
          {isAdmin && <button className="btn-ghost" onClick={() => setEditing(true)}>Edit</button>}
          {isAdmin && <button className="btn-primary" onClick={() => setAdding(true)}><IconPlus className="h-4 w-4" />Task</button>}
        </>}
      />
      {tasks.length === 0 && <Empty>No tasks in this project yet.</Empty>}
      {STATUSES.map((s) => (
        <TaskSection key={s.key} title={s.label} tasks={tasks.filter((t) => t.status === s.key)} projects={pmap} onOpen={openTask} />
      ))}
      {isAdmin && <button className="mt-6 text-sm font-semibold text-red-600 hover:underline" onClick={remove}>Delete project</button>}
      <ProjectModal project={editing ? project : null} onClose={() => setEditing(false)} onSaved={load} />
      <NewTaskModal open={adding} onClose={() => setAdding(false)} defaults={{ project_id: project.id }} onCreated={load} />
    </div>
  );
}
