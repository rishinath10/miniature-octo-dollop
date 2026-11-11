import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { supabase } from "../lib/supabase";
import type { Project } from "../lib/types";

/** Project + assignee filters kept in the URL (?project=…&assignee=…). */
export function useTaskFilters() {
  const [params, setParams] = useSearchParams();
  const project = params.get("project") ?? "";
  const assignee = params.get("assignee") ?? "";
  const set = (k: "project" | "assignee", v: string) => {
    const p = new URLSearchParams(params);
    if (v) p.set(k, v);
    else p.delete(k);
    setParams(p, { replace: true });
  };
  return { project, assignee, set };
}

export function TaskFilters({ projects }: { projects: Project[] }) {
  const { isAdmin, people } = useAuth();
  const { project, assignee, set } = useTaskFilters();
  return (
    <div className="flex flex-wrap gap-2">
      <select className="input w-auto py-1.5 text-sm" value={project} onChange={(e) => set("project", e.target.value)} aria-label="Project">
        <option value="">All projects</option>
        {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select>
      {isAdmin && (
        <select className="input w-auto py-1.5 text-sm" value={assignee} onChange={(e) => set("assignee", e.target.value)} aria-label="Assignee">
          <option value="">Everyone</option>
          <option value="none">Unassigned</option>
          {people.filter((p) => p.is_active).map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
        </select>
      )}
    </div>
  );
}

export function useProjects() {
  const [projects, setProjects] = useState<Project[]>([]);
  useEffect(() => {
    supabase.from("projects").select("*").order("name").then(({ data }) => setProjects((data as Project[]) ?? []));
  }, []);
  return projects;
}
