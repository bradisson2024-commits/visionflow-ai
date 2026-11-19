import { and, desc, eq, sql } from "drizzle-orm";
import { db, schema } from "../db";
import { HttpError } from "../http";
import { keys, storage } from "../storage";

/** Lista de proyectos del usuario con su video principal y recuento de clips. */
export async function listProjects(userId: string) {
  const rows = await db
    .select({
      id: schema.projects.id,
      name: schema.projects.name,
      status: schema.projects.status,
      createdAt: schema.projects.createdAt,
      updatedAt: schema.projects.updatedAt,
      clipCount: sql<number>`(select count(*)::int from ${schema.clips} c where c.project_id = ${schema.projects.id})`,
      videoId: sql<string | null>`(select v.id from ${schema.videos} v where v.project_id = ${schema.projects.id} order by v.created_at desc limit 1)`,
      durationSec: sql<number | null>`(select v.duration_sec from ${schema.videos} v where v.project_id = ${schema.projects.id} order by v.created_at desc limit 1)`,
      thumbnailKey: sql<string | null>`(select v.thumbnail_key from ${schema.videos} v where v.project_id = ${schema.projects.id} order by v.created_at desc limit 1)`,
    })
    .from(schema.projects)
    .where(eq(schema.projects.userId, userId))
    .orderBy(desc(schema.projects.updatedAt));
  return rows;
}

export async function getOwnedProject(userId: string, projectId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(projectId)) throw new HttpError(404, "Proyecto no encontrado.");
  const project = await db.query.projects.findFirst({
    where: and(eq(schema.projects.id, projectId), eq(schema.projects.userId, userId)),
  });
  if (!project) throw new HttpError(404, "Proyecto no encontrado.");
  return project;
}

export async function getProjectDetail(userId: string, projectId: string) {
  const project = await getOwnedProject(userId, projectId);
  const [videos, clips, jobs] = await Promise.all([
    db.query.videos.findMany({ where: eq(schema.videos.projectId, project.id), orderBy: desc(schema.videos.createdAt) }),
    db.query.clips.findMany({ where: eq(schema.clips.projectId, project.id), orderBy: schema.clips.position }),
    db.query.jobs.findMany({ where: eq(schema.jobs.projectId, project.id), orderBy: desc(schema.jobs.createdAt), limit: 200 }),
  ]);
  return { project, videos, clips, jobs };
}

export async function createProject(userId: string, name: string) {
  const [p] = await db.insert(schema.projects).values({ userId, name }).returning();
  return p;
}

export async function renameProject(userId: string, projectId: string, name: string) {
  await getOwnedProject(userId, projectId);
  const [p] = await db.update(schema.projects).set({ name }).where(eq(schema.projects.id, projectId)).returning();
  return p;
}

export async function deleteProject(userId: string, projectId: string) {
  await getOwnedProject(userId, projectId);
  const vids = await db.query.videos.findMany({ where: eq(schema.videos.projectId, projectId), columns: { id: true } });
  // Las filas dependientes caen por ON DELETE CASCADE; los archivos se borran aquí.
  await db.delete(schema.projects).where(eq(schema.projects.id, projectId));
  const { rm } = await import("node:fs/promises");
  const { partPath } = await import("./videos");
  for (const v of vids) await rm(await partPath(v.id), { force: true });
  await storage.deletePrefix(keys.projectPrefix(projectId));
}
