"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { LogOut } from "lucide-react";

export function LogoutButton({ withLabel = false }: { withLabel?: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        await fetch("/api/auth/logout", { method: "POST" });
        router.replace("/login");
        router.refresh();
      }}
      className="inline-flex items-center gap-2 rounded-lg p-2 text-sm text-faint hover:bg-surface-3 hover:text-text disabled:opacity-50"
      title="Cerrar sesión"
      aria-label="Cerrar sesión"
    >
      <LogOut className="size-4" />
      {withLabel && "Cerrar sesión"}
    </button>
  );
}
