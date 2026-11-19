import { AlertTriangle, Download, Info, Link2, Sparkles } from "lucide-react";
import type { Job, Video } from "@/server/db/schema";
import { env } from "@/server/env";
import { buttonClass } from "@/components/ui/button";
import { ProgressBar } from "@/components/ui/progress-bar";
import { formatBytes, formatDuration, JOB_STAGE_LABEL } from "@/lib/format";
import { VideoImporter } from "./video-importer";
import { CancelImportButton, RetryJobButton } from "./job-actions";
import { ReplaceVideo } from "./replace-video";

function Meta({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-xl bg-surface-2 px-3 py-2">
      <dt className="text-[11px] text-faint">{label}</dt>
      <dd className="mt-0.5 truncate text-sm tabular-nums">{value}</dd>
    </div>
  );
}

export function VideoSection({ projectId, video, importJob }: { projectId: string; video: Video | undefined; importJob: Job | undefined }) {
  const max = env.MAX_UPLOAD_MB;

  if (!video) return <VideoImporter projectId={projectId} maxUploadMb={max} />;

  /* Subida desde el navegador sin terminar: se puede reanudar. */
  if (video.uploadStatus === "uploading" && video.source === "upload")
    return (
      <VideoImporter
        projectId={projectId}
        maxUploadMb={max}
        resume={{ videoId: video.id, filename: video.originalFilename, sizeBytes: video.sizeBytes, receivedBytes: video.receivedBytes }}
      />
    );

  /* Importación por enlace en curso (la ejecuta el worker). */
  if (video.uploadStatus === "uploading" && video.source === "url") {
    const pct = importJob?.progress ?? 0;
    return (
      <div className="mt-4 rounded-2xl border border-line bg-surface-2 p-4">
        <p className="flex items-center gap-2 text-sm font-medium">
          <Link2 className="size-4 text-ai" /> Importando desde enlace
        </p>
        <p className="mt-1 truncate text-xs text-faint" title={video.sourceUrl ?? ""}>{video.sourceUrl}</p>
        <div className="mb-1.5 mt-4 flex justify-between text-xs">
          <span className="text-muted">{importJob ? JOB_STAGE_LABEL[importJob.stage] : "En cola"}</span>
          <span className="tabular-nums">{pct}%</span>
        </div>
        <ProgressBar value={pct} indeterminate={!importJob || importJob.stage === "queued" || importJob.stage === "probing"} />
        <p className="mt-1.5 text-[11px] tabular-nums text-faint">
          {formatBytes(video.receivedBytes)}
          {video.sizeBytes > video.receivedBytes && ` de ${formatBytes(video.sizeBytes)}`}
          {importJob?.stage === "queued" && " · esperando al procesador (worker)"}
        </p>
        <div className="mt-4">
          <CancelImportButton videoId={video.id} />
        </div>
      </div>
    );
  }

  /* Error de importación. */
  if (video.uploadStatus === "failed")
    return (
      <div className="mt-4 space-y-4">
        <div role="alert" className="rounded-2xl border border-bad/30 bg-bad/10 p-4 text-sm">
          <p className="flex items-center gap-2 font-medium text-bad">
            <AlertTriangle className="size-4" /> No se pudo importar «{video.originalFilename}»
          </p>
          <p className="mt-1 text-bad/90">{video.error ?? importJob?.error ?? "Error desconocido."}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {importJob?.status === "failed" && <RetryJobButton jobId={importJob.id} />}
            <CancelImportButton videoId={video.id} label="Descartar" />
          </div>
        </div>
      </div>
    );

  /* Video listo. */
  const src = `/api/media/videos/${video.id}/source`;
  return (
    <div className="mt-4">
      <div className="overflow-hidden rounded-2xl border border-line bg-black">
        <video
          key={video.id}
          src={src}
          poster={video.thumbnailKey ? `/api/media/videos/${video.id}/thumbnail` : undefined}
          controls
          playsInline
          preload="metadata"
          className="mx-auto max-h-[60vh] w-full"
        />
      </div>
      <p className="mt-3 truncate font-medium" title={video.originalFilename}>{video.originalFilename}</p>
      <dl className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Meta label="Duración" value={formatDuration(video.durationSec)} />
        <Meta label="Resolución" value={video.width ? `${video.width}×${video.height}` : "—"} />
        <Meta label="Tamaño" value={formatBytes(video.sizeBytes)} />
        <Meta label="FPS" value={video.fps ?? "—"} />
        <Meta label="Video" value={video.videoCodec ?? "—"} />
        <Meta label="Audio" value={video.audioCodec ?? "sin audio"} />
        <Meta label="Origen" value={video.source === "url" ? "Enlace" : "Archivo"} />
        <Meta label="Orientación" value={video.width && video.height ? (video.width > video.height ? "Horizontal" : video.width < video.height ? "Vertical" : "Cuadrado") : "—"} />
      </dl>
      {video.error && (
        <p className="mt-3 flex items-start gap-2 rounded-xl border border-warn/30 bg-warn/5 p-3 text-sm text-warn">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" /> {video.error}
        </p>
      )}
      <div className="mt-4 flex flex-wrap gap-2">
        <a href={`${src}?download=1`} className={buttonClass("secondary", "sm")}>
          <Download className="size-3.5" /> Descargar original
        </a>
        <ReplaceVideo projectId={projectId} maxUploadMb={max} />
      </div>
      <div className="mt-5 flex gap-3 rounded-2xl border border-line bg-surface-2 p-4">
        <Sparkles className="mt-0.5 size-5 shrink-0 text-ai" />
        <div className="text-sm">
          <p className="font-medium">Siguiente paso: analizar con IA <span className="ml-1 rounded bg-warn/10 px-1.5 py-0.5 text-[11px] text-warn">pendiente · Fase 3</span></p>
          <p className="mt-1 text-muted">
            El análisis transcribirá el audio, detectará los momentos con más potencial y propondrá clips ordenados por
            puntuación. Aún no está construido, por eso no hay botón de analizar.
          </p>
        </div>
      </div>
      <p className="mt-3 flex items-center gap-1.5 text-[11px] text-faint">
        <Info className="size-3" /> Metadatos leídos del archivo con FFprobe en el servidor.
      </p>
    </div>
  );
}
