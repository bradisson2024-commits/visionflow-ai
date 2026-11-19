import { cn } from "@/lib/cn";
import { PROJECT_STATUS_LABEL } from "@/lib/format";

const tone: Record<string, string> = {
  draft: "bg-surface-3 text-muted",
  uploading: "bg-ai/10 text-ai",
  uploaded: "bg-ai/10 text-ai",
  queued: "bg-warn/10 text-warn",
  processing: "bg-ember/15 text-ember-2",
  ready: "bg-ok/10 text-ok",
  error: "bg-bad/10 text-bad",
};

export function StatusBadge({ status, className }: { status: string; className?: string }) {
  const live = status === "processing" || status === "uploading" || status === "queued";
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium", tone[status] ?? tone.draft, className)}>
      <span className={cn("size-1.5 rounded-full bg-current", live && "animate-pulse")} />
      {PROJECT_STATUS_LABEL[status] ?? status}
    </span>
  );
}
