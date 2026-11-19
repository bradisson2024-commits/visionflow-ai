"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Loader2, MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { inputClass } from "@/components/auth-form";
import { cn } from "@/lib/cn";

/** Menú de acciones de un proyecto: renombrar y eliminar (persisten en la API). */
export function ProjectActions({
  project,
  redirectOnDelete,
  compact = false,
}: {
  project: { id: string; name: string };
  redirectOnDelete?: string;
  compact?: boolean;
}) {
  const router = useRouter();
  const [menu, setMenu] = useState(false);
  const [mode, setMode] = useState<"rename" | "delete" | null>(null);
  const [name, setName] = useState(project.name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const close = () => {
    setMode(null);
    setError(null);
    setBusy(false);
  };

  async function call(method: "PATCH" | "DELETE") {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/projects/${project.id}`, {
      method,
      headers: { "content-type": "application/json" },
      body: method === "PATCH" ? JSON.stringify({ name }) : undefined,
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(body.error ?? "La operación falló.");
      setBusy(false);
      return;
    }
    close();
    if (method === "DELETE" && redirectOnDelete) router.replace(redirectOnDelete);
    router.refresh();
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          setMenu((m) => !m);
        }}
        className={cn("grid place-items-center rounded-lg text-muted hover:bg-surface-3 hover:text-text", compact ? "size-8" : "size-10 border border-line")}
        aria-label={`Acciones para ${project.name}`}
        aria-expanded={menu}
      >
        <MoreHorizontal className="size-4" />
      </button>
      {menu && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setMenu(false)} />
          <div className="absolute right-0 top-full z-50 mt-1 w-44 overflow-hidden rounded-xl border border-line bg-surface-2 py-1 shadow-xl">
            <button
              className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm hover:bg-surface-3"
              onClick={(e) => {
                e.preventDefault();
                setMenu(false);
                setName(project.name);
                setMode("rename");
              }}
            >
              <Pencil className="size-4 text-muted" /> Renombrar
            </button>
            <button
              className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm text-bad hover:bg-bad/10"
              onClick={(e) => {
                e.preventDefault();
                setMenu(false);
                setMode("delete");
              }}
            >
              <Trash2 className="size-4" /> Eliminar
            </button>
          </div>
        </>
      )}

      <Modal open={mode === "rename"} onClose={close} title="Renombrar proyecto">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            call("PATCH");
          }}
          className="space-y-4"
        >
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} autoFocus className={inputClass} />
          {error && <p className="text-sm text-bad">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={close}>Cancelar</Button>
            <Button type="submit" variant="primary" disabled={busy || !name.trim()}>
              {busy && <Loader2 className="size-4 animate-spin" />} Guardar
            </Button>
          </div>
        </form>
      </Modal>

      <Modal open={mode === "delete"} onClose={close} title="Eliminar proyecto">
        <p className="text-sm text-muted">
          Se eliminará <strong className="text-text">{project.name}</strong> junto con su video, transcripción y clips. Esta acción no se puede deshacer.
        </p>
        {error && <p className="mt-3 text-sm text-bad">{error}</p>}
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={close}>Cancelar</Button>
          <Button variant="danger" onClick={() => call("DELETE")} disabled={busy}>
            {busy && <Loader2 className="size-4 animate-spin" />} Eliminar
          </Button>
        </div>
      </Modal>
    </div>
  );
}
