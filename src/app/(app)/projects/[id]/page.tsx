import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Construction, Film, ListChecks, Scissors } from "lucide-react";
import { requirePageUser } from "@/server/auth/session";
import { getProjectDetail } from "@/server/services/projects";
import { HttpError } from "@/server/http";
import { ProjectActions } from "@/components/projects/project-actions";
import { StatusBadge } from "@/components/ui/status-badge";
import { formatRelative, JOB_STAGE_LABEL } from "@/lib/format";

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requirePageUser();
  let detail;
  try {
    detail = await getProjectDetail(user.id, id);
  } catch (e) {
    if (e instanceof HttpError && e.status === 404) notFound();
    throw e;
  }
  const { project, videos, clips, jobs } = detail;

  return (
    <>
      <div className="safe-top pt-4 md:pt-8">
        <Link href="/projects" className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-text">
          <ArrowLeft className="size-4" /> Proyectos
        </Link>
      </div>
      <header className="flex items-start justify-between gap-3 pb-6 pt-3">
        <div className="min-w-0">
          <h1 className="font-display break-words text-2xl font-semibold md:text-3xl">{project.name}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-faint">
            <StatusBadge status={project.status} />
            <span>Creado {formatRelative(project.createdAt)}</span>
          </div>
        </div>
        <ProjectActions project={{ id: project.id, name: project.name }} redirectOnDelete="/projects" />
      </header>

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <div className="space-y-6">
          <section className="rounded-3xl border border-line bg-surface p-5">
            <h2 className="font-display flex items-center gap-2 text-lg font-semibold">
              <Film className="size-5 text-ember-2" /> Video
            </h2>
            {videos.length === 0 ? (
              <div className="mt-4 flex gap-3 rounded-2xl border border-warn/30 bg-warn/5 p-4">
                <Construction className="mt-0.5 size-5 shrink-0 text-warn" />
                <div className="text-sm">
                  <p className="font-medium text-warn">Importación de video: pendiente (Fase 2)</p>
                  <p className="mt-1 text-muted">
                    La subida real de archivos con progreso, cancelación y validación de formato todavía no está
                    construida. Este proyecto ya está guardado en la base de datos y recibirá el video cuando esa fase
                    esté lista.
                  </p>
                </div>
              </div>
            ) : (
              <ul className="mt-4 space-y-2 text-sm">
                {videos.map((v) => (
                  <li key={v.id} className="rounded-xl bg-surface-2 px-3 py-2">{v.originalFilename}</li>
                ))}
              </ul>
            )}
          </section>

          <section className="rounded-3xl border border-line bg-surface p-5">
            <h2 className="font-display flex items-center gap-2 text-lg font-semibold">
              <Scissors className="size-5 text-ember-2" /> Clips
              <span className="text-sm font-normal text-faint">({clips.length})</span>
            </h2>
            {clips.length === 0 && (
              <p className="mt-4 rounded-2xl border border-dashed border-line px-4 py-10 text-center text-sm text-muted">
                Aún no hay clips. Aparecerán aquí después de analizar el video.
              </p>
            )}
          </section>
        </div>

        <aside className="rounded-3xl border border-line bg-surface p-5 lg:self-start">
          <h2 className="font-display flex items-center gap-2 text-lg font-semibold">
            <ListChecks className="size-5 text-ember-2" /> Trabajos
          </h2>
          {jobs.length === 0 ? (
            <p className="mt-3 text-sm text-faint">Sin trabajos de procesamiento todavía.</p>
          ) : (
            <ul className="mt-3 space-y-2">
              {jobs.map((j) => (
                <li key={j.id} className="rounded-xl bg-surface-2 px-3 py-2 text-sm">
                  {JOB_STAGE_LABEL[j.stage]} · {j.progress}%
                  {j.error && <p className="mt-1 text-xs text-bad">{j.error}</p>}
                </li>
              ))}
            </ul>
          )}
        </aside>
      </div>
    </>
  );
}
