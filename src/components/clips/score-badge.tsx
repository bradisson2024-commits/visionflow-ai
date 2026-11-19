import { cn } from "@/lib/cn";

export function scoreTone(score: number) {
  if (score >= 80) return "text-ok border-ok/40 bg-ok/10";
  if (score >= 65) return "text-ember-2 border-ember/40 bg-ember/10";
  if (score >= 50) return "text-warn border-warn/40 bg-warn/10";
  return "text-muted border-line bg-surface-3";
}

/** Puntuación estimada por IA (0–100). No es una garantía de viralidad. */
export function ScoreBadge({ score, size = "md" }: { score: number | null; size?: "sm" | "md" | "lg" }) {
  if (score == null) return <span className="rounded-lg border border-line px-2 py-1 text-xs text-faint">Manual</span>;
  return (
    <span
      title="Potencial estimado por IA (0–100). No garantiza resultados."
      className={cn(
        "inline-flex flex-col items-center justify-center rounded-xl border font-display font-semibold tabular-nums",
        scoreTone(score),
        size === "sm" ? "h-9 w-10 text-sm" : size === "lg" ? "h-16 w-16 text-2xl" : "h-12 w-12 text-lg",
      )}
    >
      {score}
    </span>
  );
}

export const SCORE_LABELS: Record<string, string> = {
  hook: "Gancho inicial",
  topicInterest: "Interés del tema",
  curiosity: "Curiosidad",
  emotion: "Emoción",
  clarity: "Claridad",
  standalone: "Se entiende solo",
  retention: "Retención",
  ending: "Conclusión",
  socialPotential: "Potencial en redes",
};

export function ScoreBreakdown({ breakdown }: { breakdown: Record<string, number> }) {
  return (
    <dl className="grid grid-cols-1 gap-x-4 gap-y-1.5 sm:grid-cols-2">
      {Object.entries(SCORE_LABELS).map(([k, label]) => (
        <div key={k} className="flex items-center gap-2 text-xs">
          <dt className="w-32 shrink-0 text-muted">{label}</dt>
          <dd className="flex flex-1 items-center gap-2">
            <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-3">
              <span className="forge-gradient block h-full rounded-full" style={{ width: `${breakdown[k] ?? 0}%` }} />
            </span>
            <span className="w-7 text-right tabular-nums">{breakdown[k] ?? "—"}</span>
          </dd>
        </div>
      ))}
    </dl>
  );
}
