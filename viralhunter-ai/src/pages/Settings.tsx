import { useEffect, useState } from "react";
import { Layout } from "../components/Layout";
import { MissingCredentials } from "../components/Missing";
import { getConfig } from "../lib/api";

export default function Settings() {
  const [cfg, setCfg] = useState<Awaited<ReturnType<typeof getConfig>> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [token, setToken] = useState(() => { try { return localStorage.getItem("vh_token") ?? ""; } catch { return ""; } });
  useEffect(() => {
    getConfig().then(setCfg).catch((e) => setError(e.message));
  }, []);
  const rows = cfg
    ? [
        ["Supabase / PostgreSQL", cfg.database],
        ["YouTube Data API v3", cfg.youtube],
        ["IA de análisis (Claude)", cfg.ai],
        ["Imágenes (OpenAI)", cfg.images],
        ["Voz (ElevenLabs)", cfg.voice],
      ]
    : [];
  return (
    <Layout>
      <h2 className="pt-6 text-2xl font-extrabold">Configuración de APIs</h2>
      <p className="mt-1 text-sm text-neutral-400">Estado de las integraciones del servidor.</p>
      {error && <p className="mt-4 text-sm text-red-400">{error}</p>}
      <div className="card mt-4 divide-y divide-white/[0.06]">
        {rows.map(([name, ok]) => (
          <div key={name as string} className="flex items-center justify-between px-4 py-3.5">
            <span className="text-[15px]">{name}</span>
            <span className={`chip ${ok ? "bg-emerald-500/15 text-emerald-300" : "bg-red-500/15 text-red-300"}`}>{ok ? "Conectado" : "Falta clave"}</span>
          </div>
        ))}
      </div>
      {cfg && (
        <div className="card mt-4 p-4 text-sm text-neutral-300">
          Cuota de YouTube hoy: <b>{cfg.quota.usedToday.toLocaleString("es-ES")}</b> / {cfg.quota.dailyLimit.toLocaleString("es-ES")} unidades · una búsqueda reciente consume ~{cfg.quota.costPerRecentSearch.toLocaleString("es-ES")}.
        </div>
      )}
      {cfg?.accessTokenRequired && (
        <div className="card mt-4 p-4">
          <label className="label" htmlFor="tok">Token de acceso de la app</label>
          <input id="tok" className="input" type="password" value={token} onChange={(e) => { setToken(e.target.value); try { localStorage.setItem("vh_token", e.target.value); } catch {} }} />
        </div>
      )}
      {cfg && <div className="mt-4"><MissingCredentials missing={cfg.missing} title="Cómo configurar lo que falta" /></div>}
    </Layout>
  );
}
