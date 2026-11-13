import type { MissingCredential } from "../../shared/types";

export function MissingCredentials({ missing, title = "Faltan credenciales" }: { missing: MissingCredential[]; title?: string }) {
  if (!missing?.length) return null;
  return (
    <div className="card border-brand/30 bg-brand/[0.06] p-4">
      <p className="text-sm font-semibold text-brand">{title}</p>
      <ul className="mt-2 space-y-3">
        {missing.map((m) => (
          <li key={m.env} className="text-sm">
            <p className="font-medium text-white">
              {m.service} · <code className="rounded bg-black/40 px-1.5 py-0.5 text-[12px] text-brand-400">{m.env}</code>
            </p>
            <p className="mt-1 text-xs leading-5 text-neutral-400">{m.howTo}</p>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-xs text-neutral-500">Las claves se guardan sólo en el servidor (archivo .env); nunca se envían al navegador. Reinicia el servidor tras editarlas.</p>
    </div>
  );
}

export function ErrorBox({ error, missing }: { error: string | null; missing?: MissingCredential[] }) {
  if (missing?.length) return <MissingCredentials missing={missing} />;
  if (!error) return null;
  return <div className="card border-red-500/30 bg-red-500/[0.06] p-4 text-sm text-red-300">{error}</div>;
}
