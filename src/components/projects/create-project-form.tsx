"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ArrowRight, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { inputClass } from "@/components/auth-form";

export function CreateProjectForm({ autoFocus = false }: { autoFocus?: boolean }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const finalName =
      name.trim() || `Proyecto ${new Date().toLocaleDateString("es", { day: "numeric", month: "short" })}`;
    const res = await fetch("/api/projects", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: finalName }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(body.error ?? "No se pudo crear el proyecto.");
      setBusy(false);
      return;
    }
    router.push(`/projects/${body.project.id}`);
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="w-full">
      <label htmlFor="project-name" className="mb-1.5 block text-xs font-medium text-muted">
        Nombre del proyecto
      </label>
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          id="project-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={120}
          autoFocus={autoFocus}
          placeholder="Ej.: Podcast episodio 12"
          className={inputClass}
        />
        <Button type="submit" variant="primary" size="lg" disabled={busy} className="sm:w-auto">
          {busy ? <Loader2 className="size-4 animate-spin" /> : <ArrowRight className="size-4" />}
          Crear proyecto
        </Button>
      </div>
      {error && <p role="alert" className="mt-2 text-sm text-bad">{error}</p>}
    </form>
  );
}
