import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Layout } from "../components/Layout";
import { MissingCredentials } from "../components/Missing";
import { getConfig } from "../lib/api";

type Cfg = Awaited<ReturnType<typeof getConfig>>;

export default function Home() {
  const nav = useNavigate();
  const [cfg, setCfg] = useState<Cfg | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    getConfig().then(setCfg).catch((e) => setErr(e.message));
  }, []);

  const searchMissing = cfg?.missing.filter((m) => m.env === "YOUTUBE_API_KEY" || m.env === "DATABASE_URL") ?? [];
  const canSearch = !!cfg && searchMissing.length === 0 && cfg.quota.searchesLeftEstimate > 0;

  return (
    <Layout>
      <section className="pt-10 text-center">
        <h2 className="text-[30px] font-extrabold leading-tight tracking-tight">Encuentra canales ganadores</h2>
        <p className="mx-auto mt-3 max-w-[330px] text-[15px] leading-6 text-neutral-400">
          Descubre canales pequeños de YouTube con vídeos que están explotando y formatos que todavía no existen en español.
        </p>
      </section>

      <section className="card mt-8 p-5">
        <button className="btn-primary" disabled={!canSearch} onClick={() => nav("/buscando", { state: { kind: "recent" } })}>
          Buscar canales recientes
        </button>
        <p className="mt-3 text-center text-[13px] text-neutral-400" data-testid="counter">
          {cfg ? (
            <>
              Búsquedas disponibles hoy: <span className="font-semibold text-white">{cfg.quota.searchesLeftEstimate}</span>
              <span className="text-neutral-500"> · cuota YouTube {cfg.quota.usedToday.toLocaleString("es-ES")}/{cfg.quota.dailyLimit.toLocaleString("es-ES")}</span>
            </>
          ) : err ? (
            <span className="text-red-400">Servidor no disponible: {err}</span>
          ) : (
            "Cargando…"
          )}
        </p>

        <div className="my-5 h-px bg-white/[0.06]" />

        <button className="btn-secondary" onClick={() => nav("/nicho")}>
          Búsqueda por nicho
        </button>
        <p className="mt-3 text-center text-[13px] leading-5 text-neutral-500">
          Escribe una temática (historias cristianas, finanzas, misterios…) y filtra por idioma, país y fechas.
        </p>
      </section>

      <p className="mt-6 px-2 text-center text-xs leading-5 text-neutral-500">
        Datos públicos oficiales de YouTube Data API v3. Las puntuaciones, etiquetas de IA e ingresos son estimaciones de ViralHunter y se indican como tales.
      </p>

      {searchMissing.length > 0 && (
        <div className="mt-6">
          <MissingCredentials missing={searchMissing} title="Para buscar canales falta configurar:" />
        </div>
      )}
    </Layout>
  );
}
