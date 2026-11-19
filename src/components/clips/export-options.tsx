"use client";

import type { ExportOptions } from "@/server/db/schema";
import { cn } from "@/lib/cn";

export const DEFAULT_EXPORT_OPTS: ExportOptions = { resolution: 1080, quality: "high", fps: "source", subtitles: "burned" };

function Seg<T extends string | number>({ label, value, options, onChange }: { label: string; value: T; options: { v: T; l: string }[]; onChange: (v: T) => void }) {
  return (
    <div>
      <p className="mb-1.5 text-xs text-muted">{label}</p>
      <div className="flex flex-wrap gap-1.5">
        {options.map((o) => (
          <button
            key={String(o.v)}
            type="button"
            onClick={() => onChange(o.v)}
            className={cn("rounded-lg border px-3 py-1.5 text-xs transition", value === o.v ? "border-ember/60 bg-ember/10 text-text" : "border-line text-muted hover:text-text")}
          >
            {o.l}
          </button>
        ))}
      </div>
    </div>
  );
}

export function ExportOptionsForm({ value, onChange }: { value: ExportOptions; onChange: (v: ExportOptions) => void }) {
  return (
    <div className="space-y-3">
      <Seg label="Resolución (lado corto)" value={value.resolution} options={[{ v: 1080, l: "1080p" }, { v: 720, l: "720p" }]} onChange={(resolution) => onChange({ ...value, resolution })} />
      <Seg label="Calidad" value={value.quality} options={[{ v: "high", l: "Alta" }, { v: "medium", l: "Media" }, { v: "low", l: "Ligera" }]} onChange={(quality) => onChange({ ...value, quality })} />
      <Seg label="FPS" value={value.fps} options={[{ v: "source", l: "Original" }, { v: 24, l: "24" }, { v: 30, l: "30" }, { v: 60, l: "60" }]} onChange={(fps) => onChange({ ...value, fps })} />
      <Seg
        label="Subtítulos"
        value={value.subtitles}
        options={[{ v: "burned", l: "En el video" }, { v: "srt", l: "Archivo SRT" }, { v: "both", l: "Ambos" }, { v: "none", l: "Sin subtítulos" }]}
        onChange={(subtitles) => onChange({ ...value, subtitles })}
      />
      <p className="text-[11px] text-faint">No se amplía por encima de la resolución ni de los FPS del video original.</p>
    </div>
  );
}
