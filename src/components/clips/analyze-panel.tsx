"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { AlertTriangle, AudioLines, Loader2, Sparkles, X } from "lucide-react";
import type { AspectRatio } from "@/server/db/schema";
import { Button } from "@/components/ui/button";
import { ProgressBar } from "@/components/ui/progress-bar";
import { api } from "@/lib/api-client";
import { ASPECTS, CAPTION_PRESETS, CLIP_LENGTH_PRESETS } from "@/lib/captions";
import { cn } from "@/lib/cn";

type Preset = keyof typeof CLIP_LENGTH_PRESETS | "custom";
const LANGS = [
  ["auto", "Detectar"],
  ["es", "Español"],
  ["en", "Inglés"],
  ["pt", "Portugués"],
  ["fr", "Francés"],
  ["it", "Italiano"],
  ["de", "Alemán"],
] as const;

export type ServiceReadiness = { transcription: { ready: boolean; provider: string; missing: string[] }; llm: { ready: boolean; provider: string; missing: string[] } };

export function AnalyzePanel({
  projectId,
  videoDuration,
  hasTranscript,
  hasClips,
  services,
  initial,
}: {
  projectId: string;
  videoDuration: number;
  hasTranscript: boolean;
  hasClips: boolean;
  services: ServiceReadiness;
  initial: { preset?: Preset; minSec?: number; maxSec?: number; maxClips?: number; language?: string; aspectRatio?: AspectRatio; captionStyle?: string };
}) {
  const router = useRouter();
  const [preset, setPreset] = useState<Preset>(initial.preset ?? "medium");
  const [minSec, setMinSec] = useState(initial.minSec ?? 30);
  const [maxSec, setMaxSec] = useState(initial.maxSec ?? 60);
  const [maxClips, setMaxClips] = useState(initial.maxClips ?? 10);
  const [language, setLanguage] = useState(initial.language ?? "auto");
  const [aspect, setAspect] = useState<AspectRatio>(initial.aspectRatio ?? "9:16");
  const [caption, setCaption] = useState(initial.captionStyle ?? "viral");
  const [reuse, setReuse] = useState(true);
  const [busy, setBusy] = useState<"full" | "transcribe" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const pick = (p: Preset) => {
    setPreset(p);
    if (p !== "custom") {
      setMinSec(CLIP_LENGTH_PRESETS[p].minSec);
      setMaxSec(CLIP_LENGTH_PRESETS[p].maxSec);
    }
  };

  async function start(mode: "full" | "transcribe") {
    setBusy(mode);
    setError(null);
    try {
      await api(`/api/projects/${projectId}/analyze`, {
        method: "POST",
        json: { mode, clipLength: { preset, minSec, maxSec }, maxClips, language, aspectRatio: aspect, captionStyle: caption, reuseTranscript: reuse },
      });
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const transcriptionNeeded = !(reuse && hasTranscript);
  const blockedTranscription = transcriptionNeeded && !services.transcription.ready;
  const rangeError = maxSec <= minSec ? "El máximo debe ser mayor que el mínimo." : minSec > videoDuration ? "El mínimo supera la duración del video." : null;

  return (
    <div className="rounded-2xl border border-line bg-surface-2 p-4 sm:p-5">
      <h3 className="font-display flex items-center gap-2 text-base font-semibold">
        <Sparkles className="size-4 text-ai" /> {hasClips ? "Volver a analizar" : "Analizar con IA"}
      </h3>
      <p className="mt-1 text-xs text-muted">
        Se transcribe el audio, la IA lee la conversación completa y propone clips con una idea completa, ordenados por potencial.
      </p>

      <div className="mt-4 space-y-4">
        <div>
          <p className="mb-1.5 text-xs text-muted">Duración de los clips</p>
          <div className="flex flex-wrap gap-1.5">
            {(Object.keys(CLIP_LENGTH_PRESETS) as (keyof typeof CLIP_LENGTH_PRESETS)[]).map((k) => (
              <button key={k} type="button" onClick={() => pick(k)} className={cn("rounded-lg border px-3 py-1.5 text-xs", preset === k ? "border-ember/60 bg-ember/10" : "border-line text-muted")}>
                {CLIP_LENGTH_PRESETS[k].label} <span className="text-faint">{CLIP_LENGTH_PRESETS[k].minSec}–{CLIP_LENGTH_PRESETS[k].maxSec}s</span>
              </button>
            ))}
            <button type="button" onClick={() => pick("custom")} className={cn("rounded-lg border px-3 py-1.5 text-xs", preset === "custom" ? "border-ember/60 bg-ember/10" : "border-line text-muted")}>
              Personalizada
            </button>
          </div>
          {preset === "custom" && (
            <div className="mt-2 flex items-center gap-2 text-sm">
              <input type="number" min={3} value={minSec} onChange={(e) => setMinSec(Number(e.target.value))} aria-label="Duración mínima (s)" className="h-10 w-20 rounded-lg border border-line bg-surface px-2 text-base md:text-sm" />
              <span className="text-faint">a</span>
              <input type="number" min={5} value={maxSec} onChange={(e) => setMaxSec(Number(e.target.value))} aria-label="Duración máxima (s)" className="h-10 w-20 rounded-lg border border-line bg-surface px-2 text-base md:text-sm" />
              <span className="text-faint">segundos</span>
            </div>
          )}
          {rangeError && <p className="mt-1 text-xs text-bad">{rangeError}</p>}
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <label className="text-xs text-muted">
            Máx. de clips
            <input type="number" min={1} max={30} value={maxClips} onChange={(e) => setMaxClips(Number(e.target.value))} className="mt-1 h-10 w-full rounded-lg border border-line bg-surface px-2 text-base text-text md:text-sm" />
          </label>
          <label className="text-xs text-muted">
            Idioma
            <select value={language} onChange={(e) => setLanguage(e.target.value)} className="mt-1 h-10 w-full rounded-lg border border-line bg-surface px-2 text-base text-text md:text-sm">
              {LANGS.map(([v, l]) => (
                <option key={v} value={v}>{l}</option>
              ))}
            </select>
          </label>
          <label className="text-xs text-muted">
            Formato
            <select value={aspect} onChange={(e) => setAspect(e.target.value as AspectRatio)} className="mt-1 h-10 w-full rounded-lg border border-line bg-surface px-2 text-base text-text md:text-sm">
              {ASPECTS.map((a) => (
                <option key={a.id} value={a.id}>{a.label} · {a.hint}</option>
              ))}
            </select>
          </label>
          <label className="text-xs text-muted">
            Subtítulos
            <select value={caption} onChange={(e) => setCaption(e.target.value)} className="mt-1 h-10 w-full rounded-lg border border-line bg-surface px-2 text-base text-text md:text-sm">
              {Object.entries(CAPTION_PRESETS).map(([k, p]) => (
                <option key={k} value={k}>{p.label}</option>
              ))}
            </select>
          </label>
        </div>

        {hasTranscript && (
          <label className="flex items-center gap-2 text-xs text-muted">
            <input type="checkbox" checked={reuse} onChange={(e) => setReuse(e.target.checked)} className="size-4 accent-[var(--ember)]" />
            Reutilizar la transcripción existente (más rápido y sin coste de transcripción)
          </label>
        )}

        {(blockedTranscription || !services.llm.ready) && (
          <div className="space-y-1.5 rounded-xl border border-warn/30 bg-warn/5 p-3 text-xs text-warn">
            {blockedTranscription && (
              <p className="flex gap-1.5"><AlertTriangle className="size-3.5 shrink-0" /> Transcripción no configurada ({services.transcription.provider}): falta {services.transcription.missing.join(", ")}.</p>
            )}
            {!services.llm.ready && (
              <p className="flex gap-1.5"><AlertTriangle className="size-3.5 shrink-0" /> IA de análisis no configurada ({services.llm.provider}): falta {services.llm.missing.join(", ")}. Sin ella no se pueden detectar momentos; puedes transcribir y crear clips manuales.</p>
            )}
            <p className="text-faint">Se configura en el archivo .env del servidor (ver Ajustes).</p>
          </div>
        )}

        {error && (
          <p role="alert" className="flex gap-2 rounded-xl border border-bad/30 bg-bad/10 p-3 text-sm text-bad">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" /> {error}
          </p>
        )}

        <div className="flex flex-wrap gap-2">
          <Button variant="primary" size="lg" onClick={() => start("full")} disabled={!!busy || !!rangeError || blockedTranscription || !services.llm.ready}>
            {busy === "full" ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />} Analizar video
          </Button>
          {!services.llm.ready && (
            <Button variant="secondary" size="lg" onClick={() => start("transcribe")} disabled={!!busy || blockedTranscription}>
              {busy === "transcribe" ? <Loader2 className="size-4 animate-spin" /> : <AudioLines className="size-4" />} Sólo transcribir
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

const STEPS = [
  ["extracting_audio", "Analizando audio"],
  ["transcribing", "Transcribiendo"],
  ["detecting_moments", "Detectando momentos"],
  ["generating_clips", "Generando clips"],
] as const;

export function AnalysisProgress({ job }: { job: { id: string; stage: string; progress: number; status: string; params: Record<string, unknown> } }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const transcribeOnly = job.params.mode === "transcribe";
  const steps = transcribeOnly ? STEPS.slice(0, 2) : STEPS;
  const idx = job.stage === "queued" ? -1 : steps.findIndex(([s]) => s === job.stage);
  return (
    <div className="rounded-2xl border border-ai/30 bg-ai/5 p-4 sm:p-5">
      <div className="flex items-center justify-between gap-2">
        <p className="font-display flex items-center gap-2 font-semibold">
          <Loader2 className="size-4 animate-spin text-ai" /> {job.stage === "queued" ? "En cola…" : transcribeOnly ? "Transcribiendo" : "Analizando el video"}
        </p>
        <Button
          size="sm"
          variant="ghost"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            await api(`/api/jobs/${job.id}/cancel`, { method: "POST" }).catch(() => {});
            router.refresh();
          }}
        >
          <X className="size-3.5" /> Cancelar
        </Button>
      </div>
      <ol className="mt-4 grid gap-2 sm:grid-cols-4">
        {steps.map(([id, label], i) => (
          <li key={id} className={cn("rounded-xl border px-3 py-2 text-xs", i < idx ? "border-ok/30 text-ok" : i === idx ? "border-ai/50 text-text" : "border-line text-faint")}>
            <span className="tabular-nums">{i + 1}.</span> {label}
          </li>
        ))}
      </ol>
      <div className="mt-3 flex items-center gap-3">
        <ProgressBar value={job.progress} indeterminate={job.stage === "queued" || job.stage === "detecting_moments"} />
        <span className="w-10 text-right text-xs tabular-nums">{job.progress}%</span>
      </div>
      <p className="mt-2 text-[11px] text-faint">
        Puedes seguir navegando: el proceso continúa en el servidor.
        {job.stage === "queued" && " Si no avanza, comprueba que el worker esté en marcha (npm run worker)."}
      </p>
    </div>
  );
}
