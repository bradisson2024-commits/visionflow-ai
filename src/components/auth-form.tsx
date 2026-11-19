"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

export const inputClass =
  "h-12 w-full rounded-xl border border-line bg-surface-2 px-4 text-base text-text placeholder:text-faint outline-none transition focus:border-ember/60 focus:ring-2 focus:ring-ember/20 md:text-sm";

export function AuthForm({ mode }: { mode: "login" | "register" }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const data = Object.fromEntries(new FormData(e.currentTarget));
    try {
      const res = await fetch(`/api/auth/${mode}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(data),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "No se pudo completar la operación.");
      router.replace("/dashboard");
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  const isLogin = mode === "login";
  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="mb-6">
        <h1 className="font-display text-3xl font-semibold">{isLogin ? "Bienvenido de nuevo" : "Crea tu cuenta"}</h1>
        <p className="mt-2 text-sm text-muted">
          {isLogin ? "Entra para seguir creando clips." : "Convierte tus videos largos en clips listos para redes."}
        </p>
      </div>
      {!isLogin && (
        <label className="block">
          <span className="mb-1.5 block text-xs font-medium text-muted">Nombre</span>
          <input name="name" required autoComplete="name" className={inputClass} placeholder="Tu nombre" />
        </label>
      )}
      <label className="block">
        <span className="mb-1.5 block text-xs font-medium text-muted">Correo electrónico</span>
        <input name="email" type="email" required autoComplete="email" inputMode="email" className={inputClass} placeholder="tu@correo.com" />
      </label>
      <label className="block">
        <span className="mb-1.5 block text-xs font-medium text-muted">Contraseña</span>
        <input
          name="password"
          type="password"
          required
          minLength={isLogin ? 1 : 8}
          autoComplete={isLogin ? "current-password" : "new-password"}
          className={inputClass}
          placeholder={isLogin ? "••••••••" : "Mínimo 8 caracteres"}
        />
      </label>
      {error && (
        <p role="alert" className="rounded-lg border border-bad/30 bg-bad/10 px-3 py-2 text-sm text-bad">
          {error}
        </p>
      )}
      <Button type="submit" variant="primary" size="lg" className="w-full" disabled={busy}>
        {busy && <Loader2 className="size-4 animate-spin" />}
        {isLogin ? "Entrar" : "Crear cuenta"}
      </Button>
      <p className="pt-2 text-center text-sm text-muted">
        {isLogin ? "¿No tienes cuenta? " : "¿Ya tienes cuenta? "}
        <Link href={isLogin ? "/register" : "/login"} className="font-medium text-ember-2 hover:underline">
          {isLogin ? "Regístrate" : "Inicia sesión"}
        </Link>
      </p>
    </form>
  );
}
