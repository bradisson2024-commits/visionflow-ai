import { useState } from "react";
import { ErrorBox } from "../components/Missing";
import { api, compact, ApiError } from "../lib/api";
import type { MissingCredential } from "../../shared/types";
import type { Project } from "./Replica";

export default function StageVideos({ project, reload }: { project: Project; reload: () => Promise<Project> }) {
  const vp = project.video_proposals;
  const brand = project.branding_selected;
  const [count, setCount] = useState(3);
  const [busy, setBusy] = useState<string | null>(null);
  const [open, setOpen] = useState<number | null>(0);
  const [error, setError] = useState<string | null>(null);
  const [missing, setMissing] = useState<MissingCredential[] | undefined>();

  const act = async (k: string, f: () => Promise<unknown>) => {
    setBusy(k);
    setError(null);
    setMissing(undefined);
    try {
      await f();
      await reload();
    } catch (e) {
      setError((e as Error).message);
      if (e instanceof ApiError) setMissing(e.missing);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-4 pt-2">
      <div className="card p-4">
        <div className="flex items-center gap-3">
          {brand?.logo && <img src={brand.logo.url} alt="" className="h-12 w-12 rounded-full object-cover" />}
          <div>
            <p className="text-[16px] font-bold">{brand?.name}</p>
            <p className="text-xs text-neutral-400">{brand?.tagline}</p>
          </div>
        </div>
        <p className="mt-4 text-[11px] font-semibold uppercase tracking-wide text-neutral-500">Vídeos de referencia analizados</p>
        <div className="mt-2 flex gap-2 overflow-x-auto pb-1">
          {project.channel_analysis?.topVideos?.slice(0, 12).map((v: any) => (
            <div key={v.id} className="w-28 shrink-0">
              <img src={v.thumbnailUrl} alt="" className="aspect-video w-full rounded-md object-cover" referrerPolicy="no-referrer" />
              <p className="mt-1 line-clamp-2 text-[10px] leading-3 text-neutral-400">{v.title}</p>
              <p className="text-[10px] font-semibold text-brand">{compact(v.viewCount)}</p>
            </div>
          ))}
        </div>
        <div className="mt-4 flex items-center gap-3">
          <label htmlFor="count" className="text-sm text-neutral-300">Propuestas</label>
          <select id="count" className="input w-24 py-2" value={count} onChange={(e) => setCount(Number(e.target.value))}>
            {[1, 2, 3, 4, 5, 6].map((n) => <option key={n}>{n}</option>)}
          </select>
        </div>
        <button className="btn-primary mt-4" disabled={!!busy} onClick={() => act("gen", () => api(`/projects/${project.id}/videos/generate`, { body: { count } }))}>
          {busy === "gen" ? "Escribiendo propuestas y guiones…" : vp ? "Generar nuevas propuestas" : "Generar propuestas de vídeo"}
        </button>
        {busy === "gen" && <div className="mt-3 flex items-center justify-center gap-2 text-xs text-neutral-400"><div className="spinner" />La IA está analizando las referencias y escribiendo guiones originales…</div>}
      </div>
      <ErrorBox error={error} missing={missing} />

      {vp?.referenceInsights?.length > 0 && (
        <div className="card p-4">
          <p className="text-[15px] font-bold">Qué funciona en las referencias <span className="chip ml-1 bg-white/10 text-neutral-300">Análisis IA</span></p>
          <ul className="mt-2 list-disc space-y-1 pl-4 text-[13px] leading-5 text-neutral-300">
            {vp.referenceInsights.map((x: string, i: number) => <li key={i}>{x}</li>)}
          </ul>
        </div>
      )}

      {vp?.proposals?.map((p: any, i: number) => (
        <article key={i} className="card overflow-hidden" data-testid="video-proposal">
          {p.thumbnail && <img src={p.thumbnail.url} alt="Miniatura" className="aspect-video w-full object-cover" />}
          <div className="p-4">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-brand">Vídeo {i + 1} · {p.durationMinutes} min</p>
            <h4 className="mt-1 text-[16px] font-bold leading-6">{p.title}</h4>
            <p className="mt-2 text-[13px] leading-5 text-neutral-300">{p.idea}</p>
            <div className="mt-3 rounded-xl border border-brand/20 bg-brand/[0.06] p-3">
              <p className="text-[11px] font-semibold uppercase text-brand">Gancho inicial</p>
              <p className="mt-1 text-[13px] leading-5">{p.hook}</p>
            </div>
            <button className="mt-3 text-[13px] font-medium text-brand" onClick={() => setOpen(open === i ? null : i)}>
              {open === i ? "Ocultar estructura y guion" : "Ver estructura y guion"}
            </button>
            {open === i && (
              <div className="mt-3 space-y-3 text-[13px] leading-5">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">Estructura</p>
                  <ol className="mt-1 space-y-1">
                    {p.structure.map((s: any, j: number) => (
                      <li key={j} className="flex gap-2"><span className="w-12 shrink-0 text-neutral-500">{s.seconds}s</span><span><b>{s.section}:</b> <span className="text-neutral-300">{s.content}</span></span></li>
                    ))}
                  </ol>
                </div>
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">Guion</p>
                  <p className="mt-1 whitespace-pre-wrap rounded-xl bg-ink-900 p-3 text-neutral-200">{p.script}</p>
                </div>
                <p><b>Estilo visual:</b> <span className="text-neutral-300">{p.visualStyle}</span></p>
                <p><b>Idea de miniatura:</b> <span className="text-neutral-300">{p.thumbnailIdea}</span></p>
                <p className="text-xs text-neutral-500">Inspiración: {p.inspiredBy}</p>
              </div>
            )}
            <button className="btn-ghost mt-3 w-full" disabled={!!busy} onClick={() => act(`thumb${i}`, () => api(`/projects/${project.id}/videos/${i}/thumbnail`, { body: {} }))}>
              {busy === `thumb${i}` ? "Generando miniatura…" : p.thumbnail ? "Regenerar miniatura" : "Generar miniatura"}
            </button>
          </div>
        </article>
      ))}
    </div>
  );
}
