"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, ArrowLeft, Check, Download, Loader2, Pause, Play, RotateCcw, Save, Volume2, VolumeX, Wand2 } from "lucide-react";
import type { AspectRatio, CaptionStyle, Clip, ClipEdit, ExportOptions, Job, TranscriptWord, Video } from "@/server/db/schema";
import { cropBox } from "@/server/render/reframe";
import { groupLines } from "@/server/render/subtitles";
import { Button, buttonClass } from "@/components/ui/button";
import { ProgressBar } from "@/components/ui/progress-bar";
import { ScoreBadge } from "@/components/clips/score-badge";
import { DEFAULT_EXPORT_OPTS, ExportOptionsForm } from "@/components/clips/export-options";
import { api } from "@/lib/api-client";
import { ASPECTS, CAPTION_FONTS, CAPTION_PRESETS } from "@/lib/captions";
import { cn } from "@/lib/cn";
import { JOB_STAGE_LABEL } from "@/lib/format";

type Props = {
  clip: Clip & { edit: ClipEdit };
  video: Video;
  project: { id: string; name: string };
  lastJob: Job | null;
  transcriptWords: TranscriptWord[];
  estimatedWordTimes: boolean;
};

const fmt = (t: number) => {
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s.toFixed(1).padStart(4, "0")}`;
};

type Tab = "captions" | "words" | "format" | "audio" | "export";
const TABS: { id: Tab; label: string }[] = [
  { id: "captions", label: "Subtítulos" },
  { id: "words", label: "Texto" },
  { id: "format", label: "Formato" },
  { id: "audio", label: "Audio" },
  { id: "export", label: "Exportar" },
];

export function ClipEditor({ clip, video, project, lastJob, transcriptWords, estimatedWordTimes }: Props) {
  const router = useRouter();
  const duration = video.durationSec ?? 0;
  const [title, setTitle] = useState(clip.title);
  const [start, setStart] = useState(clip.startSec);
  const [end, setEnd] = useState(clip.endSec);
  const [edit, setEdit] = useState<ClipEdit>(clip.edit);
  const [words, setWords] = useState<TranscriptWord[]>(clip.captionWords ?? transcriptWords);
  const [wordsDirty, setWordsDirty] = useState(false);
  const [exportOpts, setExportOpts] = useState<ExportOptions>(clip.edit.export ?? DEFAULT_EXPORT_OPTS);
  const [tab, setTab] = useState<Tab>("captions");
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState<"save" | "render" | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [view, setView] = useState<"edit" | "result">(clip.outputKey ? "result" : "edit");

  const videoRef = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(clip.startSec);
  const [muted, setMuted] = useState(false);
  const [previewVol, setPreviewVol] = useState(1);

  const touch = () => {
    setDirty(true);
    setMessage(null);
  };
  const setCaptions = (patch: Partial<CaptionStyle>) => {
    setEdit((e) => ({ ...e, captions: { ...e.captions, ...patch, preset: patch.preset ?? "custom" } }));
    touch();
  };

  // Reproducción limitada al tramo del clip
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    v.volume = Math.min(1, previewVol * (edit.volume ?? 1));
    v.muted = muted;
  }, [previewVol, muted, edit.volume]);

  const seek = useCallback((t: number) => {
    const v = videoRef.current;
    if (v) v.currentTime = t;
    setTime(t);
  }, []);

  // Al mover el inicio con el clip en pausa, la vista previa salta allí (timeupdate actualiza `time`).
  useEffect(() => {
    const v = videoRef.current;
    if (v && v.paused) v.currentTime = start;
  }, [start]);

  const toggle = async () => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) {
      if (v.currentTime < start || v.currentTime >= end - 0.05) v.currentTime = start;
      await v.play();
    } else v.pause();
  };

  // Polling del render en curso
  const rendering = clip.status === "queued" || clip.status === "rendering";
  useEffect(() => {
    if (!rendering) return;
    const t = setInterval(() => router.refresh(), 2000);
    return () => clearInterval(t);
  }, [rendering, router]);

  // Subtítulos en la vista previa
  const rel = useMemo(
    () => words.filter((w) => w.e > start + 0.05 && w.s < end - 0.05).map((w) => ({ w: w.w, s: w.s - start, e: w.e - start })),
    [words, start, end],
  );
  const lines = useMemo(() => groupLines(rel, Math.max(1, edit.captions.wordsPerLine)), [rel, edit.captions.wordsPerLine]);
  const tRel = time - start;
  const line = lines.find((l) => tRel >= l.s && tRel < l.e);

  // Geometría de la vista previa (simula el recorte de salida)
  const aspect = ASPECTS.find((a) => a.id === edit.aspectRatio)!;
  const srcW = video.width ?? 1920;
  const srcH = video.height ?? 1080;
  const box = cropBox(srcW, srcH, aspect.w / aspect.h, edit.zoom ?? 1);
  const focus = edit.reframe === "manual" ? edit.manualFocus ?? { x: 0.5, y: 0.5 } : { x: 0.5, y: 0.5 };
  const cx = Math.max(0, Math.min(srcW - box.cropW, focus.x * srcW - box.cropW / 2));
  const cy = Math.max(0, Math.min(srcH - box.cropH, focus.y * srcH - box.cropH / 2));
  const stageRef = useRef<HTMLDivElement>(null);
  const [stageW, setStageW] = useState(300);
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setStageW(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, [view]);
  const scale = stageW / box.cropW;
  const stageH = stageW * (aspect.h / aspect.w);
  const fontPx = (edit.captions.fontSize * Math.min(stageW, stageH)) / 1080;

  async function save(thenRender: boolean) {
    setSaving(thenRender ? "render" : "save");
    setMessage(null);
    try {
      await api(`/api/clips/${clip.id}`, {
        method: "PATCH",
        json: { title, startSec: Number(start.toFixed(3)), endSec: Number(end.toFixed(3)), edit: { ...edit, export: exportOpts }, ...(wordsDirty ? { captionWords: words } : {}) },
      });
      if (thenRender) await api(`/api/clips/${clip.id}/render`, { method: "POST", json: exportOpts });
      setDirty(false);
      setWordsDirty(false);
      setMessage({ ok: true, text: thenRender ? "Guardado. Generando el clip…" : "Cambios guardados." });
      router.refresh();
    } catch (e) {
      setMessage({ ok: false, text: (e as Error).message });
    } finally {
      setSaving(null);
    }
  }

  // Línea de tiempo: ventana con contexto alrededor del clip
  const winStart = Math.max(0, start - 15);
  const winEnd = Math.min(duration, end + 15);
  const pct = (t: number) => ((t - winStart) / (winEnd - winStart)) * 100;
  const barRef = useRef<HTMLDivElement>(null);
  const drag = (which: "start" | "end") => (e: React.PointerEvent) => {
    e.preventDefault();
    const bar = barRef.current!;
    const rect = bar.getBoundingClientRect();
    const ws = winStart;
    const we = winEnd;
    const move = (ev: PointerEvent) => {
      const t = ws + Math.max(0, Math.min(1, (ev.clientX - rect.left) / rect.width)) * (we - ws);
      if (which === "start") setStart(Math.min(t, end - 1));
      else setEnd(Math.max(t, start + 1));
      touch();
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  const snap = (which: "start" | "end") => {
    // Ajusta al límite de palabra más cercano
    if (!words.length) return;
    const t = which === "start" ? start : end;
    const cand = which === "start" ? words.map((w) => w.s - 0.1) : words.map((w) => w.e + 0.15);
    const best = cand.reduce((b, c) => (Math.abs(c - t) < Math.abs(b - t) ? c : b));
    if (which === "start") setStart(Math.max(0, best));
    else setEnd(Math.min(duration, best));
    touch();
  };

  const wordsInRange = words.map((w, i) => ({ w, i })).filter(({ w }) => w.e > start && w.s < end);

  return (
    <div className="pb-6">
      <div className="safe-top flex items-center justify-between gap-3 pt-4 md:pt-8">
        <Link href={`/projects/${project.id}`} className="inline-flex min-w-0 items-center gap-1.5 text-sm text-muted hover:text-text">
          <ArrowLeft className="size-4 shrink-0" /> <span className="truncate">{project.name}</span>
        </Link>
        <div className="flex gap-2">
          <Button size="sm" variant="secondary" onClick={() => save(false)} disabled={!!saving || !dirty}>
            {saving === "save" ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />} Guardar
          </Button>
          <Button size="sm" variant="primary" onClick={() => save(true)} disabled={!!saving || rendering}>
            {saving === "render" ? <Loader2 className="size-3.5 animate-spin" /> : <Wand2 className="size-3.5" />} {clip.outputKey ? "Guardar y regenerar" : "Guardar y generar"}
          </Button>
        </div>
      </div>

      <div className="mt-4 flex items-start gap-3">
        <ScoreBadge score={clip.score} />
        <div className="min-w-0 flex-1">
          <input
            value={title}
            onChange={(e) => {
              setTitle(e.target.value);
              touch();
            }}
            maxLength={120}
            aria-label="Título del clip"
            className="font-display w-full rounded-lg border border-transparent bg-transparent px-1 text-xl font-semibold outline-none hover:border-line focus:border-ember/60 md:text-2xl"
          />
          {clip.reason && <p className="mt-1 px-1 text-sm text-muted">{clip.reason}</p>}
        </div>
      </div>

      {message && (
        <p role="status" className={cn("mt-3 flex items-center gap-2 rounded-xl border p-3 text-sm", message.ok ? "border-ok/30 bg-ok/10 text-ok" : "border-bad/30 bg-bad/10 text-bad")}>
          {message.ok ? <Check className="size-4" /> : <AlertTriangle className="size-4" />} {message.text}
        </p>
      )}

      <div className="mt-5 grid gap-6 lg:grid-cols-[minmax(0,420px)_1fr]">
        {/* ───── Vista previa ───── */}
        <div className="lg:sticky lg:top-6 lg:self-start">
          {clip.outputKey && (
            <div className="mb-3 inline-flex rounded-xl border border-line bg-surface-2 p-1 text-xs">
              <button onClick={() => setView("edit")} className={cn("rounded-lg px-3 py-1.5", view === "edit" ? "bg-surface-3" : "text-muted")}>Vista previa de edición</button>
              <button onClick={() => setView("result")} className={cn("rounded-lg px-3 py-1.5", view === "result" ? "bg-surface-3" : "text-muted")}>Clip generado</button>
            </div>
          )}

          {view === "result" && clip.outputKey ? (
            <div>
              <video src={`/api/media/clips/${clip.id}/video.mp4?v=${clip.renderedAt}`} controls playsInline className="mx-auto max-h-[70vh] w-full rounded-2xl bg-black" />
              {clip.renderInfo && (
                <p className="mt-2 text-[11px] text-faint">
                  {clip.renderInfo.width}×{clip.renderInfo.height} · {clip.renderInfo.fps} FPS · {clip.renderInfo.durationSec.toFixed(1)} s · {clip.renderInfo.reframeNote}
                  {clip.renderInfo.warnings.map((w) => ` · ${w}`)}
                </p>
              )}
              <div className="mt-3 flex flex-wrap gap-2">
                <a href={`/api/media/clips/${clip.id}/video.mp4?download=1`} className={buttonClass("primary", "sm")}>
                  <Download className="size-3.5" /> Descargar MP4
                </a>
                {clip.subtitleKey && (
                  <a href={`/api/media/clips/${clip.id}/subtitles.srt?download=1`} className={buttonClass("secondary", "sm")}>
                    <Download className="size-3.5" /> SRT
                  </a>
                )}
              </div>
              {dirty && <p className="mt-2 text-xs text-warn">Hay cambios sin generar: el clip descargable aún no los incluye.</p>}
            </div>
          ) : (
            <>
              <div
                ref={stageRef}
                className={cn("relative mx-auto w-full overflow-hidden rounded-2xl bg-black", edit.reframe === "manual" && "cursor-crosshair")}
                style={{ aspectRatio: `${aspect.w} / ${aspect.h}`, maxHeight: "65vh", maxWidth: `calc(65vh * ${aspect.w / aspect.h})` }}
                onClick={(e) => {
                  if (edit.reframe !== "manual") return toggle();
                  const r = e.currentTarget.getBoundingClientRect();
                  const fx = (cx + ((e.clientX - r.left) / r.width) * box.cropW) / srcW;
                  const fy = (cy + ((e.clientY - r.top) / r.height) * box.cropH) / srcH;
                  setEdit((x) => ({ ...x, manualFocus: { x: Math.min(1, Math.max(0, fx)), y: Math.min(1, Math.max(0, fy)) } }));
                  touch();
                }}
              >
                <video
                  ref={videoRef}
                  src={`/api/media/videos/${video.id}/source`}
                  playsInline
                  preload="auto"
                  onPlay={() => setPlaying(true)}
                  onPause={() => setPlaying(false)}
                  onLoadedMetadata={(e) => (e.currentTarget.currentTime = start)}
                  onTimeUpdate={(e) => {
                    const t = e.currentTarget.currentTime;
                    setTime(t);
                    if (t >= end) {
                      e.currentTarget.pause();
                      e.currentTarget.currentTime = start;
                    }
                  }}
                  className="absolute max-w-none"
                  style={{ width: srcW * scale, height: srcH * scale, left: -cx * scale, top: -cy * scale }}
                />
                {edit.captions.enabled && line && <CaptionOverlay style={edit.captions} words={line.words} t={tRel} fontPx={fontPx} />}
                {!playing && (
                  <span className="pointer-events-none absolute inset-0 grid place-items-center">
                    <span className="grid size-14 place-items-center rounded-full bg-black/50 backdrop-blur"><Play className="size-6" /></span>
                  </span>
                )}
              </div>
              {edit.reframe === "auto" && (
                <p className="mt-2 text-[11px] text-faint">Encuadre automático: el seguimiento del rostro se calcula al generar el clip (aquí se muestra el centro).</p>
              )}
              {edit.reframe === "manual" && <p className="mt-2 text-[11px] text-ai">Toca la imagen para elegir el centro del encuadre.</p>}

              {/* Controles */}
              <div className="mt-3 flex items-center gap-3">
                <button onClick={toggle} aria-label={playing ? "Pausar" : "Reproducir"} className="forge-gradient grid size-10 shrink-0 place-items-center rounded-full text-black">
                  {playing ? <Pause className="size-4" /> : <Play className="size-4" />}
                </button>
                <span className="text-xs tabular-nums text-muted">{fmt(Math.max(0, time - start))} / {fmt(end - start)}</span>
                <div className="ml-auto flex items-center gap-2">
                  <button onClick={() => setMuted((m) => !m)} aria-label={muted ? "Activar sonido" : "Silenciar"} className="text-muted hover:text-text">
                    {muted ? <VolumeX className="size-4" /> : <Volume2 className="size-4" />}
                  </button>
                  <input type="range" min={0} max={1} step={0.05} value={previewVol} onChange={(e) => setPreviewVol(Number(e.target.value))} aria-label="Volumen de reproducción" className="w-20" />
                </div>
              </div>
            </>
          )}

          {rendering && (
            <div className="mt-3 rounded-xl border border-ember/30 bg-ember/5 p-3">
              <div className="mb-1 flex justify-between text-xs">
                <span>{clip.status === "queued" ? "En cola" : JOB_STAGE_LABEL[lastJob?.stage ?? "rendering"]}</span>
                <span className="tabular-nums">{lastJob?.progress ?? 0}%</span>
              </div>
              <ProgressBar value={lastJob?.progress ?? 0} indeterminate={clip.status === "queued"} />
            </div>
          )}
          {clip.status === "failed" && lastJob?.error && (
            <p className="mt-3 flex gap-2 rounded-xl border border-bad/30 bg-bad/10 p-3 text-sm text-bad"><AlertTriangle className="size-4 shrink-0" /> {lastJob.error}</p>
          )}
        </div>

        {/* ───── Panel de edición ───── */}
        <div className="min-w-0">
          {/* Línea de tiempo y recorte */}
          <div className="rounded-2xl border border-line bg-surface p-4">
            <p className="text-sm font-medium">Recorte</p>
            <div ref={barRef} className="relative mt-4 h-12 select-none rounded-lg bg-surface-3" onClick={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              seek(winStart + ((e.clientX - r.left) / r.width) * (winEnd - winStart));
            }}>
              <div className="absolute inset-y-0 rounded-md border-2 border-ember bg-ember/15" style={{ left: `${pct(start)}%`, width: `${pct(end) - pct(start)}%` }} />
              {rel.length > 0 && rel.map((w, i) => (
                <span key={i} className="absolute top-1/2 h-3 w-px -translate-y-1/2 bg-muted/40" style={{ left: `${pct(w.s + start)}%` }} />
              ))}
              <span className="absolute inset-y-0 w-0.5 bg-white" style={{ left: `${pct(Math.min(winEnd, Math.max(winStart, time)))}%` }} />
              <button aria-label="Mover inicio" onPointerDown={drag("start")} onClick={(e) => e.stopPropagation()} className="absolute inset-y-0 -ml-2.5 w-5 cursor-ew-resize touch-none rounded-l-md bg-ember" style={{ left: `${pct(start)}%` }} />
              <button aria-label="Mover final" onPointerDown={drag("end")} onClick={(e) => e.stopPropagation()} className="absolute inset-y-0 -ml-2.5 w-5 cursor-ew-resize touch-none rounded-r-md bg-ember" style={{ left: `${pct(end)}%` }} />
            </div>
            <div className="mt-1 flex justify-between text-[10px] tabular-nums text-faint"><span>{fmt(winStart)}</span><span>{fmt(winEnd)}</span></div>
            <div className="mt-3 grid grid-cols-2 gap-3">
              {(["start", "end"] as const).map((which) => {
                const v = which === "start" ? start : end;
                const set = (n: number) => {
                  if (which === "start") setStart(Math.max(0, Math.min(n, end - 1)));
                  else setEnd(Math.min(duration, Math.max(n, start + 1)));
                  touch();
                };
                return (
                  <div key={which}>
                    <p className="text-xs text-muted">{which === "start" ? "Inicio" : "Final"}</p>
                    <div className="mt-1 flex items-center gap-1">
                      <button className="h-9 rounded-lg border border-line px-2 text-xs" onClick={() => set(v - 0.5)}>−0,5</button>
                      <input
                        type="number"
                        step={0.1}
                        value={Number(v.toFixed(2))}
                        onChange={(e) => set(Number(e.target.value))}
                        aria-label={which === "start" ? "Inicio en segundos" : "Final en segundos"}
                        className="h-9 w-full min-w-0 rounded-lg border border-line bg-surface-2 px-2 text-center text-base tabular-nums md:text-sm"
                      />
                      <button className="h-9 rounded-lg border border-line px-2 text-xs" onClick={() => set(v + 0.5)}>+0,5</button>
                    </div>
                    <button className="mt-1 text-[11px] text-ai hover:underline" onClick={() => snap(which)}>Ajustar a palabra</button>
                  </div>
                );
              })}
            </div>
            <p className="mt-2 text-xs text-muted">Duración: <span className="tabular-nums text-text">{(end - start).toFixed(1)} s</span></p>
          </div>

          {/* Pestañas */}
          <div role="tablist" className="mt-4 flex gap-1 overflow-x-auto rounded-xl border border-line bg-surface-2 p-1 text-sm">
            {TABS.map((t) => (
              <button key={t.id} role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)} className={cn("shrink-0 rounded-lg px-3 py-1.5", tab === t.id ? "bg-surface-3 text-text" : "text-muted")}>
                {t.label}
              </button>
            ))}
          </div>

          <div className="mt-3 rounded-2xl border border-line bg-surface p-4">
            {tab === "captions" && <CaptionsPanel style={edit.captions} onChange={setCaptions} onPreset={(k) => { setEdit((e) => ({ ...e, captions: { ...CAPTION_PRESETS[k].style } })); touch(); }} />}

            {tab === "words" && (
              <div>
                <p className="text-sm font-medium">Editar palabras</p>
                <p className="mt-1 text-xs text-muted">
                  Corrige el texto de los subtítulos. Los tiempos de cada palabra se mantienen.
                  {estimatedWordTimes && " (La transcripción local usa tiempos por palabra estimados.)"}
                </p>
                {wordsInRange.length === 0 ? (
                  <p className="mt-4 text-sm text-faint">No hay palabras transcritas en este tramo. Analiza o transcribe el video para tener subtítulos.</p>
                ) : (
                  <div className="mt-3 flex max-h-[50vh] flex-wrap gap-1.5 overflow-y-auto">
                    {wordsInRange.map(({ w, i }) => (
                      <span key={i} className="inline-flex items-center rounded-lg border border-line bg-surface-2">
                        <button className="px-1.5 text-[10px] tabular-nums text-faint" title="Ir a esta palabra" onClick={() => seek(w.s)}>{fmt(w.s - start)}</button>
                        <input
                          value={w.w}
                          onChange={(e) => {
                            const val = e.target.value;
                            setWords((ws) => ws.map((x, j) => (j === i ? { ...x, w: val } : x)));
                            setWordsDirty(true);
                            touch();
                          }}
                          onBlur={(e) => {
                            if (!e.target.value.trim()) {
                              setWords((ws) => ws.filter((_, j) => j !== i));
                              setWordsDirty(true);
                            }
                          }}
                          aria-label={`Palabra en ${fmt(w.s - start)}`}
                          className={cn("h-8 bg-transparent px-1 text-base outline-none md:text-sm", tRel >= w.s - start && tRel < w.e - start && "text-ember-2")}
                          style={{ width: `${Math.max(2, w.w.length + 1)}ch` }}
                        />
                      </span>
                    ))}
                  </div>
                )}
                <p className="mt-2 text-[11px] text-faint">Deja una palabra vacía para eliminarla.</p>
              </div>
            )}

            {tab === "format" && (
              <div className="space-y-4">
                <div>
                  <p className="mb-2 text-sm font-medium">Relación de aspecto</p>
                  <div className="grid grid-cols-4 gap-2">
                    {ASPECTS.map((a) => (
                      <button key={a.id} onClick={() => { setEdit((e) => ({ ...e, aspectRatio: a.id as AspectRatio })); touch(); }} className={cn("flex flex-col items-center gap-1.5 rounded-xl border p-2 text-xs", edit.aspectRatio === a.id ? "border-ember/60 bg-ember/10" : "border-line text-muted")}>
                        <span className="block rounded-sm border-2 border-current" style={{ width: a.w > a.h ? 28 : (28 * a.w) / a.h, height: a.h > a.w ? 28 : (28 * a.h) / a.w }} />
                        {a.label}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <p className="mb-2 text-sm font-medium">Encuadre</p>
                  <div className="grid gap-2 sm:grid-cols-3">
                    {([
                      ["auto", "Automático", "Sigue el rostro del hablante; con dos personas, pantalla dividida."],
                      ["center", "Centrado", "Recorte fijo en el centro."],
                      ["manual", "Manual", "Elige tú el centro tocando la vista previa."],
                    ] as const).map(([id, l, d]) => (
                      <button key={id} onClick={() => { setEdit((e) => ({ ...e, reframe: id, manualFocus: id === "manual" ? e.manualFocus ?? { x: 0.5, y: 0.5 } : e.manualFocus })); touch(); }} className={cn("rounded-xl border p-3 text-left", edit.reframe === id ? "border-ember/60 bg-ember/10" : "border-line")}>
                        <p className="text-sm">{l}</p>
                        <p className="mt-0.5 text-[11px] text-faint">{d}</p>
                      </button>
                    ))}
                  </div>
                </div>
                {edit.reframe === "manual" && (
                  <div className="grid grid-cols-2 gap-3">
                    <label className="text-xs text-muted">Horizontal<input type="range" min={0} max={1} step={0.01} value={edit.manualFocus?.x ?? 0.5} onChange={(e) => { setEdit((x) => ({ ...x, manualFocus: { x: Number(e.target.value), y: x.manualFocus?.y ?? 0.5 } })); touch(); }} className="mt-1 w-full" /></label>
                    <label className="text-xs text-muted">Vertical<input type="range" min={0} max={1} step={0.01} value={edit.manualFocus?.y ?? 0.5} onChange={(e) => { setEdit((x) => ({ ...x, manualFocus: { y: Number(e.target.value), x: x.manualFocus?.x ?? 0.5 } })); touch(); }} className="mt-1 w-full" /></label>
                  </div>
                )}
                <label className="block text-xs text-muted">
                  Zoom: <span className="tabular-nums text-text">{(edit.zoom ?? 1).toFixed(2)}×</span>
                  <input type="range" min={1} max={2.5} step={0.05} value={edit.zoom ?? 1} onChange={(e) => { setEdit((x) => ({ ...x, zoom: Number(e.target.value) })); touch(); }} className="mt-1 w-full" />
                </label>
              </div>
            )}

            {tab === "audio" && (
              <div>
                <p className="text-sm font-medium">Volumen del clip exportado</p>
                <div className="mt-3 flex items-center gap-3">
                  <input type="range" min={0} max={2} step={0.05} value={edit.volume ?? 1} onChange={(e) => { setEdit((x) => ({ ...x, volume: Number(e.target.value) })); touch(); }} className="flex-1" aria-label="Volumen del clip" />
                  <span className="w-12 text-right text-sm tabular-nums">{Math.round((edit.volume ?? 1) * 100)}%</span>
                </div>
                <p className="mt-2 text-[11px] text-faint">Al generar se aplica además un fundido de audio muy corto al inicio y al final para evitar chasquidos.</p>
              </div>
            )}

            {tab === "export" && (
              <div>
                <ExportOptionsForm value={exportOpts} onChange={(v) => { setExportOpts(v); touch(); }} />
                <Button className="mt-4" variant="primary" onClick={() => save(true)} disabled={!!saving || rendering}>
                  {saving === "render" ? <Loader2 className="size-4 animate-spin" /> : clip.outputKey ? <RotateCcw className="size-4" /> : <Wand2 className="size-4" />} {clip.outputKey ? "Guardar y regenerar" : "Guardar y generar"}
                </Button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function CaptionOverlay({ style, words, t, fontPx }: { style: CaptionStyle; words: TranscriptWord[]; t: number; fontPx: number }) {
  const outline = style.outlineColor && style.outlineWidth > 0 ? Math.max(1, (style.outlineWidth * fontPx) / style.fontSize) : 0;
  const pos = style.position === "top" ? "top-[10%]" : style.position === "middle" ? "top-1/2 -translate-y-1/2" : "bottom-[14%]";
  return (
    <div className={cn("pointer-events-none absolute inset-x-[7%] flex justify-center text-center", pos)}>
      <span
        style={{
          fontFamily: `"${style.fontFamily}"`,
          fontSize: fontPx,
          lineHeight: 1.15,
          color: style.color,
          background: style.backgroundColor ? hexToRgba(style.backgroundColor) : undefined,
          padding: style.backgroundColor ? `${fontPx * 0.15}px ${fontPx * 0.3}px` : undefined,
          borderRadius: style.backgroundColor ? fontPx * 0.15 : undefined,
          WebkitTextStroke: outline ? `${outline * 2}px ${style.outlineColor}` : undefined,
          paintOrder: "stroke fill",
          textShadow: style.outlineColor ? undefined : "0 2px 6px rgba(0,0,0,.6)",
          textTransform: style.uppercase ? "uppercase" : undefined,
        }}
      >
        {words.map((w, i) => {
          const active = t >= w.s && t < (words[i + 1]?.s ?? w.e + 0.4);
          const done = t >= w.s;
          const hl = (style.highlightMode === "word" && active) || (style.highlightMode === "karaoke" && done);
          return (
            <span key={i} style={{ color: hl ? style.highlightColor : undefined }}>
              {w.w}
              {i < words.length - 1 ? " " : ""}
            </span>
          );
        })}
      </span>
    </div>
  );
}

function hexToRgba(hex: string) {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})?$/i.exec(hex);
  if (!m) return hex;
  return `rgba(${parseInt(m[1], 16)},${parseInt(m[2], 16)},${parseInt(m[3], 16)},${m[4] ? (parseInt(m[4], 16) / 255).toFixed(2) : 1})`;
}

function CaptionsPanel({ style, onChange, onPreset }: { style: CaptionStyle; onChange: (p: Partial<CaptionStyle>) => void; onPreset: (k: string) => void }) {
  const color = (label: string, key: "color" | "highlightColor" | "outlineColor" | "backgroundColor", nullable = false) => {
    const v = style[key];
    return (
      <label className="flex items-center justify-between gap-2 text-xs text-muted">
        {label}
        <span className="flex items-center gap-2">
          {nullable && (
            <input type="checkbox" checked={v != null} onChange={(e) => onChange({ [key]: e.target.checked ? (key === "backgroundColor" ? "#000000B3" : "#000000") : null })} aria-label={`Activar ${label}`} className="size-4" />
          )}
          <input type="color" value={(v ?? "#000000").slice(0, 7)} disabled={v == null} onChange={(e) => onChange({ [key]: key === "backgroundColor" ? `${e.target.value}${(v ?? "").slice(7) || "B3"}` : e.target.value })} className="h-8 w-10 rounded border border-line bg-transparent disabled:opacity-30" aria-label={label} />
        </span>
      </label>
    );
  };
  return (
    <div className="space-y-4">
      <label className="flex items-center justify-between text-sm">
        Subtítulos activados
        <input type="checkbox" checked={style.enabled} onChange={(e) => onChange({ enabled: e.target.checked, preset: style.preset })} className="size-5" />
      </label>
      <div>
        <p className="mb-2 text-xs text-muted">Estilos</p>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {Object.entries(CAPTION_PRESETS).map(([k, p]) => (
            <button key={k} onClick={() => onPreset(k)} className={cn("rounded-xl border p-2.5 text-left", style.preset === k ? "border-ember/60 bg-ember/10" : "border-line")}>
              <span className="block truncate text-sm" style={{ fontFamily: `"${p.style.fontFamily}"`, color: p.style.highlightMode !== "none" ? p.style.highlightColor : p.style.color, textTransform: p.style.uppercase ? "uppercase" : undefined }}>
                {p.label}
              </span>
              <span className="mt-0.5 block text-[10px] leading-tight text-faint">{p.description}</span>
            </button>
          ))}
        </div>
        {style.preset === "custom" && <p className="mt-1 text-[11px] text-faint">Estilo personalizado.</p>}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-xs text-muted">
          Fuente
          <select value={style.fontFamily} onChange={(e) => onChange({ fontFamily: e.target.value })} className="mt-1 h-10 w-full rounded-lg border border-line bg-surface-2 px-2 text-base text-text md:text-sm">
            {CAPTION_FONTS.map((f) => (
              <option key={f.family} value={f.family}>{f.label}</option>
            ))}
          </select>
        </label>
        <label className="text-xs text-muted">
          Tamaño: <span className="text-text tabular-nums">{style.fontSize}</span>
          <input type="range" min={24} max={130} value={style.fontSize} onChange={(e) => onChange({ fontSize: Number(e.target.value) })} className="mt-3 w-full" />
        </label>
        <label className="text-xs text-muted">
          Posición
          <select value={style.position} onChange={(e) => onChange({ position: e.target.value as CaptionStyle["position"] })} className="mt-1 h-10 w-full rounded-lg border border-line bg-surface-2 px-2 text-base text-text md:text-sm">
            <option value="top">Arriba</option>
            <option value="middle">Centro</option>
            <option value="bottom">Abajo</option>
          </select>
        </label>
        <label className="text-xs text-muted">
          Resaltado de palabras
          <select value={style.highlightMode} onChange={(e) => onChange({ highlightMode: e.target.value as CaptionStyle["highlightMode"] })} className="mt-1 h-10 w-full rounded-lg border border-line bg-surface-2 px-2 text-base text-text md:text-sm">
            <option value="none">Sin resaltado</option>
            <option value="word">Palabra activa</option>
            <option value="karaoke">Karaoke (acumulativo)</option>
          </select>
        </label>
        <label className="text-xs text-muted">
          Palabras por línea: <span className="text-text tabular-nums">{style.wordsPerLine}</span>
          <input type="range" min={1} max={10} value={style.wordsPerLine} onChange={(e) => onChange({ wordsPerLine: Number(e.target.value) })} className="mt-3 w-full" />
        </label>
        <label className="text-xs text-muted">
          Contorno: <span className="text-text tabular-nums">{style.outlineWidth}</span>
          <input type="range" min={0} max={10} step={0.5} value={style.outlineWidth} onChange={(e) => onChange({ outlineWidth: Number(e.target.value) })} className="mt-3 w-full" />
        </label>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        {color("Color del texto", "color")}
        {color("Color de resaltado", "highlightColor")}
        {color("Color del contorno", "outlineColor", true)}
        {color("Fondo (caja)", "backgroundColor", true)}
      </div>
      <label className="flex items-center gap-2 text-xs text-muted">
        <input type="checkbox" checked={style.uppercase} onChange={(e) => onChange({ uppercase: e.target.checked })} className="size-4" /> MAYÚSCULAS
      </label>
    </div>
  );
}
