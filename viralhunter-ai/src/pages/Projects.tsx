import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Layout } from "../components/Layout";
import { ErrorBox } from "../components/Missing";
import { api, date } from "../lib/api";

const STAGES = ["Canal", "Estilo y voz", "Branding", "Vídeos"];

export default function Projects() {
  const nav = useNavigate();
  const [rows, setRows] = useState<any[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api<any[]>("/projects").then(setRows).catch((e) => setError(e.message));
  }, []);
  const create = async () => {
    try {
      const { id } = await api<{ id: string }>("/projects", { body: { url: "pendiente" } });
      nav(`/replica/${id}`);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <Layout>
      <h2 className="pt-6 text-2xl font-extrabold">ReplicaPro</h2>
      <p className="mt-1 text-sm text-neutral-400">Tus proyectos de réplica guardados.</p>
      <button className="btn-primary mt-4" onClick={create}>Nuevo proyecto</button>
      <div className="mt-4"><ErrorBox error={error} /></div>
      <div className="mt-4 space-y-3">
        {rows?.map((r) => (
          <Link key={r.id} to={`/replica/${r.id}`} className="card flex items-center gap-3 p-4 hover:border-white/15">
            {r.thumbnail_url ? <img src={r.thumbnail_url} alt="" className="h-11 w-11 rounded-full object-cover" referrerPolicy="no-referrer" /> : <div className="h-11 w-11 rounded-full bg-ink-700" />}
            <div className="min-w-0 flex-1">
              <p className="truncate text-[15px] font-semibold">{r.channel_title ?? "Canal sin analizar"}</p>
              <p className="text-xs text-neutral-400">Etapa {r.stage}: {STAGES[r.stage - 1]} · {date(r.updated_at)}</p>
            </div>
          </Link>
        ))}
      </div>
    </Layout>
  );
}
