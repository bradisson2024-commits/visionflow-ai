"use client";

import { useState } from "react";
import { Replace } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { VideoImporter } from "./video-importer";

export function ReplaceVideo({ projectId, maxUploadMb }: { projectId: string; maxUploadMb: number }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>
        <Replace className="size-3.5" /> Reemplazar video
      </Button>
      <Modal open={open} onClose={() => setOpen(false)} title="Reemplazar video">
        <p className="text-sm text-muted">El video actual se eliminará del proyecto cuando empiece la nueva importación.</p>
        <VideoImporter projectId={projectId} maxUploadMb={maxUploadMb} />
      </Modal>
    </>
  );
}
