import { CheckCircle2, XCircle } from "lucide-react";
import { runHealthChecks } from "@/server/health";
import { allServiceStatus } from "@/server/providers/status";
import { cn } from "@/lib/cn";

/** Estado real de la infraestructura y de los proveedores configurados. */
export async function ServicesPanel({ detailed = false }: { detailed?: boolean }) {
  const [checks, services] = await Promise.all([runHealthChecks(), Promise.resolve(allServiceStatus())]);
  const rows = [
    ...checks.map((c) => ({ key: c.id, label: c.label, ok: c.ok, detail: c.detail, provider: undefined as string | undefined })),
    ...services.map((s) => ({
      key: s.id,
      label: s.label,
      ok: s.ready,
      provider: s.provider,
      detail: s.ready ? s.note ?? "Configurado" : `Falta configurar: ${s.missing.join(", ")}. ${s.note ?? ""}`,
    })),
  ];
  return (
    <ul className="divide-y divide-line">
      {rows.map((r) => (
        <li key={r.key} className="flex items-start gap-3 py-3">
          {r.ok ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-ok" /> : <XCircle className="mt-0.5 size-4 shrink-0 text-bad" />}
          <div className="min-w-0 flex-1">
            <p className="text-sm">
              {r.label}
              {r.provider && <span className="ml-2 rounded bg-surface-3 px-1.5 py-0.5 font-mono text-[10px] text-muted">{r.provider}</span>}
            </p>
            {(detailed || !r.ok) && <p className={cn("mt-0.5 break-words text-xs", r.ok ? "text-faint" : "text-bad/90")}>{r.detail}</p>}
          </div>
        </li>
      ))}
    </ul>
  );
}
