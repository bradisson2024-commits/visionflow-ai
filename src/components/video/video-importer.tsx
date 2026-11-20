"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, FileVideo, Link2, Loader2, RotateCcw, UploadCloud, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ProgressBar } from "@/components/ui/progress-bar";
import { cn } from "@/lib/cn";
import { formatBytes, formatDuration } from "@/lib/format";
import { ACCEPT_ATTR, checkVideoFile, CHUNK_SIZE, DEFAULT_AUTO_ANALYZE, platformOf } from "@/lib/media-rules";

type LocalMeta = { duration: number | null; width: number | null; height: number | null };
type Phase =
  | { kind: "idle" }
  | { kind: "uploading"; sent: number; total: number; speed: number }
  | { kind: "verifying" }
  | { kind: "error"; message: string };

/** Subida de una parte con progreso, abortable. */
function putChunk(url: string, blob: Blob, onProgress: (loaded: number) => void, xhrRef: React.RefObject<XMLHttpRequest | null>) {
  return new Promise<{ status: number; body: Record<string, unknown> }>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhrRef.current = xhr;
    xhr.open("PUT", url);
    xhr.setRequestHeader("content-type", "application/octet-stream");
    xhr.upload.onprogress = (e) => onProgress(e.loaded);
    xhr.onload = () => {
      let body: Record<string, unknown> = {};
      try {
        body = JSON.parse(xhr.responseText);
      } catch {}
      resolve({ status: xhr.status, body });
    };
    xhr.onerror = () => reject(new Error("Error de red durante la subida."));
    xhr.onabort = () => reject(new DOMException("Cancelado", "AbortError"));
    xhr.send(blob);
  });
}

function readLocalMeta(url: string): Promise<LocalMeta> {
  return new Promise((resolve) => {
    const v = document.createElement("video");
    v.preload = "metadata";
    v.muted = true;
    const done = (m: LocalMeta) => {
      v.removeAttribute("src");
      v.load();
      resolve(m);
    };
    v.onloadedmetadata = () => done({ duration: Number.isFinite(v.duration) ? v.duration : null, width: v.videoWidth || null, height: v.videoHeight || null });
    v.onerror = () => done({ duration: null, width: null, height: null });
    setTimeout(() => done({ duration: null, width: null, height: null }), 8000);
    v.src = url;
  });
}

export function VideoImporter({
  projectId,
  maxUploadMb,
  resume,
}: {
  projectId: string;
  maxUploadMb: number;
  /** Subida previa sin terminar que se puede continuar eligiendo el mismo archivo. */
  resume?: { videoId: string; filename: string; sizeBytes: number; receivedBytes: number };
}) {
  const router = useRouter();
  const [tab, setTab] = useState<"file" | "link">("file");
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [meta, setMeta] = useState<LocalMeta | null>(null);
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [dragging, setDragging] = useState(false);
  const [link, setLink] = useState("");
  const [linkBusy, setLinkBusy] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [rights, setRights] = useState(false);
  const [autoAnalyze, setAutoAnalyze] = useState(true);
  const linkPlatform = platformOf(link);
  const inputRef = useRef<HTMLInputElement>(null);
  const xhrRef = useRef<XMLHttpRequest | null>(null);
  const cancelledRef = useRef(false);
  const videoIdRef = useRef<string | null>(null);

  useEffect(() => () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
  }, [previewUrl]);

  const upload = useCallback(
    async (f: File) => {
      cancelledRef.current = false;
      setPhase({ kind: "uploading", sent: 0, total: f.size, speed: 0 });
      try {
        let videoId: string;
        let offset = 0;
        if (resume && resume.filename === f.name && resume.sizeBytes === f.size) {
          videoId = resume.videoId;
          const r = await fetch(`/api/uploads/${videoId}`);
          const b = await r.json();
          if (!r.ok) throw new Error(b.error ?? "No se pudo reanudar la subida.");
          offset = b.video.receivedBytes;
        } else {
          const r = await fetch(`/api/projects/${projectId}/uploads`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ filename: f.name, size: f.size, mimeType: f.type || undefined }),
          });
          const b = await r.json();
          if (!r.ok) throw new Error(b.error ?? "No se pudo iniciar la subida.");
          videoId = b.video.id;
          router.refresh(); // el proyecto pasa a "Video subiendo"
        }
        videoIdRef.current = videoId;

        const started = performance.now();
        const startOffset = offset;
        let failures = 0;
        while (offset < f.size) {
          if (cancelledRef.current) return;
          const end = Math.min(offset + CHUNK_SIZE, f.size);
          const base = offset;
          try {
            const { status, body } = await putChunk(
              `/api/uploads/${videoId}?offset=${offset}`,
              f.slice(offset, end),
              (loaded) => {
                const sent = base + loaded;
                const secs = (performance.now() - started) / 1000;
                setPhase({ kind: "uploading", sent, total: f.size, speed: secs > 0.5 ? (sent - startOffset) / secs : 0 });
              },
              xhrRef,
            );
            if (status === 409 && body.details && typeof (body.details as { expectedOffset?: number }).expectedOffset === "number") {
              offset = (body.details as { expectedOffset: number }).expectedOffset; // re-sincroniza
              continue;
            }
            if (status < 200 || status >= 300) throw Object.assign(new Error(String(body.error ?? `Error ${status}`)), { fatal: status < 500 });
            offset = Number(body.receivedBytes);
            failures = 0;
          } catch (err) {
            if ((err as Error).name === "AbortError" || cancelledRef.current) return;
            if ((err as { fatal?: boolean }).fatal || ++failures > 4) throw err;
            await new Promise((r) => setTimeout(r, 1000 * 2 ** failures)); // reintento con espera
          }
        }
        setPhase({ kind: "verifying" });
        const r = await fetch(`/api/uploads/${videoId}/complete`, { method: "POST" });
        const b = await r.json();
        if (!r.ok) throw new Error(b.error ?? "El servidor no pudo procesar el video.");
        router.refresh();
      } catch (err) {
        if (!cancelledRef.current) setPhase({ kind: "error", message: (err as Error).message });
        router.refresh();
      }
    },
    [projectId, resume, router],
  );

  async function choose(f: File | undefined | null) {
    if (!f) return;
    const problem = checkVideoFile(f.name, f.size, maxUploadMb);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setFile(f);
    setMeta(null);
    if (problem) {
      setPreviewUrl(null);
      setPhase({ kind: "error", message: problem });
      return;
    }
    const url = URL.createObjectURL(f);
    setPreviewUrl(url);
    readLocalMeta(url).then(setMeta);
    upload(f);
  }

  async function cancel() {
    cancelledRef.current = true;
    xhrRef.current?.abort();
    const id = videoIdRef.current ?? resume?.videoId;
    if (id) await fetch(`/api/uploads/${id}`, { method: "DELETE" });
    setPhase({ kind: "idle" });
    setFile(null);
    setPreviewUrl(null);
    videoIdRef.current = null;
    router.refresh();
  }

  async function importLink(e: React.FormEvent) {
    e.preventDefault();
    setLinkBusy(true);
    setLinkError(null);
    const r = await fetch(`/api/projects/${projectId}/imports`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: link, confirmRights: rights, autoAnalyze: autoAnalyze ? DEFAULT_AUTO_ANALYZE : undefined }),
    });
    const b = await r.json().catch(() => ({}));
    setLinkBusy(false);
    if (!r.ok) {
      setLinkError(b.error ?? "No se pudo importar el enlace.");
      return;
    }
    router.refresh();
  }

  const busy = phase.kind === "uploading" || phase.kind === "verifying";

  /* ── Archivo seleccionado: vista previa + progreso ── */
  if (file && phase.kind !== "idle") {
    const pct = phase.kind === "uploading" ? (phase.sent / phase.total) * 100 : phase.kind === "verifying" ? 100 : 0;
    const eta = phase.kind === "uploading" && phase.speed > 0 ? (phase.total - phase.sent) / phase.speed : null;
    return (
      <div className="mt-4 overflow-hidden rounded-2xl border border-line bg-surface-2">
        <div className="flex flex-col sm:flex-row">
          <div className="relative aspect-video w-full shrink-0 bg-black sm:w-64">
            {previewUrl ? (
              <video src={previewUrl} muted playsInline controls className="size-full object-contain" />
            ) : (
              <div className="grid size-full place-items-center">
                <FileVideo className="size-8 text-faint" />
              </div>
            )}
          </div>
          <div className="min-w-0 flex-1 p-4">
            <p className="truncate font-medium" title={file.name}>{file.name}</p>
            <dl className="mt-2 grid grid-cols-3 gap-2 text-xs">
              <div><dt className="text-faint">Tamaño</dt><dd className="tabular-nums">{formatBytes(file.size)}</dd></div>
              <div><dt className="text-faint">Duración</dt><dd className="tabular-nums">{meta ? formatDuration(meta.duration) : "…"}</dd></div>
              <div><dt className="text-faint">Resolución</dt><dd className="tabular-nums">{meta?.width ? `${meta.width}×${meta.height}` : meta ? "—" : "…"}</dd></div>
            </dl>
            {meta && !meta.duration && phase.kind !== "error" && (
              <p className="mt-2 text-[11px] text-faint">El navegador no puede leer este formato; el servidor lo verificará al terminar.</p>
            )}

            {phase.kind === "error" ? (
              <div className="mt-3 flex items-start gap-2 rounded-xl border border-bad/30 bg-bad/10 p-3 text-sm text-bad" role="alert">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                <span>{phase.message}</span>
              </div>
            ) : (
              <div className="mt-4">
                <div className="mb-1.5 flex justify-between text-xs">
                  <span className="text-muted">{phase.kind === "verifying" ? "Verificando video en el servidor…" : "Subiendo…"}</span>
                  <span className="tabular-nums">{Math.floor(pct)}%</span>
                </div>
                <ProgressBar value={pct} indeterminate={phase.kind === "verifying"} />
                {phase.kind === "uploading" && (
                  <p className="mt-1.5 text-[11px] tabular-nums text-faint">
                    {formatBytes(phase.sent)} de {formatBytes(phase.total)}
                    {phase.speed > 0 && ` · ${formatBytes(phase.speed)}/s`}
                    {eta != null && ` · quedan ${formatDuration(eta)}`}
                  </p>
                )}
              </div>
            )}
            <div className="mt-4 flex gap-2">
              {busy && phase.kind === "uploading" && (
                <Button size="sm" variant="danger" onClick={cancel}>
                  <X className="size-3.5" /> Cancelar
                </Button>
              )}
              {phase.kind === "error" && (
                <>
                  <Button size="sm" variant="secondary" onClick={() => { setFile(null); setPhase({ kind: "idle" }); }}>
                    Elegir otro archivo
                  </Button>
                  {!checkVideoFile(file.name, file.size, maxUploadMb) && (
                    <Button size="sm" variant="ghost" onClick={() => upload(file)}>
                      <RotateCcw className="size-3.5" /> Reintentar
                    </Button>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  /* ── Selección: archivo o enlace ── */
  return (
    <div className="mt-4">
      {resume && (
        <div className="mb-3 rounded-xl border border-warn/30 bg-warn/5 p-3 text-sm">
          <p className="text-warn">Subida sin terminar: {resume.filename} ({Math.floor((resume.receivedBytes / resume.sizeBytes) * 100)}%)</p>
          <p className="mt-1 text-xs text-muted">Vuelve a elegir el mismo archivo para continuar donde se quedó, o elige otro para empezar de nuevo.</p>
          <Button size="sm" variant="ghost" className="mt-2" onClick={cancel}>Descartar subida</Button>
        </div>
      )}
      <div role="tablist" className="mb-3 inline-flex rounded-xl border border-line bg-surface-2 p-1 text-sm">
        {(
          [
            ["file", "Subir archivo", UploadCloud],
            ["link", "Pegar enlace", Link2],
          ] as const
        ).map(([id, label, Icon]) => (
          <button
            key={id}
            role="tab"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
            className={cn("inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 transition", tab === id ? "bg-surface-3 text-text" : "text-muted hover:text-text")}
          >
            <Icon className="size-4" /> {label}
          </button>
        ))}
      </div>

      {tab === "file" ? (
        <label
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            choose(e.dataTransfer.files?.[0]);
          }}
          className={cn(
            "flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed px-6 py-10 text-center transition",
            dragging ? "border-ember bg-ember/5" : "border-line hover:border-line-strong hover:bg-surface-2",
          )}
        >
          <span className="forge-gradient grid size-14 place-items-center rounded-2xl text-black">
            <UploadCloud className="size-7" />
          </span>
          <span className="mt-4 font-medium">
            <span className="hidden sm:inline">Arrastra tu video aquí o </span>
            <span className="text-ember-2">elige un archivo</span>
          </span>
          <span className="mt-1 text-xs text-faint">MP4, MOV, M4V, WEBM, MKV o AVI · hasta {maxUploadMb >= 1024 ? `${Math.round(maxUploadMb / 1024)} GB` : `${maxUploadMb} MB`}</span>
          <input
            ref={inputRef}
            type="file"
            accept={ACCEPT_ATTR}
            className="sr-only"
            onChange={(e) => {
              choose(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
        </label>
      ) : (
        <form onSubmit={importLink} className="rounded-2xl border border-line bg-surface-2 p-4">
          <label htmlFor="video-link" className="text-sm font-medium">Enlace del video</label>
          <p className="mt-1 text-xs text-faint">
            YouTube (también Shorts), TikTok, Instagram, Vimeo… o un archivo en Google Drive, Dropbox o tu servidor.
          </p>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row">
            <input
              id="video-link"
              type="url"
              inputMode="url"
              required
              value={link}
              onChange={(e) => setLink(e.target.value)}
              placeholder="https://…/mi-video.mp4"
              className="h-11 w-full rounded-xl border border-line bg-surface px-3 text-base outline-none focus:border-ember/60 md:text-sm"
            />
            <Button type="submit" variant="primary" disabled={linkBusy || !link.trim() || (!!linkPlatform && !rights)}>
              {linkBusy ? <Loader2 className="size-4 animate-spin" /> : <Link2 className="size-4" />} Importar
            </Button>
          </div>
          {linkPlatform && (
            <label className="mt-3 flex items-start gap-2 text-xs text-muted">
              <input type="checkbox" checked={rights} onChange={(e) => setRights(e.target.checked)} className="mt-0.5 size-4 shrink-0 accent-[var(--ember)]" />
              Confirmo que tengo derecho a usar este video de {linkPlatform} (es mío o tengo permiso). Descargarlo puede ir contra los términos de {linkPlatform}: la responsabilidad es mía.
            </label>
          )}
          <label className="mt-2 flex items-center gap-2 text-xs text-muted">
            <input type="checkbox" checked={autoAnalyze} onChange={(e) => setAutoAnalyze(e.target.checked)} className="size-4 accent-[var(--ember)]" />
            Buscar los clips más virales automáticamente al terminar (30–60 s, 9:16, subtítulos virales)
          </label>
          {linkError && (
            <p role="alert" className="mt-3 flex items-start gap-2 rounded-xl border border-bad/30 bg-bad/10 p-3 text-sm text-bad">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" /> {linkError}
            </p>
          )}
        </form>
      )}
    </div>
  );
}
