import { handle, json, requireUser } from "@/server/http";
import { cancelJob } from "@/server/services/jobs";

export const POST = handle(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const user = await requireUser();
  await cancelJob(user.id, (await ctx.params).id);
  return json({ ok: true });
});
