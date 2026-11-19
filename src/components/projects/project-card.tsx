import Link from "next/link";
import { Clock, Film, Scissors } from "lucide-react";
import { StatusBadge } from "@/components/ui/status-badge";
import { formatDuration, formatRelative } from "@/lib/format";
import { ProjectActions } from "./project-actions";

export type ProjectSummary = {
  id: string;
  name: string;
  status: string;
  updatedAt: Date | string;
  clipCount: number;
  durationSec: number | null;
  videoId: string | null;
  thumbnailKey?: string | null;
};

export function ProjectCard({ p }: { p: ProjectSummary }) {
  return (
    <div className="group relative overflow-hidden rounded-2xl border border-line bg-surface transition hover:border-line-strong">
      <Link href={`/projects/${p.id}`} className="block">
        <div className="filmstrip relative grid aspect-video place-items-center border-b border-line bg-surface-2">
          {p.videoId && p.thumbnailKey ? (
            // eslint-disable-next-line @next/next/no-img-element -- imagen privada servida por la API con cookie de sesión
            <img src={`/api/media/videos/${p.videoId}/thumbnail`} alt="" loading="lazy" className="absolute inset-0 size-full object-cover" />
          ) : (
            <Film className="size-8 text-faint" />
          )}
          {p.durationSec != null && (
            <span className="absolute bottom-2 right-2 rounded-md bg-black/70 px-1.5 py-0.5 text-[11px] tabular-nums">
              {formatDuration(p.durationSec)}
            </span>
          )}
        </div>
        <div className="p-3.5 pr-12">
          <h3 className="truncate font-medium">{p.name}</h3>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-faint">
            <StatusBadge status={p.status} />
            <span className="inline-flex items-center gap-1">
              <Scissors className="size-3" /> {p.clipCount} clips
            </span>
            <span className="inline-flex items-center gap-1">
              <Clock className="size-3" /> {formatRelative(p.updatedAt)}
            </span>
          </div>
        </div>
      </Link>
      <div className="absolute bottom-3 right-2">
        <ProjectActions project={p} compact />
      </div>
    </div>
  );
}
