import { handle, json, parseBody, requireUser } from "@/server/http";
import { deleteProject, getProjectDetail, renameProject } from "@/server/services/projects";
import { projectNameSchema } from "@/lib/validation";

type Ctx = { params: Promise<{ id: string }> };

export const GET = handle(async (_req: Request, ctx: Ctx) => {
  const user = await requireUser();
  const { id } = await ctx.params;
  return json(await getProjectDetail(user.id, id));
});

export const PATCH = handle(async (req: Request, ctx: Ctx) => {
  const user = await requireUser();
  const { id } = await ctx.params;
  const { name } = await parseBody(req, projectNameSchema);
  return json({ project: await renameProject(user.id, id, name) });
});

export const DELETE = handle(async (_req: Request, ctx: Ctx) => {
  const user = await requireUser();
  const { id } = await ctx.params;
  await deleteProject(user.id, id);
  return json({ ok: true });
});
