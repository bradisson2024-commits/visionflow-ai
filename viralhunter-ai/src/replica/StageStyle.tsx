import { useEffect, useMemo, useState } from "react";
import { ErrorBox } from "../components/Missing";
import { api, ApiError } from "../lib/api";
import type { MissingCredential } from "../../shared/types";
import type { Project } from "./Replica";

const LANGS = [["es", "Español"], ["en", "Inglés"], ["pt", "Portugués"], ["fr", "Francés"], ["de", "Alemán"], ["it", "Italiano"]];

type Err = { msg: string | null; missing?: MissingCredential[] };
const toErr = (e: unknown): Err => ({ msg: (e as Error).message, missing: e instanceof ApiError ? e.missing : undefined });

export default function StageStyle({ project, reload, next }: { project: Project; reload: () => Promise<Project>; next: () => void }) {
  const s = project.style_analysis;
  const choices = project.style_choices ?? {};
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<Err>({ msg: null });
  const [characterMode, setCharacterMode] = useState<"none" | "create">(choices.character?.mode ?? "none");
  const [characterDesc, setCharacterDesc] = useState<string>(choices.character?.description ?? "");
  const [language, setLanguage] = useState<string>(choices.language ?? project.channel_analysis?.language ?? "es");
  const [voices, setVoices] = useState<any[] | null>(null);
  const [voiceErr, setVoiceErr] = useState<Err>({ msg: null });
  const [voiceId, setVoiceId] = useState<string>(choices.voice?.voiceId ?? "");
  const [stability, setStability] = useState<number>(choices.voice?.stability ?? 0.5);
  const [similarity, setSimilarity] = useState<number>(choices.voice?.similarity ?? 0.75);
  const [styleExag, setStyleExag] = useState<number>(choices.voice?.style ?? 0.2);
  const [speed, setSpeed] = useState<number>(choices.voice?.speed ?? 1);
  const [sampleText, setSampleText] = useState("Hoy vas a descubrir una historia que muy poca gente conoce. Quédate hasta el final, porque lo que ocurrió después lo cambió todo.");
  const [sample, setSample] = useState<{ id: string; url: string } | null>(null);

  const refs = useMemo(() => project.assets.filter((a) => a.kind === "style_ref"), [project.assets]);
  const characters = useMemo(() => project.assets.filter((a) => a.kind === "character"), [project.assets]);

  useEffect(() => {
    api<any[]>("/voices").then(setVoices).catch((e) => setVoiceErr(toErr(e)));
  }, []);

  const act = async (key: string, f: () => Promise<unknown>) => {
    setBusy(key);
    setErr({ msg: null });
    try {
      await f();
      await reload();
    } catch (e) {
      setErr(toErr(e));
    } finally {
      setBusy(null);
    }
  };

  const filteredVoices = voices ?? [];
  const voice = filteredVoices.find((v) => v.id === voiceId);

  const approve = () =>
    act("approve", async () => {
      await api(`/projects/${project.id}/style/approve`, {
        body: {
          language,
          character: { mode: characterMode, description: characterMode === "create" ? characterDesc : undefined, assetId: characterMode === "create" ? characters.at(-1)?.id : undefined },
          voice: voice ? { voiceId: voice.id, voiceName: voice.name, stability, similarity, style: styleExag, speed, sampleAssetId: sample?.id } : null,
          referenceAssetIds: refs.map((r) => r.id),
        },
      });
      next();
    });

  return (
    <div className="space-y-4 pt-2">
      {!s ? (
        <div className="card p-5 text-center">
          <h3 className="text-lg font-bold">Análisis de estilo y voz</h3>
          <p className="mt-2 text-sm text-neutral-400">La IA examina las miniaturas, títulos y descripciones de los vídeos más vistos del canal.</p>
          <button className="btn-primary mt-4" disabled={!!busy} onClick={() => act("analyze", () => api(`/projects/${project.id}/style/analyze`, { body: {} }))}>
            {busy === "analyze" ? "Analizando estilo…" : "Analizar estilo con IA"}
          </button>
          {busy === "analyze" && <div className="mt-4 flex items-center justify-center gap-2 text-xs text-neutral-400"><div className="spinner" /> Enviando {Math.min(8, project.channel_analysis?.topVideos?.length ?? 0)} miniaturas al modelo de visión…</div>}
        </div>
      ) : (
        <div className="card p-4">
          <div className="flex items-center justify-between">
            <h3 className="text-[16px] font-bold">Conclusiones del análisis</h3>
            <span className="chip bg-white/10 text-neutral-300">Análisis IA</span>
          </div>
          <dl className="mt-3 space-y-3 text-[13px] leading-5">
            {[
              ["Estilo narrativo", s.narrativeStyle],
              ["Tono", s.tone],
              ["Tipo de voz", s.voiceType],
              ["Estilo visual", s.visualStyle],
              ["Composición", s.composition],
              ["Ilustraciones", s.illustrations],
              ["Personajes", s.characters],
              ["Ritmo de los vídeos", s.rhythm],
            ].map(([k, v]) => (
              <div key={k}>
                <dt className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">{k}</dt>
                <dd className="text-neutral-200">{v}</dd>
              </div>
            ))}
            <div>
              <dt className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">Colores</dt>
              <dd className="mt-1 flex flex-wrap gap-2">
                {s.colors.map((c: any) => (
                  <span key={c.hex + c.name} className="flex items-center gap-1.5 rounded-full bg-ink-900 py-1 pl-1 pr-2.5 text-[11px]">
                    <span className="h-4 w-4 rounded-full border border-white/10" style={{ background: c.hex }} /> {c.name}
                  </span>
                ))}
              </dd>
            </div>
            <p className="text-[11px] text-neutral-500">Limitaciones: {s.limitations}</p>
          </dl>
          <button className="btn-ghost mt-3 w-full" disabled={!!busy} onClick={() => act("analyze", () => api(`/projects/${project.id}/style/analyze`, { body: {} }))}>
            {busy === "analyze" ? "Analizando…" : "Repetir análisis"}
          </button>
        </div>
      )}

      {s && (
        <>
          <section className="card p-4">
            <h3 className="text-[16px] font-bold">Imágenes de referencia originales</h3>
            <p className="mt-1 text-xs text-neutral-500">Generadas por el proveedor de imágenes configurado (gratis por defecto) a partir del estilo analizado. No copian personajes ni logotipos.</p>
            <div className="mt-3 grid grid-cols-2 gap-2">
              {refs.map((r) => <img key={r.id} src={r.url} alt="Referencia de estilo" className="aspect-[3/2] w-full rounded-lg object-cover" data-testid="style-ref" />)}
            </div>
            <button className="btn-secondary mt-3" disabled={!!busy} onClick={() => act("refs", () => api(`/projects/${project.id}/style/images`, { body: {} }))}>
              {busy === "refs" ? "Generando imágenes…" : refs.length ? "Generar más referencias" : "Generar imágenes de referencia"}
            </button>
          </section>

          <section className="card p-4">
            <h3 className="text-[16px] font-bold">Personaje</h3>
            <div className="mt-3 grid grid-cols-2 gap-2">
              {(["create", "none"] as const).map((m) => (
                <button key={m} onClick={() => setCharacterMode(m)} className={`rounded-xl border px-3 py-3 text-[13px] font-semibold ${characterMode === m ? "border-brand bg-brand/10 text-brand" : "border-white/10 text-neutral-300"}`}>
                  {m === "create" ? "Crear un personaje" : "Continuar sin personaje"}
                </button>
              ))}
            </div>
            {characterMode === "create" && (
              <div className="mt-3">
                <textarea className="input min-h-[90px]" placeholder="Describe tu personaje: aspecto, edad, ropa, personalidad…" value={characterDesc} onChange={(e) => setCharacterDesc(e.target.value)} maxLength={800} />
                <button className="btn-secondary mt-2" disabled={!!busy || characterDesc.trim().length < 5} onClick={() => act("char", () => api(`/projects/${project.id}/character`, { body: { description: characterDesc } }))}>
                  {busy === "char" ? "Generando personaje…" : "Generar personaje"}
                </button>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  {characters.map((c) => <img key={c.id} src={c.url} alt="Personaje" className="aspect-square w-full rounded-lg object-cover" />)}
                </div>
              </div>
            )}
          </section>

          <section className="card p-4">
            <h3 className="text-[16px] font-bold">Voz de narración</h3>
            <p className="mt-1 text-xs text-neutral-500">Voces reales de tu biblioteca de ElevenLabs. No se clona ninguna voz.</p>
            <div className="mt-3">
              <label className="label" htmlFor="vlang">Idioma del nuevo canal</label>
              <select id="vlang" className="input" value={language} onChange={(e) => setLanguage(e.target.value)}>
                {LANGS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
            <ErrorBox error={voiceErr.msg} missing={voiceErr.missing} />
            {voices && (
              <>
                <div className="mt-3">
                  <label className="label" htmlFor="voice">Voz</label>
                  <select id="voice" className="input" value={voiceId} onChange={(e) => setVoiceId(e.target.value)}>
                    <option value="">Elige una voz…</option>
                    {voices.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.name} {[v.gender, v.age, v.accent].filter(Boolean).length ? `· ${[v.gender, v.age, v.accent].filter(Boolean).join(", ")}` : ""}
                      </option>
                    ))}
                  </select>
                  {voice?.previewUrl && <audio className="mt-2 w-full" controls src={voice.previewUrl} />}
                </div>
                <div className="mt-3 space-y-3">
                  <Slider label="Estabilidad" value={stability} set={setStability} min={0} max={1} step={0.05} />
                  <Slider label="Similitud" value={similarity} set={setSimilarity} min={0} max={1} step={0.05} />
                  <Slider label="Expresividad" value={styleExag} set={setStyleExag} min={0} max={1} step={0.05} />
                  <Slider label="Velocidad" value={speed} set={setSpeed} min={0.7} max={1.2} step={0.05} />
                </div>
                <textarea className="input mt-3 min-h-[80px]" value={sampleText} onChange={(e) => setSampleText(e.target.value)} maxLength={600} />
                <button
                  className="btn-secondary mt-2"
                  disabled={!!busy || !voiceId}
                  onClick={() =>
                    act("voice", async () => {
                      const r = await api(`/projects/${project.id}/voice/sample`, { body: { voiceId, text: sampleText, language, stability, similarity, style: styleExag, speed } });
                      setSample(r);
                    })
                  }
                >
                  {busy === "voice" ? "Sintetizando…" : "Generar muestra de voz"}
                </button>
                {sample && <audio className="mt-3 w-full" controls autoPlay src={sample.url} data-testid="voice-sample" />}
              </>
            )}
          </section>

          <ErrorBox error={err.msg} missing={err.missing} />
          <button className="btn-primary" disabled={!!busy} onClick={approve}>
            {busy === "approve" ? "Guardando…" : "Aprobar estilo y continuar"}
          </button>
        </>
      )}
      {!s && <ErrorBox error={err.msg} missing={err.missing} />}
    </div>
  );
}

function Slider({ label, value, set, min, max, step }: { label: string; value: number; set: (n: number) => void; min: number; max: number; step: number }) {
  return (
    <label className="block">
      <div className="mb-1 flex justify-between text-[13px]"><span className="text-neutral-300">{label}</span><span className="text-neutral-400">{value.toFixed(2)}</span></div>
      <input type="range" className="w-full accent-[#ff7a00]" min={min} max={max} step={step} value={value} onChange={(e) => set(Number(e.target.value))} />
    </label>
  );
}
