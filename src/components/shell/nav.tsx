"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { FolderOpen, Home, Plus, Settings } from "lucide-react";
import { cn } from "@/lib/cn";
import { Logo } from "@/components/ui/logo";
import { LogoutButton } from "./logout-button";

const items = [
  { href: "/dashboard", label: "Inicio", icon: Home },
  { href: "/projects", label: "Proyectos", icon: FolderOpen },
  { href: "/settings", label: "Ajustes", icon: Settings },
];

const isActive = (path: string, href: string) => path === href || path.startsWith(href + "/");

export function Sidebar({ user }: { user: { name: string; email: string } }) {
  const path = usePathname();
  return (
    <aside className="hidden md:flex fixed inset-y-0 left-0 z-30 w-60 lg:w-64 flex-col border-r border-line bg-surface/80 backdrop-blur">
      <div className="px-5 pt-6 pb-5">
        <Link href="/dashboard" aria-label="ClipForge, inicio">
          <Logo gid="cf-g-sidebar" />
        </Link>
      </div>
      <div className="px-3">
        <Link
          href="/new"
          className="forge-gradient flex h-11 items-center justify-center gap-2 rounded-xl text-sm font-semibold text-black hover:brightness-110"
        >
          <Plus className="size-4" strokeWidth={2.5} /> Nuevo proyecto
        </Link>
      </div>
      <nav className="mt-5 flex flex-col gap-0.5 px-3" aria-label="Principal">
        {items.map(({ href, label, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            className={cn(
              "flex h-10 items-center gap-3 rounded-lg px-3 text-sm transition",
              isActive(path, href) ? "bg-surface-3 text-text" : "text-muted hover:bg-surface-2 hover:text-text",
            )}
          >
            <Icon className={cn("size-4", isActive(path, href) && "text-ember-2")} />
            {label}
          </Link>
        ))}
      </nav>
      <div className="mt-auto border-t border-line p-3">
        <div className="flex items-center gap-3 rounded-lg px-2 py-2">
          <div className="grid size-8 shrink-0 place-items-center rounded-full bg-surface-3 text-xs font-semibold uppercase">
            {user.name.slice(0, 1)}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm">{user.name}</p>
            <p className="truncate text-xs text-faint">{user.email}</p>
          </div>
          <LogoutButton />
        </div>
      </div>
    </aside>
  );
}

export function BottomNav() {
  const path = usePathname();
  const tab = (href: string, label: string, Icon: typeof Home) => (
    <Link
      href={href}
      className={cn("flex flex-1 flex-col items-center justify-center gap-1 text-[11px]", isActive(path, href) ? "text-text" : "text-faint")}
    >
      <Icon className={cn("size-5", isActive(path, href) && "text-ember-2")} />
      {label}
    </Link>
  );
  return (
    <nav
      aria-label="Principal"
      className="safe-bottom fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface/90 backdrop-blur-lg md:hidden"
    >
      <div className="flex h-16 items-stretch">
        {tab("/dashboard", "Inicio", Home)}
        {tab("/projects", "Proyectos", FolderOpen)}
        <div className="flex flex-1 items-center justify-center">
          <Link
            href="/new"
            aria-label="Nuevo proyecto"
            className="forge-gradient -mt-6 grid size-14 place-items-center rounded-2xl text-black shadow-[0_10px_30px_-8px_rgba(255,107,26,.8)] ring-4 ring-bg"
          >
            <Plus className="size-6" strokeWidth={2.5} />
          </Link>
        </div>
        {tab("/settings", "Ajustes", Settings)}
      </div>
    </nav>
  );
}
