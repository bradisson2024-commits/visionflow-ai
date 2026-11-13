import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Layout } from "../components/Layout";
import { Steps, applyStep, initSteps, type StepState } from "../components/Steps";
import { ErrorBox } from "../components/Missing";
import { stream, ApiError } from "../lib/api";
import type { MissingCredential, NicheSearchParams } from "../../shared/types";

export default function SearchRun() {
  const loc = useLocation();
  const nav = useNavigate();
  const state = loc.state as { kind: "recent" | "niche"; params?: NicheSearchParams } | null;
  const [steps, setSteps] = useState<StepState[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [missing, setMissing] = useState<MissingCredential[] | undefined>();
  const started = useRef(false);

  useEffect(() => {
    if (!state) {
      nav("/", { replace: true });
      return;
    }
    if (started.current) return;
    started.current = true;
    const path = state.kind === "recent" ? "/search/recent" : "/search/niche";
    stream(path, state.params ?? {}, (e) => {
      if (e.type === "steps") setSteps(initSteps(e.labels));
      else if (e.type === "step") setSteps((s) => applyStep(s, e));
      else if (e.type === "done") {
        setSteps((s) => s.map((x) => ({ ...x, status: x.status === "error" ? "error" : "done" })));
        setTimeout(() => nav(`/resultados/${e.searchId}`, { replace: true, state: { results: e.results, note: e.note, quotaUsed: e.quotaUsed } }), 600);
      } else if (e.type === "error") {
        setError(e.message);
        setMissing(e.missing);
      }
    }).catch((e) => {
      setError(e.message);
      if (e instanceof ApiError) setMissing(e.missing);
    });
  }, []);

  return (
    <Layout title="ViralHunter AI" back={state?.kind === "niche" ? "/nicho" : "/"}>
      <section className="pt-8 text-center">
        <h2 className="text-2xl font-extrabold tracking-tight">{state?.kind === "niche" ? `Buscando en «${state.params?.topic}»` : "Buscando canales ganadores"}</h2>
        <p className="mt-2 text-sm text-neutral-400">Consultando YouTube en tiempo real. Cada paso es una operación real.</p>
      </section>
      <div className="card mt-6 p-5">
        {steps.length ? <Steps steps={steps} /> : !error && <div className="flex justify-center py-6"><div className="spinner" /></div>}
      </div>
      <div className="mt-4">
        <ErrorBox error={error} missing={missing} />
      </div>
    </Layout>
  );
}
