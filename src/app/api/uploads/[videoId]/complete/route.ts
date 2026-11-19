import { handle, json, requireUser } from "@/server/http";
import { completeUpload } from "@/server/services/videos";

/** Cierra la subida: verifica con FFprobe, genera miniatura y guarda el video. */
export const POST = handle(async (_req: Request, ctx: { params: Promise<{ videoId: string }> }) => {
  const user = await requireUser();
  const { videoId } = await ctx.params;
  return json({ video: await completeUpload(user.id, videoId) });
});
