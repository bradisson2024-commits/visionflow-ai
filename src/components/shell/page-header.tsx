import { LogoMark } from "@/components/ui/logo";

/** Cabecera de página; en móvil incluye la marca porque no hay barra lateral. */
export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: React.ReactNode }) {
  return (
    <header className="safe-top flex items-end justify-between gap-4 pb-5 pt-5 md:pt-8">
      <div className="flex min-w-0 items-center gap-3">
        <span className="md:hidden">
          <LogoMark size={30} gid="cf-g-header" />
        </span>
        <div className="min-w-0">
          <h1 className="font-display truncate text-2xl font-semibold md:text-3xl">{title}</h1>
          {subtitle && <p className="mt-0.5 truncate text-sm text-muted">{subtitle}</p>}
        </div>
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </header>
  );
}
