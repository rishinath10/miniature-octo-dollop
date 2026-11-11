import { useCallback, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { useRealtime } from "../lib/hooks";
import { errorMessage, supabase } from "../lib/supabase";
import { fmtDate, fmtDateTime, isOverdue } from "../lib/time";
import {
  PRIORITIES, RECURRENCES, STATUSES, statusLabel,
  type Activity, type ChecklistItem, type Project, type Subtask, type Task,
} from "../lib/types";
import { IconRepeat } from "./icons";
import { Spinner, useToast } from "./ui";

/** Open a task drawer from anywhere: keeps the current page and adds ?task=<id>. */
export function useOpenTask() {
  const [params, setParams] = useSearchParams();
  return (id: string) => {
    const p = new URLSearchParams(params);
    p.set("task", id);
    setParams(p);
  };
}

export function TaskDrawer() {
  const [params, setParams] = useSearchParams();
  const id = params.get("task");
  const close = () => {
    const p = new URLSearchParams(params);
    p.delete("task");
    setParams(p);
  };
  if (!id) return null;
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-navy/40" onMouseDown={close}>
      <div
        className="pb-safe h-full w-full max-w-xl overflow-y-auto bg-cream shadow-2xl"
        onMouseDown={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Task"
      >
        <TaskDetail key={id} id={id} onClose={close} />
      </div>
    </div>
  );
}

function TaskDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const { isAdmin, people, personName, profile } = useAuth();
  const toast = useToast();
  const openTask = useOpenTask();
  const [task, setTask] = useState<Task | null>(null);
  const [project, setProject] = useState<Project | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [subtasks, setSubtasks] = useState<Subtask[]>([]);
  const [checklist, setChecklist] = useState<ChecklistItem[]>([]);
  const [activity, setActivity] = useState<Activity[]>([]);
  const [nextId, setNextId] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);
  const [note, setNote] = useState("");
  const [newSub, setNewSub] = useState("");
  const [newCheck, setNewCheck] = useState("");
  const [draft, setDraft] = useState({ title: "", description: "" });

  const load = useCallback(async () => {
    const { data: t } = await supabase.from("tasks").select("*").eq("id", id).maybeSingle();
    if (!t) {
      setMissing(true);
      return;
    }
    setTask(t as Task);
    setDraft({ title: t.title, description: t.description });
    const [p, s, c, a, n] = await Promise.all([
      supabase.from("projects").select("*").eq("id", t.project_id).maybeSingle(),
      supabase.from("subtasks").select("*").eq("task_id", id).order("position"),
      supabase.from("checklist_items").select("*").eq("task_id", id).order("position"),
      supabase.from("task_activity").select("*").eq("task_id", id).order("created_at", { ascending: false }),
      supabase.from("tasks").select("id").eq("recurrence_parent_id", id).maybeSingle(),
    ]);
    setProject((p.data as Project) ?? null);
    setSubtasks((s.data as Subtask[]) ?? []);
    setChecklist((c.data as ChecklistItem[]) ?? []);
    setActivity((a.data as Activity[]) ?? []);
    setNextId(n.data?.id ?? null);
  }, [id]);

  useEffect(() => {
    load();
    if (isAdmin) supabase.from("projects").select("*").order("name").then(({ data }) => setProjects((data as Project[]) ?? []));
  }, [load, isAdmin]);
  useRealtime(["tasks", "subtasks", "checklist_items", "task_activity"], load, id);

  if (missing) {
    return (
      <div className="p-6">
        <p className="mb-4">This task doesn't exist or isn't assigned to you.</p>
        <button className="btn-primary" onClick={onClose}>Close</button>
      </div>
    );
  }
  if (!task) return <Spinner />;

  const update = async (patch: Partial<Task>) => {
    const prev = task;
    setTask({ ...task, ...patch });
    const { error } = await supabase.from("tasks").update(patch).eq("id", id);
    if (error) {
      setTask(prev);
      toast(errorMessage(error), "error");
    } else if (patch.status === "done" && task.recurrence !== "none") {
      toast("Done — next occurrence created ↻");
    }
  };

  const addNote = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!note.trim()) return;
    const { error } = await supabase.from("task_activity").insert({ task_id: id, type: "note", note: note.trim() });
    if (error) return toast(errorMessage(error), "error");
    setNote("");
    load();
  };

  const addItem = async (table: "subtasks" | "checklist_items", text: string, reset: () => void) => {
    if (!text.trim()) return;
    const row: Record<string, string> = table === "subtasks" ? { task_id: id, title: text.trim() } : { task_id: id, text: text.trim() };
    const { error } = await supabase.from(table).insert(row);
    if (error) return toast(errorMessage(error), "error");
    reset();
    load();
  };
  const toggleItem = async (table: "subtasks" | "checklist_items", itemId: string, is_done: boolean) => {
    // Optimistic: tick immediately, then confirm from the server.
    if (table === "subtasks") setSubtasks((xs) => xs.map((x) => (x.id === itemId ? { ...x, is_done } : x)));
    else setChecklist((xs) => xs.map((x) => (x.id === itemId ? { ...x, is_done } : x)));
    const { error } = await supabase.from(table).update({ is_done }).eq("id", itemId);
    if (error) toast(errorMessage(error), "error");
    load();
  };
  const removeItem = async (table: "subtasks" | "checklist_items", itemId: string) => {
    const { error } = await supabase.from(table).delete().eq("id", itemId);
    if (error) toast(errorMessage(error), "error");
    load();
  };
  const deleteTask = async () => {
    if (!confirm("Delete this task and its history? This cannot be undone.")) return;
    const { error } = await supabase.from("tasks").delete().eq("id", id);
    if (error) return toast(errorMessage(error), "error");
    toast("Task deleted");
    onClose();
  };

  const overdue = isOverdue(task);
  const assignable = people.filter((p) => p.is_active || p.id === task.assignee_id);

  return (
    <div>
      <div className="sticky top-0 z-10 flex items-center justify-between gap-2 border-b border-cream-200 bg-cream px-5 py-3">
        <div className="flex min-w-0 items-center gap-2 text-sm text-navy/60">
          {project && <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: project.color }} />}
          <Link to={`/projects/${task.project_id}`} className="truncate hover:underline" onClick={onClose}>
            {project?.name}
          </Link>
          {task.recurrence !== "none" && (
            <span className="chip bg-gold-50 text-gold-600"><IconRepeat className="h-3 w-3" />{task.recurrence}</span>
          )}
        </div>
        <button className="btn-ghost -mr-2 px-2" onClick={onClose} aria-label="Close">✕</button>
      </div>

      <div className="space-y-6 p-5">
        {/* Title & description */}
        {isAdmin ? (
          <div className="space-y-2">
            <input
              className="w-full bg-transparent text-xl font-bold outline-none focus:rounded focus:bg-white focus:px-2"
              value={draft.title}
              onChange={(e) => setDraft({ ...draft, title: e.target.value })}
              onBlur={() => draft.title.trim() && draft.title !== task.title && update({ title: draft.title.trim() })}
            />
            <textarea
              className="input min-h-20"
              placeholder="Add a description…"
              value={draft.description}
              onChange={(e) => setDraft({ ...draft, description: e.target.value })}
              onBlur={() => draft.description !== task.description && update({ description: draft.description })}
            />
          </div>
        ) : (
          <div>
            <h2 className="text-xl font-bold">{task.title}</h2>
            {task.description && <p className="mt-2 whitespace-pre-wrap text-sm text-navy/80">{task.description}</p>}
          </div>
        )}

        {/* Fields */}
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="label">Status</span>
            <select className="input" value={task.status} onChange={(e) => update({ status: e.target.value as Task["status"] })}>
              {STATUSES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="label">Assignee</span>
            <select
              className="input"
              disabled={!isAdmin}
              value={task.assignee_id ?? ""}
              onChange={(e) => update({ assignee_id: e.target.value || null })}
            >
              <option value="">Unassigned</option>
              {assignable.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="label">Due date {overdue && <span className="text-red-600">· overdue</span>}</span>
            <input
              type="date"
              className={`input ${overdue ? "border-red-400 text-red-700" : ""}`}
              disabled={!isAdmin}
              value={task.due_date ?? ""}
              onChange={(e) => update({ due_date: e.target.value || null })}
            />
          </label>
          <label className="block">
            <span className="label">Priority</span>
            <select className="input" disabled={!isAdmin} value={task.priority} onChange={(e) => update({ priority: e.target.value as Task["priority"] })}>
              {PRIORITIES.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="label">Repeat</span>
            <select
              className="input"
              disabled={!isAdmin}
              value={task.recurrence}
              onChange={(e) => update({ recurrence: e.target.value as Task["recurrence"] })}
            >
              {RECURRENCES.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
            </select>
          </label>
          {isAdmin && (
            <label className="block">
              <span className="label">Project</span>
              <select className="input" value={task.project_id} onChange={(e) => update({ project_id: e.target.value })}>
                {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </label>
          )}
        </div>
        {nextId && (
          <button className="text-sm font-semibold text-gold-600 hover:underline" onClick={() => openTask(nextId)}>
            ↻ Open next occurrence
          </button>
        )}

        {/* Subtasks */}
        <ItemList
          title="Subtasks"
          items={subtasks.map((s) => ({ id: s.id, text: s.title, is_done: s.is_done, extra: s.assignee_id ? personName(s.assignee_id) : null }))}
          canDelete={isAdmin}
          value={newSub}
          setValue={setNewSub}
          onAdd={() => addItem("subtasks", newSub, () => setNewSub(""))}
          onToggle={(i, v) => toggleItem("subtasks", i, v)}
          onRemove={(i) => removeItem("subtasks", i)}
        />

        {/* Checklist */}
        <ItemList
          title="Checklist"
          items={checklist.map((c) => ({ id: c.id, text: c.text, is_done: c.is_done, extra: null }))}
          canDelete={isAdmin}
          value={newCheck}
          setValue={setNewCheck}
          onAdd={() => addItem("checklist_items", newCheck, () => setNewCheck(""))}
          onToggle={(i, v) => toggleItem("checklist_items", i, v)}
          onRemove={(i) => removeItem("checklist_items", i)}
        />

        {/* Activity */}
        <section>
          <h3 className="label">Activity</h3>
          <form onSubmit={addNote} className="mb-4 flex gap-2">
            <textarea
              className="input min-h-11 flex-1"
              rows={1}
              placeholder="Add an update…"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
            <button className="btn-primary self-start" disabled={!note.trim()}>Post</button>
          </form>
          <ol className="space-y-3 border-l-2 border-cream-200 pl-4">
            {activity.map((a) => (
              <li key={a.id} className="relative">
                <span className={`absolute -left-[21px] top-1.5 h-2.5 w-2.5 rounded-full ${a.type === "note" ? "bg-gold" : "bg-navy/30"}`} />
                <div className="text-sm">
                  <span className="font-semibold">{a.actor_id ? personName(a.actor_id) : "System"}</span>{" "}
                  <ActivityText a={a} />
                </div>
                {a.note && <div className="mt-1 whitespace-pre-wrap rounded-lg bg-white p-2.5 text-sm ring-1 ring-black/5">{a.note}</div>}
                <div className="mt-0.5 text-xs text-navy/50">
                  {fmtDateTime(a.created_at)}{a.source === "telegram" && " · via Telegram"}
                </div>
              </li>
            ))}
          </ol>
        </section>

        <div className="flex items-center justify-between border-t border-cream-200 pt-4 text-xs text-navy/50">
          <span>
            Created {fmtDateTime(task.created_at)} by {personName(task.created_by)}
            {task.assignee_id === profile?.id && " · assigned to you"}
          </span>
          {isAdmin && <button className="font-semibold text-red-600 hover:underline" onClick={deleteTask}>Delete task</button>}
        </div>
      </div>
    </div>
  );
}

function ActivityText({ a }: { a: Activity }) {
  switch (a.type) {
    case "created": return <>created the task</>;
    case "status_changed": return <>moved it from <b>{statusLabel(a.from_value ?? "")}</b> to <b>{statusLabel(a.to_value ?? "")}</b></>;
    case "assigned": return a.to_value ? <>assigned it to <b>{a.to_value}</b></> : <>unassigned <b>{a.from_value}</b></>;
    case "due_changed": return a.to_value ? <>set the due date to <b>{fmtDate(a.to_value)}</b></> : <>removed the due date</>;
    case "note": return <>posted an update</>;
    case "subtask_done": return <>completed subtask <b>{a.to_value}</b></>;
    case "checklist_done": return <>ticked <b>{a.to_value}</b></>;
    case "photo": return <>added a photo</>;
  }
}

function ItemList(props: {
  title: string;
  items: { id: string; text: string; is_done: boolean; extra: string | null }[];
  canDelete: boolean;
  value: string;
  setValue: (v: string) => void;
  onAdd: () => void;
  onToggle: (id: string, v: boolean) => void;
  onRemove: (id: string) => void;
}) {
  const done = props.items.filter((i) => i.is_done).length;
  return (
    <section>
      <h3 className="label">
        {props.title} {props.items.length > 0 && <span className="normal-case">({done}/{props.items.length})</span>}
      </h3>
      <ul className="divide-y divide-cream-200 rounded-xl bg-white ring-1 ring-black/5">
        {props.items.map((i) => (
          <li key={i.id} className="group flex items-center gap-3 px-3 py-2">
            <input
              type="checkbox"
              className="h-5 w-5 accent-gold"
              checked={i.is_done}
              onChange={(e) => props.onToggle(i.id, e.target.checked)}
            />
            <span className={`flex-1 text-sm ${i.is_done ? "text-navy/40 line-through" : ""}`}>{i.text}</span>
            {i.extra && <span className="text-xs text-navy/50">{i.extra}</span>}
            {props.canDelete && (
              <button className="text-navy/30 hover:text-red-600" onClick={() => props.onRemove(i.id)} aria-label="Remove">✕</button>
            )}
          </li>
        ))}
        <li className="px-3 py-1.5">
          <form onSubmit={(e) => { e.preventDefault(); props.onAdd(); }}>
            <input
              className="w-full bg-transparent py-1 text-sm outline-none placeholder:text-navy/40"
              placeholder={`+ Add ${props.title === "Subtasks" ? "subtask" : "item"}`}
              value={props.value}
              onChange={(e) => props.setValue(e.target.value)}
            />
          </form>
        </li>
      </ul>
    </section>
  );
}
