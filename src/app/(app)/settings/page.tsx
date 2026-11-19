import { requirePageUser } from "@/server/auth/session";
import { PageHeader } from "@/components/shell/page-header";
import { ServicesPanel } from "@/components/settings/services-panel";
import { LogoutButton } from "@/components/shell/logout-button";

export const metadata = { title: "Ajustes" };

export default async function SettingsPage() {
  const user = await requirePageUser();
  return (
    <>
      <PageHeader title="Ajustes" subtitle="Cuenta, servicios y proveedores de IA" />
      <div className="grid gap-6 lg:grid-cols-2">
        <section className="rounded-3xl border border-line bg-surface p-5">
          <h2 className="font-display text-lg font-semibold">Servicios y proveedores</h2>
          <p className="mt-1 text-sm text-muted">
            Estado comprobado en el servidor ahora mismo. Las claves se configuran en el archivo <code className="rounded bg-surface-3 px-1 font-mono text-xs">.env</code> del
            servidor y nunca se envían al navegador. Una función que dependa de un servicio no configurado mostrará un
            error claro en lugar de simular resultados.
          </p>
          <div className="mt-2">
            <ServicesPanel detailed />
          </div>
        </section>
        <section className="rounded-3xl border border-line bg-surface p-5 lg:self-start">
          <h2 className="font-display text-lg font-semibold">Cuenta</h2>
          <dl className="mt-4 space-y-3 text-sm">
            <div>
              <dt className="text-xs text-faint">Nombre</dt>
              <dd>{user.name}</dd>
            </div>
            <div>
              <dt className="text-xs text-faint">Correo</dt>
              <dd className="break-all">{user.email}</dd>
            </div>
          </dl>
          <div className="mt-5 border-t border-line pt-4">
            <LogoutButton withLabel />
          </div>
        </section>
      </div>
    </>
  );
}
