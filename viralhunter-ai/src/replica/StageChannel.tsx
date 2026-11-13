import { useState } from "react";
import { Steps, applyStep, initSteps, type StepState } from "../components/Steps";
import { ErrorBox } from "../components/Missing";
import { stream, compact, date, duration, fmt, ApiError } from "../lib/api";
import type { MissingCredential } from "../../shared/types";
import type { Project } from "./Replica";

export default function StageChannel({ project, prefill, reload, next }: { project: Project; prefill: string; reload: () => Promise<Project>; next: () => void }) {
  const [url, setUrl] = useState(prefill);
  const [steps, setSteps] = useState<StepState[]>([]);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [missing, setMissing] = useState<MissingCredential[] | undefined>();
  const a = project.channel_analysis;

  const analyze = async () => {
    setRunning(true);
    setError(null);
    setMissing(undefined);
    setSteps([]);
    try {
      await stream(`/projects/${project.id}/analyze`, { url }, (e) => {
        if (e.type === "steps") setSteps(initSteps(e.labels));
        else if (e.type === "step") setSteps((s) => applyStep(s, e));
        else if (e.type === "error") {
          setError(e.message);
          setMissing(e.missing);
        }
      });
      await reload();
    } catch (e) {
      setError((e as Error).message);
      if (e instanceof ApiError) setMissing(e.missing);
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="space-y-4 pt-2">
      <div className="card p-5">
        <label className="label" htmlFor="url">Link del canal a replicar</label>
        <input id="url" className="input" placeholder="https://www.youtube.com/@canal" value={url} onChange={(e) => setUrl(e.target.value)} />
        <button className="btn-primary mt-4" disabled={running || url.trim().length < 3} onClick={analyze}>
          {running ? "Analizando…" : "Analizar canal"}
        </button>
      </div>

      {steps.length > 0 && (running || !a) && (
        <div className="card p-5">
          <Steps steps={steps} />
        </div>
      )}
      <ErrorBox error={error} missing={missing} />

      {a && !running && (
        <>
          <div className="card p-4">
            <div className="flex items-center gap-3">
              <img src={a.channel.thumbnailUrl} alt="" className="h-14 w-14 rounded-full object-cover" referrerPolicy="no-referrer" />
              <div className="min-w-0">
                <h3 className="truncate text-[17px] font-bold">{a.channel.title}</h3>
                <p className="text-[13px] text-neutral-400">
                  {a.channel.subscribersHidden ? "Suscriptores ocultos" : `${compact(a.channel.subscriberCount)} suscriptores`} · {fmt(a.channel.videoCount)} vídeos · {compact(a.channel.viewCount)} vistas
                </p>
                <p className="text-[12px] text-neutral-500">Creado el {date(a.channel.publishedAt)}</p>
              </div>
            </div>
            <div className="mt-4 grid grid-cols-3 gap-2 text-center">
              <Stat label="Vídeos/semana" value={String(a.patterns.uploadsPerWeek90d)} />
              <Stat label="Mediana vistas" value={compact(a.patterns.medianViews)} />
              <Stat label="Días entre vídeos" value={a.patterns.medianDaysBetweenUploads === null ? "—" : String(a.patterns.medianDaysBetweenUploads)} />
            </div>
          </div>

          <div className="card p-4">
            <h4 className="text-[15px] font-bold">Patrones de publicación</h4>
            <p className="mt-1 text-xs text-neutral-500">Últimos {a.patterns.analyzedVideos} vídeos · datos de YouTube</p>
            <div className="mt-3 space-y-1.5 text-[13px]">
              {a.patterns.durationBuckets.filter((b: any) => b.count).map((b: any) => (
                <div key={b.label} className="flex justify-between"><span className="text-neutral-400">{b.label}</span><span>{b.count} vídeos · mediana {compact(b.medianViews)}</span></div>
              ))}
            </div>
            <div className="mt-3 flex items-end gap-1" aria-label="Distribución por día de la semana">
              {a.patterns.weekdayDistribution.map((d: any) => {
                const max = Math.max(1, ...a.patterns.weekdayDistribution.map((x: any) => x.count));
                return (
                  <div key={d.day} className="flex-1 text-center">
                    <div className="mx-auto w-full rounded-t bg-brand/70" style={{ height: `${(d.count / max) * 48 + 2}px` }} />
                    <div className="mt-1 text-[10px] text-neutral-500">{d.day.slice(0, 2)}</div>
                  </div>
                );
              })}
            </div>
            <p className="mt-3 text-[12px] text-neutral-400">
              Títulos: media {a.patterns.titles.avgLength} caracteres · {a.patterns.titles.withNumbers} con números · {a.patterns.titles.withQuestion} con pregunta · {a.patterns.titles.withAllCapsWord} con MAYÚSCULAS
            </p>
          </div>

          {a.formats ? (
            <div className="card p-4">
              <h4 className="text-[15px] font-bold">Formatos de contenido <span className="chip ml-1 bg-white/10 text-neutral-300">Análisis IA</span></h4>
              <p className="mt-2 text-[13px] leading-5 text-neutral-300">{a.formats.summary}</p>
              <div className="mt-3 space-y-2">
                {a.formats.formats.map((f: any) => (
                  <div key={f.name} className="rounded-xl bg-ink-900 p-3">
                    <p className="text-[14px] font-semibold">{f.name} <span className="text-xs font-normal text-neutral-500">· {f.share}</span></p>
                    <p className="mt-1 text-[12px] leading-5 text-neutral-400">{f.description}</p>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            a.formatsNote && <p className="text-xs text-brand">{a.formatsNote}</p>
          )}

          <div className="card p-4">
            <h4 className="text-[15px] font-bold">Vídeos más vistos</h4>
            <div className="mt-3 space-y-3">
              {a.topVideos.map((v: any, i: number) => (
                <a key={v.id} href={`https://www.youtube.com/watch?v=${v.id}`} target="_blank" rel="noreferrer" className="flex gap-3" data-testid="top-video">
                  <div className="relative w-36 shrink-0">
                    <img src={v.thumbnailUrl} alt="" className="aspect-video w-full rounded-lg object-cover" referrerPolicy="no-referrer" />
                    <span className="absolute left-1 top-1 rounded bg-black/80 px-1.5 text-[10px] font-bold">#{i + 1}</span>
                    {v.durationSec !== null && <span className="absolute bottom-1 right-1 rounded bg-black/80 px-1 text-[10px]">{duration(v.durationSec)}</span>}
                  </div>
                  <div className="min-w-0">
                    <p className="line-clamp-2 text-[13px] font-medium leading-[18px]">{v.title}</p>
                    <p className="mt-1 text-[12px]"><span className="font-semibold text-brand">{fmt(v.viewCount)} vistas</span></p>
                    <p className="text-[11px] text-neutral-500">{date(v.publishedAt)}</p>
                  </div>
                </a>
              ))}
            </div>
          </div>
          <button className="btn-primary" onClick={next}>Continuar a Estilo y voz</button>
        </>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-ink-900 px-2 py-2">
      <div className="text-[15px] font-bold">{value}</div>
      <div className="text-[10px] text-neutral-500">{label}</div>
    </div>
  );
}
