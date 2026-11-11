import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  DndContext, DragOverlay, KeyboardSensor, PointerSensor, TouchSensor, closestCorners,
  useDroppable, useSensor, useSensors, type DragEndEvent, type DragStartEvent,
} from "@dnd-kit/core";
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { subDays } from "date-fns";
import { useAuth } from "../lib/auth";
import { useRealtime } from "../lib/hooks";
import { errorMessage, supabase } from "../lib/supabase";
import { fmtDate, isOverdue } from "../lib/time";
import { STATUSES, type Project, type Task, type TaskStatus } from "../lib/types";
import { PriorityBadge } from "../components/badges";
import { IconPlus, IconRepeat } from "../components/icons";
import { NewTaskModal } from "../components/TaskForm";
import { useOpenTask } from "../components/TaskDrawer";
import { TaskFilters, useProjects, useTaskFilters } from "../components/TaskFilters";
import { PageHeader, Spinner, useToast } from "../components/ui";

const DONE_DAYS = 14;

export default function Board() {
  const { isAdmin } = useAuth();
  const toast = useToast();
  const projects = useProjects();
  const { project, assignee } = useTaskFilters();
  const [tasks, setTasks] = useState<Task[] | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [newIn, setNewIn] = useState<TaskStatus | null>(null);
  const dragging = useRef(false);
  const openTask = useOpenTask();

  const load = useCallback(async () => {
    if (dragging.current) return;
    let q = supabase.from("tasks").select("*")
      .or(`status.neq.done,completed_at.gte.${subDays(new Date(), DONE_DAYS).toISOString()}`);
    if (project) q = q.eq("project_id", project);
    if (assignee === "none") q = q.is("assignee_id", null);
    else if (assignee) q = q.eq("assignee_id", assignee);
    const { data, error } = await q.order("position");
    if (error) toast(errorMessage(error), "error");
    setTasks((data as Task[]) ?? []);
  }, [project, assignee, toast]);

  useEffect(() => { load(); }, [load]);
  useRealtime(["tasks"], load, "board");

  const columns = useMemo(() => {
    const m = Object.fromEntries(STATUSES.map((s) => [s.key, [] as Task[]])) as Record<TaskStatus, Task[]>;
    for (const t of tasks ?? []) m[t.status].push(t);
    for (const k of Object.keys(m) as TaskStatus[]) m[k].sort((a, b) => a.position - b.position);
    return m;
  }, [tasks]);
  const projectMap = useMemo(() => Object.fromEntries(projects.map((p) => [p.id, p])), [projects]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const onDragStart = (e: DragStartEvent) => {
    dragging.current = true;
    setActiveId(String(e.active.id));
  };

  const onDragEnd = async (e: DragEndEvent) => {
    dragging.current = false;
    setActiveId(null);
    const task = tasks?.find((t) => t.id === e.active.id);
    if (!task || !e.over) return;
    const overId = String(e.over.id);
    const overTask = tasks!.find((t) => t.id === overId);
    const toStatus = (overId.startsWith("col:") ? overId.slice(4) : overTask?.status) as TaskStatus | undefined;
    if (!toStatus) return;

    // Work out the new order in the target column and take a position between neighbours.
    let list: Task[];
    if (toStatus === task.status) {
      const col = columns[toStatus];
      const from = col.findIndex((t) => t.id === task.id);
      const to = overTask ? col.findIndex((t) => t.id === overTask.id) : col.length - 1;
      if (from === to) return;
      list = arrayMove(col, from, to);
    } else {
      list = [...columns[toStatus]];
      const at = overTask ? list.findIndex((t) => t.id === overTask.id) : list.length;
      list.splice(at, 0, task);
    }
    const i = list.findIndex((t) => t.id === task.id);
    const prev = list[i - 1]?.position;
    const next = list[i + 1]?.position;
    const position = prev !== undefined && next !== undefined ? (prev + next) / 2
      : prev !== undefined ? prev + 1 : next !== undefined ? next - 1 : 1;

    const patch = { status: toStatus, position };
    setTasks((ts) => ts!.map((t) => (t.id === task.id ? { ...t, ...patch } : t)));
    const { error } = await supabase.from("tasks").update(patch).eq("id", task.id);
    if (error) {
      toast(errorMessage(error), "error");
    } else if (toStatus === "done" && task.status !== "done" && task.recurrence !== "none") {
      toast("Done — next occurrence created ↻");
    }
    load();
  };

  const active = activeId ? tasks?.find((t) => t.id === activeId) : null;

  return (
    <div>
      <PageHeader
        title="Board"
        subtitle={isAdmin ? "Drag cards to change status or order." : "Your tasks. Drag a card to update its status."}
        actions={<TaskFilters projects={projects} />}
      />
      {!tasks ? <Spinner /> : (
        <DndContext sensors={sensors} collisionDetection={closestCorners} onDragStart={onDragStart} onDragEnd={onDragEnd}
          onDragCancel={() => { dragging.current = false; setActiveId(null); }}>
          <div className="-mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-4 md:mx-0 md:px-0">
            {STATUSES.map((s) => (
              <Column key={s.key} status={s.key} label={s.label} tasks={columns[s.key]}
                onAdd={isAdmin ? () => setNewIn(s.key) : undefined}>
                {columns[s.key].map((t) => (
                  <SortableCard key={t.id} task={t} project={projectMap[t.project_id]} onOpen={() => openTask(t.id)} />
                ))}
              </Column>
            ))}
          </div>
          <DragOverlay>{active && <Card task={active} project={projectMap[active.project_id]} overlay />}</DragOverlay>
        </DndContext>
      )}
      <p className="mt-1 text-xs text-navy/40">Done shows tasks completed in the last {DONE_DAYS} days.</p>
      <NewTaskModal open={!!newIn} onClose={() => setNewIn(null)}
        defaults={{ status: newIn ?? "todo", project_id: project || undefined, assignee_id: assignee && assignee !== "none" ? assignee : undefined }}
        onCreated={load} />
    </div>
  );
}

function Column({ status, label, tasks, children, onAdd }: { status: TaskStatus; label: string; tasks: Task[]; children: React.ReactNode; onAdd?: () => void }) {
  const { setNodeRef, isOver } = useDroppable({ id: `col:${status}` });
  return (
    <section className={`flex w-[82vw] max-w-72 shrink-0 snap-start flex-col rounded-xl p-2 sm:w-72 lg:w-auto lg:min-w-0 lg:max-w-none lg:flex-1 lg:shrink ${isOver ? "bg-gold-50" : "bg-cream-200/60"}`}>
      <header className="flex items-center justify-between px-1.5 pb-2 pt-1">
        <h2 className="text-sm font-bold">{label} <span className="font-normal text-navy/50">{tasks.length}</span></h2>
        {onAdd && <button className="rounded p-1 text-navy/50 hover:bg-white hover:text-navy" onClick={onAdd} aria-label={`Add task to ${label}`}><IconPlus className="h-4 w-4" /></button>}
      </header>
      <SortableContext items={tasks.map((t) => t.id)} strategy={verticalListSortingStrategy}>
        <div ref={setNodeRef} className="flex min-h-24 flex-1 flex-col gap-2">{children}</div>
      </SortableContext>
    </section>
  );
}

function SortableCard({ task, project, onOpen }: { task: Task; project?: Project; onOpen: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: task.id });
  return (
    <div ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }} {...attributes} {...listeners}
      className={isDragging ? "opacity-30" : ""} onClick={onOpen}>
      <Card task={task} project={project} />
    </div>
  );
}

function Card({ task, project, overlay }: { task: Task; project?: Project; overlay?: boolean }) {
  const { personName } = useAuth();
  const overdue = isOverdue(task);
  return (
    <div className={`cursor-grab touch-manipulation rounded-lg bg-white p-3 text-sm shadow-sm ring-1 ring-black/5 hover:ring-gold/60 ${overlay ? "rotate-2 shadow-xl" : ""}`}>
      <div className="mb-1 flex items-center gap-1.5 text-xs text-navy/50">
        <span className="h-2 w-2 rounded-full" style={{ background: project?.color ?? "#ccc" }} />
        <span className="truncate">{project?.name}</span>
      </div>
      <div className="flex items-start gap-1.5 font-semibold leading-snug">
        <span className="flex-1">{task.title}</span>
        {task.recurrence !== "none" && <IconRepeat className="mt-0.5 h-3.5 w-3.5 shrink-0 text-gold-600" />}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
        <PriorityBadge p={task.priority} />
        {task.due_date && (
          <span className={`chip ${overdue ? "bg-red-100 text-red-700" : "bg-cream text-navy/70"}`}>{fmtDate(task.due_date, "d MMM")}</span>
        )}
        <span className="ml-auto truncate text-navy/50">{task.assignee_id ? personName(task.assignee_id) : "Unassigned"}</span>
      </div>
    </div>
  );
}
