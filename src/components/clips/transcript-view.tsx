"use client";

import { useState } from "react";
import { ChevronDown, FileText } from "lucide-react";
import type { TranscriptSegment } from "@/server/db/schema";
import { cn } from "@/lib/cn";
import { formatDuration } from "@/lib/format";

export function TranscriptView({ segments, provider, model, language, wordCount }: { segments: TranscriptSegment[]; provider: string; model: string | null; language: string | null; wordCount: number }) {
  const [open, setOpen] = useState(false);
  return (
    <section className="rounded-3xl border border-line bg-surface p-5">
      <button onClick={() => setOpen((o) => !o)} className="flex w-full items-center justify-between gap-2 text-left" aria-expanded={open}>
        <h2 className="font-display flex items-center gap-2 text-lg font-semibold">
          <FileText className="size-5 text-ember-2" /> Transcripción
        </h2>
        <ChevronDown className={cn("size-5 text-muted transition", open && "rotate-180")} />
      </button>
      <p className="mt-1 text-xs text-faint">
        {wordCount} palabras · {provider}
        {model ? ` · ${model}` : ""}
        {language ? ` · idioma: ${language}` : ""}
      </p>
      {open && (
        <ol className="mt-4 max-h-[60vh] space-y-2 overflow-y-auto pr-1">
          {segments.map((s) => (
            <li key={s.id} className="flex gap-3 text-sm">
              <span className="w-12 shrink-0 pt-0.5 text-right text-xs tabular-nums text-faint">{formatDuration(s.s)}</span>
              <span className="text-muted">{s.text}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
