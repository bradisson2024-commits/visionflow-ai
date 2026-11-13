import { useEffect, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { Layout } from "../components/Layout";
import { ChannelCard } from "../components/ChannelCard";
import { ErrorBox } from "../components/Missing";
import { api } from "../lib/api";
import type { ChannelResult } from "../../shared/types";

export default function Results() {
  const { id } = useParams();
  const loc = useLocation();
  const nav = useNavigate();
  const initial = loc.state as { results: ChannelResult[]; note?: string } | null;
  const [results, setResults] = useState<ChannelResult[] | null>(initial?.results ?? null);
  const [meta, setMeta] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    api(`/searches/${id}`)
      .then((r) => {
        setMeta(r.search);
        if (!initial) setResults(r.results);
      })
      .catch((e) => setError(e.message));
  }, [id]);

  const replicate = async (r: ChannelResult) => {
    setBusy(r.channel.id);
    try {
      const { id: pid } = await api<{ id: string }>("/projects", { body: { url: r.channelUrl } });
      nav(`/replica/${pid}`, { state: { url: r.channelUrl } });
    } catch (e) {
      setError((e as Error).message);
      setBusy(null);
    }
  };

  return (
    <Layout back="/">
      <section className="pt-6">
        <h2 className="text-2xl font-extrabold tracking-tight">Canales encontrados</h2>
        <p className="mt-1 text-sm text-neutral-400">
          {results ? `${results.length} canales verificados con datos reales de YouTube` : "Cargando…"}
          {meta?.niches?.length ? ` · ${meta.niches.join(" · ")}` : ""}
        </p>
        {initial?.note && <p className="mt-2 text-xs text-brand">{initial.note}</p>}
      </section>
      <div className="mt-4"><ErrorBox error={error} /></div>
      {results && results.length === 0 && (
        <div className="card mt-4 p-5 text-sm text-neutral-400">Hoy no hay canales que cumplan todos los criterios con datos reales. Prueba con una búsqueda por nicho.</div>
      )}
      <div className="mt-4 space-y-4">
        {results?.map((r) => (
          <div key={r.channel.id} className={busy === r.channel.id ? "pointer-events-none opacity-60" : ""}>
            <ChannelCard r={r} onReplicate={replicate} />
          </div>
        ))}
      </div>
    </Layout>
  );
}
