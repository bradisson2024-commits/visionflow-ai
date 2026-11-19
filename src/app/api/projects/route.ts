import { handle, json, parseBody, requireUser } from "@/server/http";
import { createProject, listProjects } from "@/server/services/projects";
import { projectNameSchema } from "@/lib/validation";

export const GET = handle(async () => {
  const user = await requireUser();
  return json({ projects: await listProjects(user.id) });
});

export const POST = handle(async (req: Request) => {
  const user = await requireUser();
  const { name } = await parseBody(req, projectNameSchema);
  return json({ project: await createProject(user.id, name) }, 201);
});
