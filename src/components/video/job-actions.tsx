"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Loader2, RotateCcw, X } from "lucide-react";
import { Button } from "@/components/ui/button";

export function RetryJobButton({ jobId }: { jobId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="inline-flex flex-col items-start gap-1">
      <Button
        size="sm"
        variant="secondary"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError(null);
          const r = await fetch(`/api/jobs/${jobId}/retry`, { method: "POST" });
          const b = await r.json().catch(() => ({}));
          if (!r.ok) setError(b.error ?? "No se pudo reintentar.");
          setBusy(false);
          router.refresh();
        }}
      >
        {busy ? <Loader2 className="size-3.5 animate-spin" /> : <RotateCcw className="size-3.5" />} Reintentar
      </Button>
      {error && <span className="text-xs text-bad">{error}</span>}
    </span>
  );
}

export function CancelImportButton({ videoId, label = "Cancelar" }: { videoId: string; label?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <Button
      size="sm"
      variant="danger"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        await fetch(`/api/uploads/${videoId}`, { method: "DELETE" });
        router.refresh();
      }}
    >
      {busy ? <Loader2 className="size-3.5 animate-spin" /> : <X className="size-3.5" />} {label}
    </Button>
  );
}
