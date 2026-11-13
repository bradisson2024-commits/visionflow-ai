export type StepState = { label: string; status: "pending" | "running" | "done" | "error"; detail?: string };

export function initSteps(labels: string[]): StepState[] {
  return labels.map((label) => ({ label, status: "pending" }));
}

export function applyStep(steps: StepState[], e: { step: number; status: "running" | "done" | "error"; detail?: string }): StepState[] {
  return steps.map((s, i) => {
    if (i + 1 === e.step) return { ...s, status: e.status, detail: e.detail ?? s.detail };
    if (i + 1 < e.step && s.status !== "done" && s.status !== "error") return { ...s, status: "done" };
    return s;
  });
}

export function Steps({ steps, numbered = true }: { steps: StepState[]; numbered?: boolean }) {
  return (
    <ol className="space-y-3">
      {steps.map((s, i) => (
        <li key={i} className="flex gap-3">
          <div className="mt-0.5 shrink-0">
            {s.status === "done" ? (
              <div className="grid h-6 w-6 place-items-center rounded-full bg-brand text-black">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"><path d="M5 12l5 5L20 7" /></svg>
              </div>
            ) : s.status === "running" ? (
              <div className="grid h-6 w-6 place-items-center"><div className="spinner" /></div>
            ) : s.status === "error" ? (
              <div className="grid h-6 w-6 place-items-center rounded-full bg-red-500/20 text-xs font-bold text-red-400">!</div>
            ) : (
              <div className="grid h-6 w-6 place-items-center rounded-full border border-white/15 text-[11px] text-neutral-500">{numbered ? i + 1 : ""}</div>
            )}
          </div>
          <div className="min-w-0">
            <p className={`text-[15px] leading-6 ${s.status === "pending" ? "text-neutral-500" : s.status === "error" ? "text-red-300" : "text-white"}`}>
              {numbered ? `${i + 1}. ` : ""}
              {s.label}
            </p>
            {s.detail && <p className={`mt-0.5 text-xs leading-5 ${s.status === "error" ? "text-red-400" : "text-neutral-400"}`}>{s.detail}</p>}
          </div>
        </li>
      ))}
    </ol>
  );
}
