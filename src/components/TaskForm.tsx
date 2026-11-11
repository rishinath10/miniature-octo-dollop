import { useEffect, useState } from "react";
import { useAuth } from "../lib/auth";
import { errorMessage, supabase } from "../lib/supabase";
import { PRIORITIES, RECURRENCES, STATUSES, type Priority, type Project, type Recurrence, type TaskStatus } from "../lib/types";
import { Field, Modal, useToast } from "./ui";

/** Admin-only: create a task. */
export function NewTaskModal({
  open, onClose, defaults = {}, onCreated,
}: {
  open: boolean;
  onClose: () => void;
  defaults?: { project_id?: string; status?: TaskStatus; due_date?: string; assignee_id?: string };
  onCreated?: (id: string) => void;
}) {
  const { people } = useAuth();
  const toast = useToast();
  const [projects, setProjects] = useState<Project[]>([]);
  const [busy, setBusy] = useState(false);
  const blank = () => ({
    project_id: defaults.project_id ?? "",
    title: "",
    description: "",
    assignee_id: defaults.assignee_id ?? "",
    status: defaults.status ?? ("todo" as TaskStatus),
    priority: "normal" as Priority,
    due_date: defaults.due_date ?? "",
    recurrence: "none" as Recurrence,
  });
  const [f, setF] = useState(blank);

  useEffect(() => {
    if (!open) return;
    setF(blank());
    supabase.from("projects").select("*").in("status", ["active", "on_hold"]).order("name").then(({ data }) => {
      setProjects((data as Project[]) ?? []);
      if (!defaults.project_id && data?.length) setF((x) => ({ ...x, project_id: x.project_id || data[0].id }));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (f.recurrence !== "none" && !f.due_date) {
      toast("A repeating task needs a due date", "error");
      return;
    }
    setBusy(true);
    const { data, error } = await supabase
      .from("tasks")
      .insert({
        ...f,
        title: f.title.trim(),
        assignee_id: f.assignee_id || null,
        due_date: f.due_date || null,
      })
      .select("id")
      .single();
    setBusy(false);
    if (error) return toast(errorMessage(error), "error");
    toast("Task created");
    onCreated?.(data.id);
    onClose();
  };

  const set = <K extends keyof ReturnType<typeof blank>>(k: K, v: ReturnType<typeof blank>[K]) => setF((x) => ({ ...x, [k]: v }));
  const assignable = people.filter((p) => p.is_active);

  return (
    <Modal open={open} onClose={onClose} title="New task">
      {projects.length === 0 ? (
        <p className="text-sm text-navy/70">Create a project first, then add tasks to it.</p>
      ) : (
        <form onSubmit={save} className="space-y-3">
          <Field label="Title">
            <input className="input" required autoFocus value={f.title} onChange={(e) => set("title", e.target.value)} />
          </Field>
          <Field label="Project">
            <select className="input" required value={f.project_id} onChange={(e) => set("project_id", e.target.value)}>
              {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </Field>
          <Field label="Description">
            <textarea className="input min-h-20" value={f.description} onChange={(e) => set("description", e.target.value)} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Assignee">
              <select className="input" value={f.assignee_id} onChange={(e) => set("assignee_id", e.target.value)}>
                <option value="">Unassigned</option>
                {assignable.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
              </select>
            </Field>
            <Field label="Due date">
              <input type="date" className="input" value={f.due_date} onChange={(e) => set("due_date", e.target.value)} />
            </Field>
            <Field label="Priority">
              <select className="input" value={f.priority} onChange={(e) => set("priority", e.target.value as Priority)}>
                {PRIORITIES.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
              </select>
            </Field>
            <Field label="Status">
              <select className="input" value={f.status} onChange={(e) => set("status", e.target.value as TaskStatus)}>
                {STATUSES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
              </select>
            </Field>
          </div>
          <Field label="Repeat">
            <select className="input" value={f.recurrence} onChange={(e) => set("recurrence", e.target.value as Recurrence)}>
              {RECURRENCES.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
            </select>
          </Field>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
            <button className="btn-primary" disabled={busy}>{busy ? "Saving…" : "Create task"}</button>
          </div>
        </form>
      )}
    </Modal>
  );
}
