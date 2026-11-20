import { handle, json, parseBody, requireUser } from "@/server/http";
import { createProject, deleteProject } from "@/server/services/projects";
import { startUrlImport } from "@/server/services/url-import";
import { importSchema } from "@/lib/analyze-validation";

/**
 * Flujo de un paso: pegar el enlace de un video → se crea el proyecto, se
 * descarga, se analiza automáticamente y aparecen los clips ordenados por potencial.
 */
export const POST = handle(async (req: Request) => {
  const user = await requireUser();
  const { url, confirmRights, autoAnalyze } = await parseBody(req, importSchema);
  const project = await createProject(user.id, "Importando video…");
  try {
    const r = await startUrlImport(user.id, project.id, url, { confirmRights, autoAnalyze, renameFromTitle: true });
    return json({ projectId: project.id, jobId: r.job.id }, 202);
  } catch (e) {
    await deleteProject(user.id, project.id); // no deja proyectos vacíos si el enlace no es válido
    throw e;
  }
});
