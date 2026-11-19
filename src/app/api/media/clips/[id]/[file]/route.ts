import { handle, HttpError, requireUser } from "@/server/http";
import { getOwnedClip } from "@/server/services/clips";
import { serveFile } from "@/server/media/serve";

const safeName = (s: string) => s.normalize("NFKD").replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, "-").slice(0, 60) || "clip";

/** video.mp4 · subtitles.srt · thumbnail.jpg  (?download=1 para descargar) */
export const GET = handle(async (req: Request, ctx: { params: Promise<{ id: string; file: string }> }) => {
  const user = await requireUser();
  const { id, file } = await ctx.params;
  const clip = await getOwnedClip(user.id, id);
  const download = new URL(req.url).searchParams.get("download") === "1";
  const base = `${String(clip.position).padStart(2, "0")}-${safeName(clip.title)}`;
  if (file === "video.mp4") {
    if (!clip.outputKey) throw new HttpError(404, "El clip todavía no se ha renderizado.");
    return serveFile(req, clip.outputKey, "video/mp4", download ? `${base}.mp4` : undefined);
  }
  if (file === "subtitles.srt") {
    if (!clip.subtitleKey) throw new HttpError(404, "Este clip no se exportó con subtítulos en archivo aparte (SRT).");
    return serveFile(req, clip.subtitleKey, "application/x-subrip; charset=utf-8", download ? `${base}.srt` : undefined);
  }
  if (file === "thumbnail.jpg") {
    if (!clip.thumbnailKey) throw new HttpError(404, "Sin miniatura.");
    return serveFile(req, clip.thumbnailKey, "image/jpeg");
  }
  throw new HttpError(404, "Archivo no encontrado.");
});
