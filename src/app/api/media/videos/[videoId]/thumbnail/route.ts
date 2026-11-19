import { handle, HttpError, requireUser } from "@/server/http";
import { getOwnedVideo } from "@/server/services/videos";
import { serveFile } from "@/server/media/serve";

export const GET = handle(async (req: Request, ctx: { params: Promise<{ videoId: string }> }) => {
  const user = await requireUser();
  const { videoId } = await ctx.params;
  const v = await getOwnedVideo(user.id, videoId);
  if (!v.thumbnailKey) throw new HttpError(404, "Sin miniatura.");
  return serveFile(req, v.thumbnailKey, "image/jpeg");
});
