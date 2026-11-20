import { handle, json, parseBody, requireUser } from "@/server/http";
import { startAnalysis } from "@/server/services/analysis";
import { analyzeSchema } from "@/lib/analyze-validation";

export const POST = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const user = await requireUser();
  const { id } = await ctx.params;
  const body = await parseBody(req, analyzeSchema);
  return json({ job: await startAnalysis(user.id, id, body) }, 202);
});
