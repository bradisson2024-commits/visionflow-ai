import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Layout } from "../components/Layout";

const SUGGESTIONS = ["Historias cristianas", "Finanzas", "Misterios", "Motivación", "Documentales", "Psicología", "Inteligencia artificial", "Curiosidades"];
const LANGS = [["", "Cualquier idioma"], ["es", "Español"], ["en", "Inglés"], ["pt", "Portugués"], ["fr", "Francés"], ["de", "Alemán"], ["it", "Italiano"]];
const COUNTRIES = [["", "Cualquier país"], ["ES", "España"], ["MX", "México"], ["AR", "Argentina"], ["CO", "Colombia"], ["CL", "Chile"], ["PE", "Perú"], ["US", "Estados Unidos"], ["BR", "Brasil"], ["GB", "Reino Unido"]];

const iso = (d: Date) => d.toISOString().slice(0, 10);

export default function Niche() {
  const nav = useNavigate();
  const [topic, setTopic] = useState("");
  const [language, setLanguage] = useState("es");
  const [country, setCountry] = useState("");
  const [after, setAfter] = useState(iso(new Date(Date.now() - 30 * 86400_000)));
  const [before, setBefore] = useState(iso(new Date()));

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (topic.trim().length < 2) return;
    nav("/buscando", { state: { kind: "niche", params: { topic: topic.trim(), language, country, publishedAfter: after, publishedBefore: before } } });
  };

  return (
    <Layout back="/">
      <section className="pt-8 text-center">
        <h2 className="text-[26px] font-extrabold tracking-tight">Búsqueda por nicho</h2>
        <p className="mt-2 text-sm text-neutral-400">Busca canales emergentes en cualquier temática con el mismo sistema de puntuación.</p>
      </section>
      <form onSubmit={submit} className="card mt-6 space-y-4 p-5">
        <div>
          <label className="label" htmlFor="topic">Temática</label>
          <input id="topic" className="input" placeholder="Ej.: historias cristianas" value={topic} onChange={(e) => setTopic(e.target.value)} maxLength={120} />
          <div className="mt-3 flex flex-wrap gap-2">
            {SUGGESTIONS.map((s) => (
              <button type="button" key={s} onClick={() => setTopic(s)} className={`rounded-full border px-3 py-1.5 text-xs ${topic === s ? "border-brand bg-brand/10 text-brand" : "border-white/10 text-neutral-300 hover:bg-white/5"}`}>
                {s}
              </button>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label" htmlFor="lang">Idioma</label>
            <select id="lang" className="input" value={language} onChange={(e) => setLanguage(e.target.value)}>
              {LANGS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="country">País</label>
            <select id="country" className="input" value={country} onChange={(e) => setCountry(e.target.value)}>
              {COUNTRIES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label" htmlFor="after">Desde</label>
            <input id="after" type="date" className="input" value={after} max={before} onChange={(e) => setAfter(e.target.value)} />
          </div>
          <div>
            <label className="label" htmlFor="before">Hasta</label>
            <input id="before" type="date" className="input" value={before} min={after} max={iso(new Date())} onChange={(e) => setBefore(e.target.value)} />
          </div>
        </div>
        <button className="btn-primary" disabled={topic.trim().length < 2}>Buscar canales</button>
        <p className="text-center text-xs text-neutral-500">Idioma y país orientan la búsqueda de YouTube (relevanceLanguage / regionCode).</p>
      </form>
    </Layout>
  );
}
