import { handle, json, requireUser } from "@/server/http";
import { retryJob } from "@/server/services/jobs";

export const POST = handle(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const user = await requireUser();
  const { id } = await ctx.params;
  return json({ job: await retryJob(user.id, id) });
});
