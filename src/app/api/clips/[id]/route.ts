import { handle, json, parseBody, requireUser } from "@/server/http";
import { deleteClip, getClipDetail, updateClip } from "@/server/services/clips";
import { clipPatchSchema } from "@/lib/clip-validation";

type Ctx = { params: Promise<{ id: string }> };

export const GET = handle(async (_req: Request, ctx: Ctx) => {
  const user = await requireUser();
  return json(await getClipDetail(user.id, (await ctx.params).id));
});

export const PATCH = handle(async (req: Request, ctx: Ctx) => {
  const user = await requireUser();
  return json({ clip: await updateClip(user.id, (await ctx.params).id, await parseBody(req, clipPatchSchema)) });
});

export const DELETE = handle(async (_req: Request, ctx: Ctx) => {
  const user = await requireUser();
  await deleteClip(user.id, (await ctx.params).id);
  return json({ ok: true });
});
