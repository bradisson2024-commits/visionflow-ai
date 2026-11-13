import { useState } from "react";
import type { ChannelResult } from "../../shared/types";
import { compact, fmt, ago, date, duration } from "../lib/api";

const LANG: Record<string, string> = { es: "Español", en: "Inglés", pt: "Portugués", fr: "Francés", de: "Alemán", it: "Italiano", hi: "Hindi", ja: "Japonés", ko: "Coreano", ru: "Ruso", ar: "Árabe" };

const TAG_STYLE: Record<string, string> = {
  viral_7d: "bg-brand text-black",
  viral_month: "bg-brand/15 text-brand",
  unique_format_es: "bg-emerald-500/15 text-emerald-300",
  faceless: "bg-sky-500/15 text-sky-300",
  faceless_ai: "bg-violet-500/15 text-violet-300",
  emerging_niche: "bg-yellow-500/15 text-yellow-300",
};

function ScoreRing({ score }: { score: number }) {
  const r = 22, c = 2 * Math.PI * r;
  return (
    <div className="relative h-14 w-14 shrink-0" title="Puntuación ViralHunter sobre 100">
      <svg viewBox="0 0 56 56" className="h-14 w-14 -rotate-90">
        <circle cx="28" cy="28" r={r} stroke="#262626" strokeWidth="5" fill="none" />
        <circle cx="28" cy="28" r={r} stroke="#ff7a00" strokeWidth="5" fill="none" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - score / 100)} />
      </svg>
      <div className="absolute inset-0 grid place-items-center">
        <div className="text-center leading-none">
          <div className="text-[17px] font-extrabold">{score}</div>
          <div className="text-[9px] text-neutral-500">/100</div>
        </div>
      </div>
    </div>
  );
}

export function ChannelCard({ r, onReplicate }: { r: ChannelResult; onReplicate: (r: ChannelResult) => void }) {
  const [open, setOpen] = useState(false);
  const ch = r.channel;
  return (
    <article className="card overflow-hidden" data-testid="channel-card">
      <div className="p-4">
        <div className="flex items-start gap-3">
          <img src={ch.thumbnailUrl} alt="" className="h-14 w-14 shrink-0 rounded-full bg-ink-700 object-cover" referrerPolicy="no-referrer" />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 text-xs text-neutral-500">#{r.rank}</div>
            <h3 className="truncate text-[16px] font-bold leading-6">{ch.title}</h3>
            <p className="text-[13px] text-neutral-400">
              <span className="font-semibold text-white">{ch.subscribersHidden ? "Suscriptores ocultos" : `${compact(ch.subscriberCount)} suscriptores`}</span>
              {" · "}
              {fmt(ch.videoCount)} vídeos
            </p>
          </div>
          <ScoreRing score={r.score.total} />
        </div>

        {ch.description && <p className="mt-3 line-clamp-2 text-[13px] leading-5 text-neutral-400">{ch.description}</p>}

        <div className="mt-3 grid grid-cols-3 gap-2 text-center">
          <div className="rounded-xl bg-ink-900 px-2 py-2">
            <div className="text-[10px] uppercase tracking-wide text-neutral-500">Nicho</div>
            <div className="truncate text-[12px] font-semibold">{r.niche}</div>
          </div>
          <div className="rounded-xl bg-ink-900 px-2 py-2">
            <div className="text-[10px] uppercase tracking-wide text-neutral-500">Idioma</div>
            <div className="text-[12px] font-semibold" title={r.languageSource === "title_detection" ? "Detectado por los títulos" : "Declarado en YouTube"}>
              {LANG[r.language] ?? r.language}
              {r.languageSource === "title_detection" ? "*" : ""}
            </div>
          </div>
          <div className="rounded-xl bg-ink-900 px-2 py-2">
            <div className="text-[10px] uppercase tracking-wide text-neutral-500">Creado</div>
            <div className="text-[12px] font-semibold">{ago(ch.publishedAt)}</div>
          </div>
        </div>

        {r.tags.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {r.tags.map((t) => (
              <span key={t.id} className={`chip ${TAG_STYLE[t.id]}`} title={t.evidence}>
                {t.label}
                {t.source === "ai_analysis" ? " · IA" : ""}
              </span>
            ))}
          </div>
        )}

        <div className="mt-4 space-y-2.5">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">Vídeos destacados</p>
          {r.featuredVideos.map((v) => (
            <a key={v.id} href={`https://www.youtube.com/watch?v=${v.id}`} target="_blank" rel="noreferrer" className="flex gap-3 rounded-xl hover:bg-white/[0.03]">
              <div className="relative w-32 shrink-0">
                <img src={v.thumbnailUrl} alt="" className="aspect-video w-full rounded-lg bg-ink-700 object-cover" referrerPolicy="no-referrer" />
                {v.durationSec !== null && <span className="absolute bottom-1 right-1 rounded bg-black/80 px-1 text-[10px]">{duration(v.durationSec)}</span>}
              </div>
              <div className="min-w-0 py-0.5">
                <p className="line-clamp-2 text-[13px] font-medium leading-[18px]">{v.title}</p>
                <p className="mt-1 text-[12px] text-neutral-400">
                  <span className="font-semibold text-brand">{compact(v.viewCount)} vistas</span> · {date(v.publishedAt)}
                </p>
              </div>
            </a>
          ))}
        </div>

        <div className="mt-4 rounded-xl border border-white/[0.06] bg-ink-900 p-3">
          <div className="flex items-center justify-between">
            <span className="text-[12px] text-neutral-400">Ingresos mensuales estimados</span>
            <span className="text-[15px] font-bold">
              ${fmt(r.revenue.lowUsd)} – ${fmt(r.revenue.highUsd)}
            </span>
          </div>
          <p className="mt-1 text-[11px] text-neutral-500">Estimación, no cifra oficial.</p>
          <button className="mt-1 text-[12px] font-medium text-brand" onClick={() => setOpen(!open)}>
            {open ? "Ocultar detalles" : "Ver hipótesis y puntuación"}
          </button>
          {open && (
            <div className="mt-2 space-y-3 text-[12px] leading-5 text-neutral-400">
              <ul className="list-disc space-y-1 pl-4">
                {r.revenue.assumptions.map((a, i) => <li key={i}>{a}</li>)}
              </ul>
              <div>
                <p className="mb-1 font-semibold text-neutral-300">Puntuación {r.score.total}/100</p>
                {r.score.components.map((c) => (
                  <div key={c.key} className="flex justify-between gap-2">
                    <span>{c.label} <span className="text-neutral-500">({c.value})</span></span>
                    <span className="shrink-0 text-white">{c.points}/{c.max}</span>
                  </div>
                ))}
              </div>
              {r.tags.length > 0 && (
                <div>
                  <p className="mb-1 font-semibold text-neutral-300">Por qué estas etiquetas</p>
                  {r.tags.map((t) => <p key={t.id}><span className="text-white">{t.label}:</span> {t.evidence}</p>)}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2 border-t border-white/[0.06] p-3">
        <button className="rounded-xl bg-brand py-3 text-[14px] font-semibold text-black hover:bg-brand-400" onClick={() => onReplicate(r)}>
          Replicar este canal
        </button>
        <a className="rounded-xl bg-ink-700 py-3 text-center text-[14px] font-semibold text-white hover:bg-ink-600" href={r.channelUrl} target="_blank" rel="noreferrer">
          Ver canal
        </a>
      </div>
    </article>
  );
}
