import { useCallback, useEffect, useState } from "react";
import { useLocation, useParams } from "react-router-dom";
import { Layout } from "../components/Layout";
import { ErrorBox } from "../components/Missing";
import { api } from "../lib/api";
import StageChannel from "./StageChannel";
import StageStyle from "./StageStyle";
import StageBranding from "./StageBranding";
import StageVideos from "./StageVideos";

export const STAGES = ["Canal", "Estilo y voz", "Branding", "Vídeos"];

export type Project = Record<string, any> & { id: string; stage: number; assets: any[] };

export default function Replica() {
  const { id } = useParams();
  const loc = useLocation();
  const [project, setProject] = useState<Project | null>(null);
  const [active, setActive] = useState(1);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const p = await api<Project>(`/projects/${id}`);
    setProject(p);
    return p;
  }, [id]);

  useEffect(() => {
    reload().then((p) => setActive(p.stage)).catch((e) => setError(e.message));
  }, [reload]);

  const allowed = (n: number) =>
    !!project && (n === 1 || (n === 2 && !!project.channel_analysis) || (n === 3 && project.style_approved) || (n === 4 && project.branding_approved));

  const go = (n: number) => {
    if (allowed(n)) {
      setActive(n);
      window.scrollTo({ top: 0 });
    }
  };

  const prefill = (loc.state as any)?.url ?? (project?.source_url && project.source_url !== "pendiente" ? project.source_url : "");

  return (
    <Layout title="ReplicaPro" back="/proyectos">
      <nav className="sticky top-14 z-20 -mx-4 bg-black/95 px-4 pb-3 pt-4 backdrop-blur" aria-label="Etapas">
        <ol className="grid grid-cols-4 gap-2">
          {STAGES.map((s, i) => {
            const n = i + 1;
            const on = n === active;
            const ok = allowed(n);
            return (
              <li key={s}>
                <button
                  onClick={() => go(n)}
                  disabled={!ok}
                  aria-current={on ? "step" : undefined}
                  className="w-full text-center disabled:cursor-not-allowed"
                  data-testid={`stage-${n}`}
                >
                  <div className={`h-1.5 rounded-full ${on ? "bg-brand" : n < active ? "bg-brand/40" : "bg-neutral-700"}`} />
                  <div className={`mt-2 text-[11px] font-semibold leading-4 ${on ? "text-brand" : "text-neutral-500"}`}>
                    {n}. {s}
                  </div>
                </button>
              </li>
            );
          })}
        </ol>
      </nav>
      <ErrorBox error={error} />
      {project && active === 1 && <StageChannel project={project} prefill={prefill} reload={reload} next={() => go(2)} />}
      {project && active === 2 && <StageStyle project={project} reload={reload} next={async () => { await reload(); setActive(3); window.scrollTo({ top: 0 }); }} />}
      {project && active === 3 && <StageBranding project={project} reload={reload} next={async () => { await reload(); setActive(4); window.scrollTo({ top: 0 }); }} />}
      {project && active === 4 && <StageVideos project={project} reload={reload} />}
    </Layout>
  );
}
