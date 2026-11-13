import { useState, type ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";

const MENU = [
  { to: "/", label: "Buscar canales" },
  { to: "/nicho", label: "Búsqueda por nicho" },
  { to: "/historial", label: "Historial de búsquedas" },
  { to: "/proyectos", label: "ReplicaPro · Mis proyectos" },
  { to: "/ajustes", label: "Configuración de APIs" },
];

export function Layout({ children, title = "ViralHunter AI", back }: { children: ReactNode; title?: string; back?: string }) {
  const [open, setOpen] = useState(false);
  const loc = useLocation();
  return (
    <div className="min-h-screen bg-black text-white">
      <header className="sticky top-0 z-30 border-b border-white/[0.06] bg-ink-900/95 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-md items-center px-4">
          {back ? (
            <Link to={back} aria-label="Volver" className="-ml-2 grid h-10 w-10 place-items-center rounded-lg hover:bg-white/5">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M15 18l-6-6 6-6" /></svg>
            </Link>
          ) : (
            <button aria-label="Abrir menú" onClick={() => setOpen(true)} className="-ml-2 grid h-10 w-10 place-items-center rounded-lg hover:bg-white/5">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M4 7h16M4 12h16M4 17h16" /></svg>
            </button>
          )}
          <h1 className="flex-1 text-center text-[17px] font-bold tracking-tight">{title}</h1>
          <div className="h-10 w-10" />
        </div>
      </header>

      {open && (
        <div className="fixed inset-0 z-40" role="dialog" aria-modal="true">
          <div className="absolute inset-0 bg-black/70" onClick={() => setOpen(false)} />
          <nav className="absolute left-0 top-0 h-full w-72 max-w-[85%] border-r border-white/10 bg-ink-900 p-4">
            <div className="mb-6 flex items-center justify-between">
              <span className="text-lg font-bold">
                ViralHunter <span className="text-brand">AI</span>
              </span>
              <button aria-label="Cerrar menú" onClick={() => setOpen(false)} className="grid h-9 w-9 place-items-center rounded-lg hover:bg-white/5">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
              </button>
            </div>
            <ul className="space-y-1">
              {MENU.map((m) => (
                <li key={m.to}>
                  <Link
                    to={m.to}
                    onClick={() => setOpen(false)}
                    className={`block rounded-xl px-3 py-3 text-[15px] ${loc.pathname === m.to ? "bg-brand/10 text-brand" : "text-neutral-200 hover:bg-white/5"}`}
                  >
                    {m.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        </div>
      )}

      <main className="mx-auto max-w-md px-4 pb-16">{children}</main>
    </div>
  );
}
