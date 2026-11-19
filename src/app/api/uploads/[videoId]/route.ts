import { handle, HttpError, json, requireUser } from "@/server/http";
import { appendChunk, cancelUpload, getOwnedVideo } from "@/server/services/videos";

type Ctx = { params: Promise<{ videoId: string }> };

/** Estado de la subida (para reanudar). */
export const GET = handle(async (_req: Request, ctx: Ctx) => {
  const user = await requireUser();
  const { videoId } = await ctx.params;
  return json({ video: await getOwnedVideo(user.id, videoId) });
});

/** Envía una parte del archivo: cuerpo binario, `?offset=` en bytes. */
export const PUT = handle(async (req: Request, ctx: Ctx) => {
  const user = await requireUser();
  const { videoId } = await ctx.params;
  const offset = Number(new URL(req.url).searchParams.get("offset"));
  if (!Number.isSafeInteger(offset) || offset < 0) throw new HttpError(400, "Parámetro offset no válido.");
  const data = new Uint8Array(await req.arrayBuffer());
  return json(await appendChunk(user.id, videoId, offset, data));
});

/** Cancela la importación y borra lo recibido. */
export const DELETE = handle(async (_req: Request, ctx: Ctx) => {
  const user = await requireUser();
  const { videoId } = await ctx.params;
  await cancelUpload(user.id, videoId);
  return json({ ok: true });
});
