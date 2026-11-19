"use client";

import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { ProjectCard, type ProjectSummary } from "./project-card";

export function ProjectsList({ projects }: { projects: ProjectSummary[] }) {
  const [q, setQ] = useState("");
  const filtered = useMemo(
    () => projects.filter((p) => p.name.toLowerCase().includes(q.trim().toLowerCase())),
    [projects, q],
  );
  return (
    <>
      <div className="relative mb-4 max-w-sm">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-faint" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Buscar proyectos"
          aria-label="Buscar proyectos"
          className="h-11 w-full rounded-xl border border-line bg-surface-2 pl-9 pr-3 text-base outline-none focus:border-ember/60 md:text-sm"
        />
      </div>
      {filtered.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-line px-6 py-12 text-center text-sm text-muted">
          {projects.length === 0 ? "Todavía no tienes proyectos." : "Ningún proyecto coincide con la búsqueda."}
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {filtered.map((p) => (
            <ProjectCard key={p.id} p={p} />
          ))}
        </div>
      )}
    </>
  );
}
