import { and, eq } from "drizzle-orm";
import { db, schema } from "../db";
import { HttpError } from "../http";
import { queue } from "../queue";

/** Reintenta un trabajo fallido reutilizando sus parámetros. */
export async function retryJob(userId: string, jobId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(jobId)) throw new HttpError(404, "Trabajo no encontrado.");
  const rows = await db
    .select({ job: schema.jobs })
    .from(schema.jobs)
    .innerJoin(schema.projects, eq(schema.projects.id, schema.jobs.projectId))
    .where(and(eq(schema.jobs.id, jobId), eq(schema.projects.userId, userId)))
    .limit(1);
  const job = rows[0]?.job;
  if (!job) throw new HttpError(404, "Trabajo no encontrado.");
  if (job.status !== "failed") throw new HttpError(409, "Sólo se pueden reintentar trabajos con error.");
  if (job.type === "import_url") {
    if (!job.videoId) throw new HttpError(409, "El video asociado ya no existe; importa el enlace de nuevo.");
    await db.update(schema.videos).set({ uploadStatus: "uploading", error: null, receivedBytes: 0 }).where(eq(schema.videos.id, job.videoId));
    await db.update(schema.projects).set({ status: "uploading" }).where(eq(schema.projects.id, job.projectId));
  }
  if (job.type === "render_clip" && job.clipId) await db.update(schema.clips).set({ status: "queued" }).where(eq(schema.clips.id, job.clipId));
  if (job.type === "analyze") await db.update(schema.projects).set({ status: "queued" }).where(eq(schema.projects.id, job.projectId));
  const [updated] = await db
    .update(schema.jobs)
    .set({ status: "queued", stage: "queued", progress: 0, error: null, finishedAt: null })
    .where(eq(schema.jobs.id, job.id))
    .returning();
  await queue().add(job.type, { jobId: job.id }, { jobId: `${job.id}-retry-${Date.now()}` });
  return updated;
}

/** Cancela un trabajo en cola o en ejecución; el worker lo detiene en segundos. */
export async function cancelJob(userId: string, jobId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(jobId)) throw new HttpError(404, "Trabajo no encontrado.");
  const rows = await db
    .select({ job: schema.jobs })
    .from(schema.jobs)
    .innerJoin(schema.projects, eq(schema.projects.id, schema.jobs.projectId))
    .where(and(eq(schema.jobs.id, jobId), eq(schema.projects.userId, userId)))
    .limit(1);
  const job = rows[0]?.job;
  if (!job) throw new HttpError(404, "Trabajo no encontrado.");
  if (job.status !== "queued" && job.status !== "running") throw new HttpError(409, "El trabajo ya terminó.");
  await db.update(schema.jobs).set({ status: "cancelled", stage: "error", error: "Cancelado por el usuario.", finishedAt: new Date() }).where(eq(schema.jobs.id, job.id));
  if (job.type === "analyze") {
    const hasClips = await db.query.clips.findFirst({ where: eq(schema.clips.projectId, job.projectId), columns: { id: true } });
    await db.update(schema.projects).set({ status: hasClips ? "ready" : "uploaded" }).where(eq(schema.projects.id, job.projectId));
  }
  if (job.type === "render_clip" && job.clipId) {
    const clip = await db.query.clips.findFirst({ where: eq(schema.clips.id, job.clipId), columns: { outputKey: true } });
    await db.update(schema.clips).set({ status: clip?.outputKey ? "ready" : "suggested" }).where(eq(schema.clips.id, job.clipId));
  }
}
