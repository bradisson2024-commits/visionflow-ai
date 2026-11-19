import { handle, HttpError, requireUser } from "@/server/http";
import { getOwnedVideo } from "@/server/services/videos";
import { serveFile } from "@/server/media/serve";

/** Reproduce (con Range) o descarga (?download=1) el video original. */
export const GET = handle(async (req: Request, ctx: { params: Promise<{ videoId: string }> }) => {
  const user = await requireUser();
  const { videoId } = await ctx.params;
  const v = await getOwnedVideo(user.id, videoId);
  if (v.uploadStatus !== "uploaded" || !v.storageKey) throw new HttpError(409, "El video todavía no está disponible.");
  const download = new URL(req.url).searchParams.get("download") === "1";
  return serveFile(req, v.storageKey, v.mimeType?.startsWith("video/") ? v.mimeType : "video/mp4", download ? v.originalFilename : undefined);
});
