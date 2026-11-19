import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Film, ListChecks, Scissors } from "lucide-react";
import { requirePageUser } from "@/server/auth/session";
import { getProjectDetail } from "@/server/services/projects";
import { HttpError } from "@/server/http";
import { ProjectActions } from "@/components/projects/project-actions";
import { StatusBadge } from "@/components/ui/status-badge";
import { formatRelative, JOB_STAGE_LABEL } from "@/lib/format";
import { VideoSection } from "@/components/video/video-section";
import { LiveRefresh } from "@/components/video/live-refresh";
import { RetryJobButton } from "@/components/video/job-actions";
import { ProgressBar } from "@/components/ui/progress-bar";
import { AnalysisProgress, AnalyzePanel } from "@/components/clips/analyze-panel";
import { ClipsSection } from "@/components/clips/clips-section";
import { TranscriptView } from "@/components/clips/transcript-view";
import { llmStatus, transcriptionStatus } from "@/server/providers/status";
import { db, schema } from "@/server/db";
import { eq } from "drizzle-orm";

const JOB_TYPE_LABEL: Record<string, string> = {
  import_url: "Importar desde enlace",
  analyze: "Analizar video",
  render_clip: "Renderizar clip",
  export_zip: "Exportar clips",
};

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
  const video = videos[0];
  const importJob = video ? jobs.find((j) => j.videoId === video.id && j.type === "import_url") : undefined;
  const transcript = video ? await db.query.transcripts.findFirst({ where: eq(schema.transcripts.videoId, video.id) }) : undefined;
  const analyzeJob = jobs.find((j) => j.type === "analyze");
  const analyzing = analyzeJob && (analyzeJob.status === "queued" || analyzeJob.status === "running") ? analyzeJob : undefined;
  const t = transcriptionStatus();
  const l = llmStatus();
  const services = { transcription: { ready: t.ready, provider: t.provider, missing: t.missing }, llm: { ready: l.ready, provider: l.provider, missing: l.missing } };
  const cl = project.settings.clipLength;
  const live = jobs.some((j) => j.status === "queued" || j.status === "running") || (video?.uploadStatus === "uploading" && video.source === "url");

  return (
    <>
      <LiveRefresh active={live} />
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
            <VideoSection projectId={project.id} video={video} importJob={importJob} />
          </section>

          {video?.uploadStatus === "uploaded" && (
            <section className="space-y-4">
              {analyzing ? (
                <AnalysisProgress job={{ id: analyzing.id, stage: analyzing.stage, progress: analyzing.progress, status: analyzing.status, params: analyzing.params }} />
              ) : (
                <>
                  {analyzeJob?.status === "failed" && (
                    <div role="alert" className="rounded-2xl border border-bad/30 bg-bad/10 p-4 text-sm">
                      <p className="font-medium text-bad">El último análisis falló</p>
                      <p className="mt-1 text-bad/90">{analyzeJob.error}</p>
                      <div className="mt-3"><RetryJobButton jobId={analyzeJob.id} /></div>
                    </div>
                  )}
                  {video.audioCodec ? (
                    <AnalyzePanel
                      projectId={project.id}
                      videoDuration={video.durationSec ?? 0}
                      hasTranscript={!!transcript}
                      hasClips={clips.length > 0}
                      services={services}
                      initial={{ preset: cl?.preset, minSec: cl?.minSec, maxSec: cl?.maxSec, maxClips: project.settings.maxClips, language: project.settings.language, aspectRatio: project.settings.aspectRatio, captionStyle: project.settings.captionStyle }}
                    />
                  ) : (
                    <p className="rounded-2xl border border-warn/30 bg-warn/5 p-4 text-sm text-warn">Este video no tiene audio: no se puede transcribir ni analizar. Puedes crear clips manuales.</p>
                  )}
                </>
              )}
            </section>
          )}

          <section className="rounded-3xl border border-line bg-surface p-5">
            <h2 className="font-display flex items-center gap-2 text-lg font-semibold">
              <Scissors className="size-5 text-ember-2" /> Clips
              <span className="text-sm font-normal text-faint">({clips.length})</span>
            </h2>
            {video?.uploadStatus === "uploaded" ? (
              <ClipsSection projectId={project.id} clips={clips} jobs={jobs} videoId={video.id} videoDuration={video.durationSec ?? 0} />
            ) : (
              <p className="mt-4 rounded-2xl border border-dashed border-line px-4 py-10 text-center text-sm text-muted">
                Importa un video para empezar.
              </p>
            )}
          </section>

          {transcript && (
            <TranscriptView
              segments={transcript.segments}
              provider={transcript.provider}
              model={transcript.model}
              language={transcript.language}
              wordCount={transcript.words.length}
            />
          )}
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
                <li key={j.id} className="rounded-xl bg-surface-2 px-3 py-2.5 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <span>{JOB_TYPE_LABEL[j.type] ?? j.type}</span>
                    <span className={j.status === "failed" ? "text-xs text-bad" : j.status === "completed" ? "text-xs text-ok" : "text-xs text-muted"}>
                      {j.status === "cancelled" ? "Cancelado" : JOB_STAGE_LABEL[j.stage]}
                    </span>
                  </div>
                  {(j.status === "running" || j.status === "queued") && <ProgressBar value={j.progress} className="mt-2 h-1.5" />}
                  {j.error && <p className="mt-1.5 text-xs text-bad">{j.error}</p>}
                  {j.status === "failed" && <div className="mt-2"><RetryJobButton jobId={j.id} /></div>}
                  <p className="mt-1 text-[11px] text-faint">{formatRelative(j.createdAt)}</p>
                </li>
              ))}
            </ul>
          )}
        </aside>
      </div>
    </>
  );
}
