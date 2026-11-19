"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState } from "react";
import { AlertTriangle, ChevronDown, Clock, Download, FileArchive, Loader2, Pencil, Play, Plus, RotateCcw, Trash2, Wand2, X } from "lucide-react";
import type { Clip, ExportOptions, Job } from "@/server/db/schema";
import { Button, buttonClass } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { ProgressBar } from "@/components/ui/progress-bar";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/cn";
import { formatDuration } from "@/lib/format";
import { DEFAULT_EXPORT_OPTS, ExportOptionsForm } from "./export-options";
import { ScoreBadge, ScoreBreakdown } from "./score-badge";

type Sort = "score" | "duration" | "chrono" | "topic";
const SORTS: { id: Sort; label: string }[] = [
  { id: "score", label: "Mayor puntuación" },
  { id: "chrono", label: "Orden cronológico" },
  { id: "duration", label: "Duración" },
  { id: "topic", label: "Tema" },
];

const STATUS: Record<string, { label: string; cls: string }> = {
  suggested: { label: "Sugerido", cls: "bg-surface-3 text-muted" },
  queued: { label: "En cola", cls: "bg-warn/10 text-warn" },
  rendering: { label: "Renderizando", cls: "bg-ember/15 text-ember-2" },
  ready: { label: "Listo", cls: "bg-ok/10 text-ok" },
  failed: { label: "Error", cls: "bg-bad/10 text-bad" },
};

export function ClipsSection({ projectId, clips, jobs, videoId, videoDuration }: { projectId: string; clips: Clip[]; jobs: Job[]; videoId: string; videoDuration: number }) {
  const router = useRouter();
  const [sort, setSort] = useState<Sort>("score");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [exportFor, setExportFor] = useState<string[] | null>(null);
  const [exportOpts, setExportOpts] = useState<ExportOptions>(DEFAULT_EXPORT_OPTS);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [manual, setManual] = useState(false);

  const lastJob = useMemo(() => {
    const m = new Map<string, Job>();
    for (const j of jobs) if (j.clipId && j.type === "render_clip" && !m.has(j.clipId)) m.set(j.clipId, j);
    return m;
  }, [jobs]);

  const sorted = useMemo(() => {
    const c = [...clips];
    if (sort === "score") c.sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
    if (sort === "chrono") c.sort((a, b) => a.startSec - b.startSec);
    if (sort === "duration") c.sort((a, b) => b.endSec - b.startSec - (a.endSec - a.startSec));
    if (sort === "topic") c.sort((a, b) => (a.topic ?? "~").localeCompare(b.topic ?? "~", "es") || (b.score ?? 0) - (a.score ?? 0));
    return c;
  }, [clips, sort]);

  const rank = useMemo(() => {
    const byScore = [...clips].filter((c) => c.score != null).sort((a, b) => b.score! - a.score!);
    return new Map(byScore.map((c, i) => [c.id, i + 1]));
  }, [clips]);

  const readyIds = clips.filter((c) => c.outputKey).map((c) => c.id);
  const selectedReady = [...selected].filter((id) => readyIds.includes(id));

  async function render(ids: string[]) {
    setBusy(true);
    setError(null);
    try {
      if (ids.length === 1) await api(`/api/clips/${ids[0]}/render`, { method: "POST", json: exportOpts });
      else {
        const r = await api<{ skipped: { reason: string }[] }>(`/api/projects/${projectId}/render`, { method: "POST", json: { clipIds: ids, exportOpts } });
        if (r.skipped.length) setError(`${r.skipped.length} clip(s) no se encolaron: ${r.skipped[0].reason}`);
      }
      setExportFor(null);
      setSelected(new Set());
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const toggle = (id: string) => setSelected((s) => {
    const n = new Set(s);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    return n;
  });

  return (
    <div>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-2 text-xs text-muted">
          Ordenar
          <select value={sort} onChange={(e) => setSort(e.target.value as Sort)} className="h-9 rounded-lg border border-line bg-surface-2 px-2 text-sm text-text">
            {SORTS.map((s) => (
              <option key={s.id} value={s.id}>{s.label}</option>
            ))}
          </select>
        </label>
        <div className="ml-auto flex flex-wrap gap-2">
          <Button size="sm" variant="ghost" onClick={() => setManual(true)}>
            <Plus className="size-3.5" /> Clip manual
          </Button>
          {clips.length > 0 && (
            <Button size="sm" variant="secondary" onClick={() => setExportFor(selected.size ? [...selected] : clips.map((c) => c.id))}>
              <Wand2 className="size-3.5" /> Generar {selected.size ? `${selected.size} seleccionados` : "todos"}
            </Button>
          )}
          {readyIds.length > 0 && (
            <a href={`/api/projects/${projectId}/export${selectedReady.length ? `?ids=${selectedReady.join(",")}` : ""}`} className={buttonClass("primary", "sm")}>
              <FileArchive className="size-3.5" /> Descargar {selectedReady.length ? `${selectedReady.length} seleccionados` : `todos (${readyIds.length})`} .zip
            </a>
          )}
        </div>
      </div>
      {error && <p role="alert" className="mt-3 rounded-xl border border-bad/30 bg-bad/10 p-3 text-sm text-bad">{error}</p>}

      {clips.length === 0 ? (
        <p className="mt-4 rounded-2xl border border-dashed border-line px-4 py-10 text-center text-sm text-muted">
          Aún no hay clips. Analiza el video o crea un clip manual.
        </p>
      ) : (
        <ul className="mt-4 space-y-3">
          {sorted.map((c) => (
            <ClipCard
              key={c.id}
              clip={c}
              rank={rank.get(c.id)}
              job={lastJob.get(c.id)}
              projectId={projectId}
              videoId={videoId}
              selected={selected.has(c.id)}
              onToggle={() => toggle(c.id)}
              onGenerate={() => setExportFor([c.id])}
            />
          ))}
        </ul>
      )}

      <Modal open={!!exportFor} onClose={() => setExportFor(null)} title={exportFor?.length === 1 ? "Generar clip" : `Generar ${exportFor?.length} clips`}>
        <ExportOptionsForm value={exportOpts} onChange={setExportOpts} />
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setExportFor(null)}>Cancelar</Button>
          <Button variant="primary" disabled={busy} onClick={() => exportFor && render(exportFor)}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Wand2 className="size-4" />} Generar
          </Button>
        </div>
      </Modal>

      <ManualClipModal open={manual} onClose={() => setManual(false)} projectId={projectId} duration={videoDuration} />
    </div>
  );
}

function ClipCard({
  clip,
  rank,
  job,
  projectId,
  videoId,
  selected,
  onToggle,
  onGenerate,
}: {
  clip: Clip;
  rank?: number;
  job?: Job;
  projectId: string;
  videoId: string;
  selected: boolean;
  onToggle: () => void;
  onGenerate: () => void;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const dur = clip.endSec - clip.startSec;
  const st = STATUS[clip.status] ?? STATUS.suggested;
  const active = clip.status === "queued" || clip.status === "rendering";
  const rendered = !!clip.outputKey;

  return (
    <li className={cn("overflow-hidden rounded-2xl border bg-surface-2 transition", selected ? "border-ember/60" : "border-line")}>
      <div className="flex gap-3 p-3 sm:p-4">
        <div className="flex shrink-0 flex-col items-center gap-2">
          <input type="checkbox" checked={selected} onChange={onToggle} aria-label={`Seleccionar ${clip.title}`} className="size-4 accent-[var(--ember)]" />
          <ScoreBadge score={clip.score} />
          {rank && <span className="text-[10px] text-faint">#{rank}</span>}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs tabular-nums text-faint">Clip {clip.position}</span>
            <span className={cn("rounded-full px-2 py-0.5 text-[11px]", st.cls)}>{st.label}</span>
            {clip.topic && <span className="rounded-full bg-ai/10 px-2 py-0.5 text-[11px] text-ai">{clip.topic}</span>}
          </div>
          <h3 className="mt-1 font-medium leading-snug">{clip.title}</h3>
          <p className="mt-1 flex flex-wrap items-center gap-x-3 text-xs tabular-nums text-muted">
            <span className="inline-flex items-center gap-1"><Clock className="size-3" /> {formatDuration(clip.startSec)} → {formatDuration(clip.endSec)}</span>
            <span>{dur.toFixed(1)} s</span>
          </p>
          {clip.reason && <p className="mt-2 text-sm text-muted">{clip.reason}</p>}
          {active && (
            <div className="mt-3">
              <div className="mb-1 flex justify-between text-[11px] text-muted">
                <span>{clip.status === "queued" ? "En cola" : "Renderizando"}</span>
                <span className="tabular-nums">{job?.progress ?? 0}%</span>
              </div>
              <ProgressBar value={job?.progress ?? 0} indeterminate={clip.status === "queued"} className="h-1.5" />
            </div>
          )}
          {clip.status === "failed" && job?.error && (
            <p className="mt-2 flex gap-1.5 text-xs text-bad"><AlertTriangle className="size-3.5 shrink-0" /> {job.error}</p>
          )}
          {rendered && clip.renderInfo && (
            <p className="mt-2 text-[11px] text-faint">
              {clip.renderInfo.width}×{clip.renderInfo.height} · {clip.renderInfo.fps} FPS · {clip.renderInfo.reframeNote}
              {clip.renderInfo.warnings.map((w) => ` · ${w}`)}
            </p>
          )}
          <div className="mt-3 flex flex-wrap gap-1.5">
            <Button size="sm" variant="secondary" onClick={() => setPreview((p) => !p)}>
              {preview ? <X className="size-3.5" /> : <Play className="size-3.5" />} Vista previa
            </Button>
            <Link href={`/projects/${projectId}/clips/${clip.id}`} className={buttonClass("secondary", "sm")}>
              <Pencil className="size-3.5" /> Editar
            </Link>
            <Button size="sm" variant={rendered ? "ghost" : "primary"} onClick={onGenerate} disabled={active}>
              {rendered ? <RotateCcw className="size-3.5" /> : <Wand2 className="size-3.5" />} {rendered ? "Regenerar" : "Generar"}
            </Button>
            {rendered && (
              <a href={`/api/media/clips/${clip.id}/video.mp4?download=1`} className={buttonClass("primary", "sm")}>
                <Download className="size-3.5" /> Descargar
              </a>
            )}
            <Button
              size="sm"
              variant="ghost"
              disabled={deleting}
              aria-label="Eliminar clip"
              onClick={async () => {
                if (!confirm(`¿Eliminar el clip «${clip.title}»?`)) return;
                setDeleting(true);
                await api(`/api/clips/${clip.id}`, { method: "DELETE" }).catch(() => {});
                router.refresh();
              }}
            >
              <Trash2 className="size-3.5 text-bad" />
            </Button>
            <button onClick={() => setOpen((o) => !o)} className="ml-auto inline-flex items-center gap-1 text-xs text-muted hover:text-text">
              Detalles <ChevronDown className={cn("size-3.5 transition", open && "rotate-180")} />
            </button>
          </div>
        </div>
      </div>
      {preview && (
        <div className="border-t border-line bg-black">
          {rendered ? (
            <video src={`/api/media/clips/${clip.id}/video.mp4?v=${clip.renderedAt}`} controls playsInline autoPlay className="mx-auto max-h-[70vh]" />
          ) : (
            <video
              ref={videoRef}
              src={`/api/media/videos/${videoId}/source#t=${clip.startSec},${clip.endSec}`}
              controls
              playsInline
              autoPlay
              onTimeUpdate={(e) => {
                if (e.currentTarget.currentTime >= clip.endSec) e.currentTarget.pause();
              }}
              className="mx-auto max-h-[60vh] w-full"
            />
          )}
          <p className="bg-surface-2 px-3 py-1.5 text-[11px] text-faint">
            {rendered ? "Clip renderizado." : "Tramo del video original (aún sin formato ni subtítulos: pulsa Generar)."}
          </p>
        </div>
      )}
      {open && (
        <div className="space-y-3 border-t border-line p-4">
          {clip.hook && (
            <p className="text-sm">
              <span className="text-xs text-faint">Gancho: </span>«{clip.hook}»
            </p>
          )}
          {clip.scoreBreakdown && (
            <div>
              <p className="mb-2 text-xs text-faint">Puntuación estimada por IA (no garantiza resultados)</p>
              <ScoreBreakdown breakdown={clip.scoreBreakdown} />
            </div>
          )}
          <div>
            <p className="mb-1 text-xs text-faint">Transcripción</p>
            <p className="max-h-48 overflow-y-auto rounded-xl bg-surface p-3 text-sm leading-relaxed text-muted">{clip.transcript || "—"}</p>
          </div>
          {rendered && clip.subtitleKey && (
            <a href={`/api/media/clips/${clip.id}/subtitles.srt?download=1`} className={buttonClass("ghost", "sm")}>
              <Download className="size-3.5" /> Subtítulos .srt
            </a>
          )}
        </div>
      )}
    </li>
  );
}

function ManualClipModal({ open, onClose, projectId, duration }: { open: boolean; onClose: () => void; projectId: string; duration: number }) {
  const router = useRouter();
  const [start, setStart] = useState("0");
  const [end, setEnd] = useState(String(Math.min(30, Math.floor(duration))));
  const [title, setTitle] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const parse = (v: string) => {
    const p = v.split(":").map(Number);
    return p.length === 2 ? p[0] * 60 + p[1] : p.length === 3 ? p[0] * 3600 + p[1] * 60 + p[2] : Number(v);
  };
  return (
    <Modal open={open} onClose={onClose} title="Crear clip manual">
      <form
        className="space-y-3"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError(null);
          try {
            const r = await api<{ clip: { id: string } }>(`/api/projects/${projectId}/clips`, { method: "POST", json: { startSec: parse(start), endSec: parse(end), title } });
            onClose();
            router.push(`/projects/${projectId}/clips/${r.clip.id}`);
          } catch (err) {
            setError((err as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <p className="text-xs text-muted">Formato: segundos (75) o mm:ss (1:15). Duración del video: {formatDuration(duration)}.</p>
        <div className="grid grid-cols-2 gap-2">
          <label className="text-xs text-muted">Inicio<input value={start} onChange={(e) => setStart(e.target.value)} className="mt-1 h-11 w-full rounded-xl border border-line bg-surface-2 px-3 text-base text-text md:text-sm" /></label>
          <label className="text-xs text-muted">Final<input value={end} onChange={(e) => setEnd(e.target.value)} className="mt-1 h-11 w-full rounded-xl border border-line bg-surface-2 px-3 text-base text-text md:text-sm" /></label>
        </div>
        <label className="block text-xs text-muted">Título (opcional)<input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} className="mt-1 h-11 w-full rounded-xl border border-line bg-surface-2 px-3 text-base text-text md:text-sm" /></label>
        {error && <p className="text-sm text-bad">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button type="submit" variant="primary" disabled={busy}>{busy && <Loader2 className="size-4 animate-spin" />} Crear y editar</Button>
        </div>
      </form>
    </Modal>
  );
}
