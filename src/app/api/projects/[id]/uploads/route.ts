import { z } from "zod";
import { handle, json, parseBody, requireUser } from "@/server/http";
import { initUpload } from "@/server/services/videos";

const schema = z.object({
  filename: z.string().trim().min(1).max(255),
  size: z.number().int().positive(),
  mimeType: z.string().max(100).optional(),
});

/** Inicia una subida por partes. */
export const POST = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const user = await requireUser();
  const { id } = await ctx.params;
  const body = await parseBody(req, schema);
  const { video, chunkSize } = await initUpload(user.id, id, body);
  return json({ video, chunkSize }, 201);
});
