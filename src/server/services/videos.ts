/**
 * Ciclo de vida del video de un proyecto:
 *   subida por partes (reanudable) o importación por enlace
 *   → verificación real con FFprobe → miniatura → almacenamiento definitivo.
 */
import { open, rm, stat } from "node:fs/promises";
import path from "node:path";
import { and, eq, inArray } from "drizzle-orm";
import { db, schema } from "../db";
import { env } from "../env";
import { HttpError } from "../http";
import { keys, storage, tempDir } from "../storage";
import { extractThumbnail, probe } from "../media/ffmpeg";
import { checkVideoFile, CHUNK_SIZE, extensionOf } from "@/lib/media-rules";
import { getOwnedProject } from "./projects";

export const partPath = async (videoId: string) => path.join(await tempDir("uploads"), `${videoId}.part`);

export async function getOwnedVideo(userId: string, videoId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(videoId)) throw new HttpError(404, "Video no encontrado.");
  const rows = await db
    .select({ video: schema.videos })
    .from(schema.videos)
    .innerJoin(schema.projects, eq(schema.projects.id, schema.videos.projectId))
    .where(and(eq(schema.videos.id, videoId), eq(schema.projects.userId, userId)))
    .limit(1);
  if (!rows[0]) throw new HttpError(404, "Video no encontrado.");
  return rows[0].video;
}

/** Un proyecto tiene un video activo; uno nuevo sustituye al anterior. */
export async function removeExistingVideos(projectId: string) {
  const old = await db.query.videos.findMany({ where: eq(schema.videos.projectId, projectId) });
  for (const v of old) {
    await rm(await partPath(v.id), { force: true });
    await storage.deletePrefix(`projects/${projectId}/videos/${v.id}/`);
  }
  if (old.length) await db.delete(schema.videos).where(inArray(schema.videos.id, old.map((v) => v.id)));
}

export async function initUpload(userId: string, projectId: string, input: { filename: string; size: number; mimeType?: string }) {
  const project = await getOwnedProject(userId, projectId);
  const problem = checkVideoFile(input.filename, input.size, env.MAX_UPLOAD_MB);
  if (problem) throw new HttpError(400, problem);
  if (input.mimeType && !input.mimeType.startsWith("video/") && input.mimeType !== "application/octet-stream")
    throw new HttpError(400, `Tipo de archivo no compatible (${input.mimeType}).`);
  await removeExistingVideos(project.id);
  const [video] = await db
    .insert(schema.videos)
    .values({
      projectId: project.id,
      originalFilename: input.filename.slice(0, 255),
      storageKey: "",
      mimeType: input.mimeType ?? null,
      sizeBytes: input.size,
      source: "upload",
    })
    .returning();
  await db.update(schema.projects).set({ status: "uploading" }).where(eq(schema.projects.id, project.id));
  // Crea el archivo parcial vacío.
  await (await open(await partPath(video.id), "w")).close();
  return { video, chunkSize: CHUNK_SIZE };
}

/** Añade una parte. `offset` debe coincidir con lo ya recibido (permite reanudar). */
export async function appendChunk(userId: string, videoId: string, offset: number, data: Uint8Array) {
  const video = await getOwnedVideo(userId, videoId);
  if (video.uploadStatus !== "uploading") throw new HttpError(409, "Esta subida ya no está activa.");
  if (offset !== video.receivedBytes)
    throw new HttpError(409, "Desfase en la subida.", { expectedOffset: video.receivedBytes });
  if (data.byteLength === 0 || data.byteLength > CHUNK_SIZE) throw new HttpError(400, "Tamaño de parte no válido.");
  if (offset + data.byteLength > video.sizeBytes) throw new HttpError(400, "Se recibieron más datos que el tamaño declarado.");

  const fh = await open(await partPath(video.id), "r+");
  try {
    await fh.write(data, 0, data.byteLength, offset);
  } finally {
    await fh.close();
  }
  const received = offset + data.byteLength;
  // Actualización condicionada: evita que dos peticiones simultáneas pisen el contador.
  const updated = await db
    .update(schema.videos)
    .set({ receivedBytes: received })
    .where(and(eq(schema.videos.id, video.id), eq(schema.videos.receivedBytes, offset), eq(schema.videos.uploadStatus, "uploading")))
    .returning({ id: schema.videos.id });
  if (!updated.length) throw new HttpError(409, "La subida cambió mientras se escribía esta parte.");
  return { receivedBytes: received, sizeBytes: video.sizeBytes };
}

/** Verifica el archivo con FFprobe, genera miniatura y lo guarda definitivamente. */
export async function finalizeVideo(videoId: string, localFile: string) {
  const video = await db.query.videos.findFirst({ where: eq(schema.videos.id, videoId) });
  if (!video) throw new Error("Video no encontrado");
  try {
    const info = await probe(localFile);
    const thumbLocal = `${localFile}.thumb.jpg`;
    await extractThumbnail(localFile, Math.min(info.durationSec * 0.1, 30), thumbLocal);
    const ext = extensionOf(video.originalFilename) || ".mp4";
    const sourceKey = keys.videoSource(video.projectId, video.id, ext);
    const thumbKey = keys.videoThumb(video.projectId, video.id);
    const { size } = await stat(localFile);
    await storage.putFile(thumbKey, thumbLocal, "image/jpeg");
    await storage.putFile(sourceKey, localFile, video.mimeType ?? "video/mp4");
    const [saved] = await db
      .update(schema.videos)
      .set({
        storageKey: sourceKey,
        thumbnailKey: thumbKey,
        uploadStatus: "uploaded",
        sizeBytes: size,
        receivedBytes: size,
        durationSec: info.durationSec,
        width: info.width,
        height: info.height,
        fps: info.fps,
        videoCodec: info.videoCodec,
        audioCodec: info.audioCodec,
        error: info.audioCodec ? null : "El video no tiene pista de audio: no se podrá transcribir.",
      })
      .where(eq(schema.videos.id, video.id))
      .returning();
    await db.update(schema.projects).set({ status: "uploaded" }).where(eq(schema.projects.id, video.projectId));
    return saved;
  } catch (err) {
    await rm(localFile, { force: true });
    await rm(`${localFile}.thumb.jpg`, { force: true });
    await markVideoFailed(video.id, video.projectId, (err as Error).message);
    throw err;
  }
}

export async function markVideoFailed(videoId: string, projectId: string, message: string) {
  await db.update(schema.videos).set({ uploadStatus: "failed", error: message }).where(eq(schema.videos.id, videoId));
  await db.update(schema.projects).set({ status: "error" }).where(eq(schema.projects.id, projectId));
}

export async function completeUpload(userId: string, videoId: string) {
  const video = await getOwnedVideo(userId, videoId);
  if (video.uploadStatus !== "uploading") throw new HttpError(409, "Esta subida ya no está activa.");
  if (video.receivedBytes !== video.sizeBytes)
    throw new HttpError(409, `Subida incompleta: ${video.receivedBytes} de ${video.sizeBytes} bytes.`);
  try {
    return await finalizeVideo(video.id, await partPath(video.id));
  } catch (err) {
    throw new HttpError(422, (err as Error).message);
  }
}

export async function cancelUpload(userId: string, videoId: string) {
  const video = await getOwnedVideo(userId, videoId);
  if (video.uploadStatus === "uploaded") throw new HttpError(409, "El video ya terminó de cargarse.");
  await db.update(schema.videos).set({ uploadStatus: "cancelled", error: "Importación cancelada por el usuario." }).where(eq(schema.videos.id, video.id));
  await db
    .update(schema.jobs)
    .set({ status: "cancelled", stage: "error", error: "Cancelado por el usuario.", finishedAt: new Date() })
    .where(and(eq(schema.jobs.videoId, video.id), inArray(schema.jobs.status, ["queued", "running"])));
  // Conserva el historial de trabajos aunque se borre el video.
  await db.update(schema.jobs).set({ videoId: null }).where(eq(schema.jobs.videoId, video.id));
  await rm(await partPath(video.id), { force: true });
  await db.delete(schema.videos).where(eq(schema.videos.id, video.id));
  await db.update(schema.projects).set({ status: "draft" }).where(eq(schema.projects.id, video.projectId));
}
