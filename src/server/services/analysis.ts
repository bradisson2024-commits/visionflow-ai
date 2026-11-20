import { and, desc, eq, inArray } from "drizzle-orm";
import { db, schema } from "../db";
import type { ProjectSettings } from "../db/schema";
import { HttpError } from "../http";
import { enqueueJob } from "../queue";
import { llmStatus, transcriptionStatus } from "../providers/status";
import { getOwnedProject } from "./projects";
import { env } from "../env";
import { checkOllama } from "../providers/llm/ollama";

export type AnalyzeInput = {
  mode: "full" | "transcribe";
  clipLength: NonNullable<ProjectSettings["clipLength"]>;
  maxClips: number;
  language: string;
  aspectRatio: NonNullable<ProjectSettings["aspectRatio"]>;
  captionStyle: string;
  reuseTranscript: boolean;
};

/** Comprueba que los servicios necesarios están listos (antes de gastar tiempo en importar o analizar). */
export async function checkAnalysisServices(input: Pick<AnalyzeInput, "mode">, needTranscription: boolean) {
  const t = transcriptionStatus();
  if (needTranscription && !t.ready)
    throw new HttpError(400, `La transcripción no está configurada (${t.provider}). Falta: ${t.missing.join(", ")}.`, { service: "transcription" });
  if (input.mode === "full") {
    const l = llmStatus();
    if (!l.ready) throw new HttpError(400, `La IA de análisis no está configurada (${l.provider}). Falta: ${l.missing.join(", ")}. Puedes transcribir igualmente y crear clips manuales.`, { service: "llm" });
    if (env.LLM_PROVIDER === "ollama") {
      const problem = await checkOllama();
      if (problem) throw new HttpError(400, problem, { service: "llm" });
    }
  }
}

export function checkClipLength(input: Pick<AnalyzeInput, "clipLength">, durationSec?: number | null) {
  if (input.clipLength.minSec < 3 || input.clipLength.maxSec <= input.clipLength.minSec)
    throw new HttpError(400, "Rango de duración no válido: el máximo debe ser mayor que el mínimo (y el mínimo, al menos 3 s).");
  if (durationSec != null && input.clipLength.minSec > durationSec) throw new HttpError(400, "La duración mínima de los clips es mayor que el video.");
}

/** Encola el análisis de un video ya cargado (sin comprobar el propietario: uso interno). */
export async function queueAnalysis(projectId: string, input: AnalyzeInput) {
  const project = await db.query.projects.findFirst({ where: eq(schema.projects.id, projectId) });
  if (!project) throw new HttpError(404, "Proyecto no encontrado.");
  const video = await db.query.videos.findFirst({
    where: and(eq(schema.videos.projectId, project.id), eq(schema.videos.uploadStatus, "uploaded")),
    orderBy: desc(schema.videos.createdAt),
  });
  if (!video) throw new HttpError(409, "El proyecto no tiene un video cargado.");
  if (!video.audioCodec) throw new HttpError(409, "El video no tiene pista de audio: no hay voz que analizar.");
  checkClipLength(input, video.durationSec);

  const active = await db.query.jobs.findFirst({
    where: and(eq(schema.jobs.projectId, project.id), eq(schema.jobs.type, "analyze"), inArray(schema.jobs.status, ["queued", "running"])),
  });
  if (active) throw new HttpError(409, "Ya hay un análisis en curso para este proyecto.");

  const existing = await db.query.transcripts.findFirst({ where: eq(schema.transcripts.videoId, video.id), columns: { id: true } });
  const needTranscription = !(input.reuseTranscript && existing);
  await checkAnalysisServices(input, needTranscription);

  await db
    .update(schema.projects)
    .set({
      status: "queued",
      settings: { ...project.settings, clipLength: input.clipLength, maxClips: input.maxClips, language: input.language, aspectRatio: input.aspectRatio, captionStyle: input.captionStyle },
    })
    .where(eq(schema.projects.id, project.id));
  return enqueueJob({ type: "analyze", projectId: project.id, videoId: video.id, stage: "queued", params: { ...input, reuseTranscript: !needTranscription } });
}

/** Valida el propietario y encola el análisis. */
export async function startAnalysis(userId: string, projectId: string, input: AnalyzeInput) {
  const project = await getOwnedProject(userId, projectId);
  return queueAnalysis(project.id, input);
}
