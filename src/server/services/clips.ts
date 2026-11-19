import { and, eq, inArray, max } from "drizzle-orm";
import { db, schema } from "../db";
import type { ClipEdit, ExportOptions, TranscriptWord } from "../db/schema";
import { HttpError } from "../http";
import { enqueueJob } from "../queue";
import { keys, storage } from "../storage";
import { defaultEdit } from "@/lib/captions";
import { getOwnedProject } from "./projects";

export async function getOwnedClip(userId: string, clipId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(clipId)) throw new HttpError(404, "Clip no encontrado.");
  const rows = await db
    .select({ clip: schema.clips })
    .from(schema.clips)
    .innerJoin(schema.projects, eq(schema.projects.id, schema.clips.projectId))
    .where(and(eq(schema.clips.id, clipId), eq(schema.projects.userId, userId)))
    .limit(1);
  if (!rows[0]) throw new HttpError(404, "Clip no encontrado.");
  return rows[0].clip;
}

/** Clip + video + palabras de la transcripción (para el editor). */
export async function getClipDetail(userId: string, clipId: string) {
  const clip = await getOwnedClip(userId, clipId);
  const [video, transcript, project, job] = await Promise.all([
    db.query.videos.findFirst({ where: eq(schema.videos.id, clip.videoId) }),
    db.query.transcripts.findFirst({ where: eq(schema.transcripts.videoId, clip.videoId) }),
    db.query.projects.findFirst({ where: eq(schema.projects.id, clip.projectId), columns: { id: true, name: true } }),
    db.query.jobs.findFirst({ where: and(eq(schema.jobs.clipId, clip.id)), orderBy: (j, { desc }) => desc(j.createdAt) }),
  ]);
  return {
    clip: { ...clip, edit: clip.edit ?? defaultEdit() },
    video: video!,
    project: project!,
    lastJob: job ?? null,
    transcriptWords: transcript?.words ?? [],
    estimatedWordTimes: transcript?.provider.includes("estimados") ?? false,
  };
}

export async function createManualClip(userId: string, projectId: string, input: { startSec: number; endSec: number; title?: string }) {
  const project = await getOwnedProject(userId, projectId);
  const video = await db.query.videos.findFirst({ where: and(eq(schema.videos.projectId, project.id), eq(schema.videos.uploadStatus, "uploaded")) });
  if (!video) throw new HttpError(409, "El proyecto no tiene un video cargado.");
  validateRange(input.startSec, input.endSec, video.durationSec ?? 0);
  const transcript = await db.query.transcripts.findFirst({ where: eq(schema.transcripts.videoId, video.id) });
  const text = (transcript?.words ?? []).filter((w) => w.s >= input.startSec && w.e <= input.endSec).map((w) => w.w).join(" ");
  const [{ m }] = await db.select({ m: max(schema.clips.position) }).from(schema.clips).where(eq(schema.clips.projectId, project.id));
  const [clip] = await db
    .insert(schema.clips)
    .values({
      projectId: project.id,
      videoId: video.id,
      position: (m ?? 0) + 1,
      title: input.title?.trim() || `Clip manual ${Math.round(input.startSec)}–${Math.round(input.endSec)} s`,
      startSec: input.startSec,
      endSec: input.endSec,
      transcript: text,
      reason: "Creado manualmente.",
      edit: defaultEdit(project.settings.aspectRatio ?? "9:16", project.settings.captionStyle ?? "viral"),
    })
    .returning();
  return clip;
}

function validateRange(s: number, e: number, duration: number) {
  if (!(s >= 0) || !(e > s)) throw new HttpError(400, "El final del clip debe ser posterior al inicio.");
  if (e - s < 1) throw new HttpError(400, "El clip debe durar al menos 1 segundo.");
  if (e > duration + 0.05) throw new HttpError(400, `El final supera la duración del video (${duration.toFixed(1)} s).`);
}

export async function updateClip(
  userId: string,
  clipId: string,
  patch: { title?: string; startSec?: number; endSec?: number; edit?: ClipEdit; captionWords?: TranscriptWord[] | null },
) {
  const clip = await getOwnedClip(userId, clipId);
  const video = await db.query.videos.findFirst({ where: eq(schema.videos.id, clip.videoId) });
  const s = patch.startSec ?? clip.startSec;
  const e = patch.endSec ?? clip.endSec;
  validateRange(s, e, video?.durationSec ?? 0);
  let transcript = clip.transcript;
  if (patch.startSec !== undefined || patch.endSec !== undefined || patch.captionWords !== undefined) {
    const words = patch.captionWords ?? clip.captionWords ?? (await db.query.transcripts.findFirst({ where: eq(schema.transcripts.videoId, clip.videoId) }))?.words ?? [];
    transcript = words.filter((w) => w.e > s && w.s < e).map((w) => w.w).join(" ");
  }
  const [updated] = await db
    .update(schema.clips)
    .set({
      ...(patch.title !== undefined ? { title: patch.title.trim().slice(0, 120) || clip.title } : {}),
      startSec: s,
      endSec: e,
      transcript,
      ...(patch.edit ? { edit: patch.edit } : {}),
      ...(patch.captionWords !== undefined ? { captionWords: patch.captionWords } : {}),
    })
    .where(eq(schema.clips.id, clip.id))
    .returning();
  return updated;
}

export async function deleteClip(userId: string, clipId: string) {
  const clip = await getOwnedClip(userId, clipId);
  await db.delete(schema.clips).where(eq(schema.clips.id, clip.id));
  await storage.deletePrefix(keys.clipPrefix(clip.projectId, clip.id));
}

export async function queueRender(userId: string, clipId: string, exportOpts: ExportOptions) {
  const clip = await getOwnedClip(userId, clipId);
  const busy = await db.query.jobs.findFirst({
    where: and(eq(schema.jobs.clipId, clip.id), eq(schema.jobs.type, "render_clip"), inArray(schema.jobs.status, ["queued", "running"])),
  });
  if (busy) throw new HttpError(409, "Este clip ya se está renderizando.");
  const edit = { ...(clip.edit ?? defaultEdit()), export: exportOpts };
  await db.update(schema.clips).set({ status: "queued", edit }).where(eq(schema.clips.id, clip.id));
  return enqueueJob({ type: "render_clip", projectId: clip.projectId, videoId: clip.videoId, clipId: clip.id, stage: "queued", params: { exportOpts } });
}
