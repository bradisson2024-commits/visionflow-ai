import { handle, json, parseBody, requireUser } from "@/server/http";
import { queueRender } from "@/server/services/clips";
import { exportSchema } from "@/lib/clip-validation";

/** Encola el renderizado (o re-renderizado) del clip con las opciones de exportación. */
export const POST = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const user = await requireUser();
  const { id } = await ctx.params;
  return json({ job: await queueRender(user.id, id, await parseBody(req, exportSchema)) }, 202);
});
