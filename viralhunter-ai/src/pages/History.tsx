import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Layout } from "../components/Layout";
import { ErrorBox } from "../components/Missing";
import { api, date } from "../lib/api";

export default function History() {
  const [rows, setRows] = useState<any[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api<any[]>("/searches").then(setRows).catch((e) => setError(e.message));
  }, []);
  return (
    <Layout>
      <h2 className="pt-6 text-2xl font-extrabold">Historial de búsquedas</h2>
      <div className="mt-4"><ErrorBox error={error} /></div>
      <div className="mt-4 space-y-3">
        {rows?.length === 0 && <p className="text-sm text-neutral-400">Aún no hay búsquedas.</p>}
        {rows?.map((r) => (
          <Link key={r.id} to={`/resultados/${r.id}`} className="card block p-4 hover:border-white/15">
            <div className="flex items-center justify-between">
              <span className="text-[15px] font-semibold">{r.kind === "recent" ? "Canales recientes" : `Nicho: ${r.params?.topic}`}</span>
              <span className={`chip ${r.status === "done" ? "bg-brand/15 text-brand" : r.status === "error" ? "bg-red-500/15 text-red-300" : "bg-white/10 text-neutral-300"}`}>{r.status === "done" ? `${r.results} canales` : r.status}</span>
            </div>
            <p className="mt-1 text-xs text-neutral-400">{date(r.created_at)} · {(r.niches ?? []).join(" · ")} · {r.quota_units} unidades</p>
          </Link>
        ))}
      </div>
    </Layout>
  );
}
