import { z } from "zod";
import { handle, json, parseBody, requireUser } from "@/server/http";
import { createManualClip } from "@/server/services/clips";

const schema = z.object({ startSec: z.number().min(0), endSec: z.number().min(0), title: z.string().max(120).optional() });

/** Crea un clip manual (rango elegido por el usuario). */
export const POST = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const user = await requireUser();
  const { id } = await ctx.params;
  return json({ clip: await createManualClip(user.id, id, await parseBody(req, schema)) }, 201);
});
