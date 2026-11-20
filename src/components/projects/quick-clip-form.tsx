"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { AlertTriangle, ChevronDown, Link2, Loader2, Sparkles, Upload } from "lucide-react";
import type { AspectRatio } from "@/server/db/schema";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api-client";
import { ASPECTS, CAPTION_PRESETS, CLIP_LENGTH_PRESETS } from "@/lib/captions";
import { cn } from "@/lib/cn";
import { DEFAULT_AUTO_ANALYZE, platformOf } from "@/lib/media-rules";

/**
 * Entrada principal: pegar el enlace de un video (YouTube…) y obtener los clips
 * con más potencial, sin pasos intermedios.
 */
export function QuickClipForm({ llmReady, llmMissing }: { llmReady: boolean; llmMissing: string }) {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [rights, setRights] = useState(false);
  const [preset, setPreset] = useState<keyof typeof CLIP_LENGTH_PRESETS>("medium");
  const [aspect, setAspect] = useState<AspectRatio>("9:16");
  const [caption, setCaption] = useState("viral");
  const [maxClips, setMaxClips] = useState(10);
  const [more, setMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const platform = platformOf(url);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ projectId: string }>("/api/quick-import", {
        method: "POST",
        json: {
          url,
          confirmRights: rights,
          autoAnalyze: { ...DEFAULT_AUTO_ANALYZE, clipLength: { preset, ...CLIP_LENGTH_PRESETS[preset] }, aspectRatio: aspect, captionStyle: caption, maxClips },
        },
      });
      router.push(`/projects/${r.projectId}`);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="w-full">
      <label htmlFor="video-url" className="mb-1.5 block text-xs font-medium text-muted">
        Enlace del video (YouTube, Google Drive, Dropbox…)
      </label>
      <div className="flex flex-col gap-2 sm:flex-row">
        <div className="relative flex-1">
          <Link2 className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-faint" />
          <input
            id="video-url"
            type="url"
            inputMode="url"
            required
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://www.youtube.com/watch?v=…"
            className="h-12 w-full rounded-xl border border-line bg-surface-2 pl-10 pr-3 text-base outline-none focus:border-ember/60 focus:ring-2 focus:ring-ember/20 md:text-sm"
          />
        </div>
        <Button type="submit" variant="primary" size="lg" disabled={busy || !url.trim() || (!!platform && !rights) || !llmReady}>
          {busy ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />} Obtener clips virales
        </Button>
      </div>

      {platform && (
        <label className="mt-3 flex items-start gap-2 rounded-xl border border-line bg-bg/40 p-3 text-xs text-muted">
          <input type="checkbox" checked={rights} onChange={(e) => setRights(e.target.checked)} className="mt-0.5 size-4 shrink-0 accent-[var(--ember)]" />
          <span>
            Confirmo que tengo derecho a usar este video de {platform} (es mío o tengo permiso del autor). Descargar de {platform} puede ir contra sus términos de uso: la responsabilidad es mía.
          </span>
        </label>
      )}

      <button type="button" onClick={() => setMore((m) => !m)} className="mt-3 inline-flex items-center gap-1 text-xs text-muted hover:text-text">
        Opciones: {CLIP_LENGTH_PRESETS[preset].label.toLowerCase()} · {aspect} · subtítulos {CAPTION_PRESETS[caption]?.label.toLowerCase()} · hasta {maxClips} clips
        <ChevronDown className={cn("size-3.5 transition", more && "rotate-180")} />
      </button>
      {more && (
        <div className="mt-3 grid gap-3 rounded-xl border border-line bg-bg/40 p-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <p className="mb-1.5 text-xs text-muted">Duración de los clips</p>
            <div className="flex flex-wrap gap-1.5">
              {(Object.keys(CLIP_LENGTH_PRESETS) as (keyof typeof CLIP_LENGTH_PRESETS)[]).map((k) => (
                <button key={k} type="button" onClick={() => setPreset(k)} className={cn("rounded-lg border px-3 py-1.5 text-xs", preset === k ? "border-ember/60 bg-ember/10" : "border-line text-muted")}>
                  {CLIP_LENGTH_PRESETS[k].label} {CLIP_LENGTH_PRESETS[k].minSec}–{CLIP_LENGTH_PRESETS[k].maxSec}s
                </button>
              ))}
            </div>
          </div>
          <label className="text-xs text-muted">
            Formato
            <select value={aspect} onChange={(e) => setAspect(e.target.value as AspectRatio)} className="mt-1 h-10 w-full rounded-lg border border-line bg-surface px-2 text-base text-text md:text-sm">
              {ASPECTS.map((a) => <option key={a.id} value={a.id}>{a.label} · {a.hint}</option>)}
            </select>
          </label>
          <label className="text-xs text-muted">
            Subtítulos
            <select value={caption} onChange={(e) => setCaption(e.target.value)} className="mt-1 h-10 w-full rounded-lg border border-line bg-surface px-2 text-base text-text md:text-sm">
              {Object.entries(CAPTION_PRESETS).map(([k, p]) => <option key={k} value={k}>{p.label}</option>)}
            </select>
          </label>
          <label className="text-xs text-muted">
            Máximo de clips
            <input type="number" min={1} max={30} value={maxClips} onChange={(e) => setMaxClips(Math.max(1, Math.min(30, Number(e.target.value))))} className="mt-1 h-10 w-full rounded-lg border border-line bg-surface px-2 text-base text-text md:text-sm" />
          </label>
          <p className="self-end text-[11px] text-faint">Para una duración personalizada, ajústala después en el proyecto.</p>
        </div>
      )}

      {!llmReady && (
        <p className="mt-3 flex gap-2 rounded-xl border border-warn/30 bg-warn/5 p-3 text-xs text-warn">
          <AlertTriangle className="size-4 shrink-0" /> La IA que detecta los momentos no está lista: {llmMissing}. Revisa Ajustes.
        </p>
      )}
      {error && (
        <p role="alert" className="mt-3 flex gap-2 rounded-xl border border-bad/30 bg-bad/10 p-3 text-sm text-bad">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" /> {error}
        </p>
      )}
      <p className="mt-3 text-xs text-faint">
        ¿Tienes el archivo en tu teléfono o computador?{" "}
        <Link href="/new" className="inline-flex items-center gap-1 text-ember-2 hover:underline">
          <Upload className="size-3" /> Súbelo aquí
        </Link>
      </p>
    </form>
  );
}
