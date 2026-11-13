import { useState } from "react";
import { Steps, applyStep, initSteps, type StepState } from "../components/Steps";
import { ErrorBox } from "../components/Missing";
import { api, stream, ApiError } from "../lib/api";
import type { MissingCredential } from "../../shared/types";
import type { Project } from "./Replica";

export default function StageBranding({ project, reload, next }: { project: Project; reload: () => Promise<Project>; next: () => void }) {
  const proposals: any[] | null = project.branding_proposals;
  const [steps, setSteps] = useState<StepState[]>([]);
  const [running, setRunning] = useState(false);
  const [sel, setSel] = useState<number | null>(() => {
    const s = project.branding_selected;
    return s && proposals ? proposals.findIndex((p) => p.name === s.name) : null;
  });
  const [error, setError] = useState<string | null>(null);
  const [missing, setMissing] = useState<MissingCredential[] | undefined>();

  const generate = async () => {
    setRunning(true);
    setError(null);
    setMissing(undefined);
    setSteps([]);
    setSel(null);
    try {
      await stream(`/projects/${project.id}/branding/generate`, {}, (e) => {
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

  const approve = async () => {
    if (sel === null || sel < 0) return;
    try {
      await api(`/projects/${project.id}/branding/approve`, { body: { index: sel } });
      next();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <div className="space-y-4 pt-2">
      <div className="card p-5 text-center">
        <h3 className="text-lg font-bold">Branding del nuevo canal</h3>
        <p className="mt-2 text-sm text-neutral-400">Nombre, descripción, logo, banner, colores e identidad visual coherentes con el estilo aprobado.</p>
        <button className="btn-primary mt-4" disabled={running} onClick={generate}>
          {running ? "Generando branding…" : proposals ? "Generar nuevas propuestas" : "Generar branding"}
        </button>
      </div>
      {steps.length > 0 && running && <div className="card p-5"><Steps steps={steps} /></div>}
      <ErrorBox error={error} missing={missing} />

      {!running && proposals?.map((p, i) => (
        <button key={i} onClick={() => setSel(i)} className={`card block w-full overflow-hidden text-left ${sel === i ? "border-brand ring-1 ring-brand" : ""}`} data-testid="brand-proposal">
          {p.banner && <img src={p.banner.url} alt="Banner" className="aspect-[3/1] w-full object-cover" />}
          <div className="p-4">
            <div className="flex items-center gap-3">
              {p.logo && <img src={p.logo.url} alt="Logo" className="h-16 w-16 rounded-full border border-white/10 object-cover" />}
              <div className="min-w-0">
                <p className="text-[17px] font-bold">{p.name}</p>
                <p className="text-[12px] text-neutral-400">@{p.handle} · {p.tagline}</p>
              </div>
              <span className={`ml-auto grid h-6 w-6 shrink-0 place-items-center rounded-full border ${sel === i ? "border-brand bg-brand text-black" : "border-white/20"}`}>{sel === i ? "✓" : ""}</span>
            </div>
            <p className="mt-3 text-[13px] leading-5 text-neutral-300">{p.description}</p>
            <div className="mt-3 flex gap-1.5">
              {p.palette.map((c: any) => <span key={c.hex + c.role} title={`${c.role} ${c.hex}`} className="h-7 flex-1 rounded-md border border-white/10" style={{ background: c.hex }} />)}
            </div>
            <p className="mt-3 text-[12px] text-neutral-400"><b className="text-neutral-200">Tipografía:</b> {p.typography}</p>
            <p className="mt-1 text-[12px] text-neutral-400"><b className="text-neutral-200">Identidad visual:</b> {p.visualIdentity}</p>
          </div>
        </button>
      ))}
      {proposals && !running && (
        <button className="btn-primary" disabled={sel === null || sel < 0} onClick={approve}>Aprobar branding y continuar</button>
      )}
    </div>
  );
}
