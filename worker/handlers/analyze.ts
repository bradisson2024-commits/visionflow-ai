/**
 * Trabajo de análisis: audio → transcripción → detección de momentos → clips.
 */
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { and, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/server/db";
import { storage } from "@/server/storage";
import { extractMp3Chunks, extractWav16k } from "@/server/media/audio";
import { transcribe } from "@/server/providers/transcription";
import { getLlm } from "@/server/providers/llm";
import { buildSentences, segmentEndIndices } from "@/server/analysis/sentences";
import { detectMoments } from "@/server/analysis/detect";
import { defaultEdit } from "@/lib/captions";
import { env } from "@/server/env";
import type { AnalyzeInput } from "@/server/services/analysis";
import type { JobContext } from "../context";

export async function handleAnalyze(ctx: JobContext) {
  const p = ctx.job.params as unknown as AnalyzeInput;
  const video = await db.query.videos.findFirst({ where: eq(schema.videos.id, ctx.job.videoId!) });
  if (!video || !video.storageKey) throw new Error("El video ya no existe.");
  await db.update(schema.projects).set({ status: "processing" }).where(eq(schema.projects.id, ctx.job.projectId));

  try {
    let transcript = p.reuseTranscript ? await db.query.transcripts.findFirst({ where: eq(schema.transcripts.videoId, video.id) }) : undefined;

    if (!transcript) {
      // 1) Audio
      await ctx.update("extracting_audio", 2);
      const tmp = await mkdtemp(path.join(os.tmpdir(), "cf-audio-"));
      const src = await storage.materialize(video.storageKey);
      try {
        const wav = path.join(tmp, "audio16k.wav");
        const local = env.TRANSCRIPTION_PROVIDER === "local";
        if (local) await extractWav16k(src.path, wav, ctx.signal);
        const chunks = local ? [] : await extractMp3Chunks(src.path, tmp, video.durationSec ?? 0, 600, ctx.signal);
        await ctx.update("transcribing", 8);
        // 2) Transcripción
        const result = await transcribe({
          chunks,
          wav16k: wav,
          language: p.language,
          signal: ctx.signal,
          onProgress: (pct) => ctx.update("transcribing", 8 + pct * 0.47).catch(() => {}),
        });
        if (result.words.length === 0) throw new Error("No se detectó voz en el video: la transcripción está vacía.");
        await db.delete(schema.transcripts).where(eq(schema.transcripts.videoId, video.id));
        [transcript] = await db
          .insert(schema.transcripts)
          .values({
            videoId: video.id,
            provider: result.provider + (result.estimatedWordTimes ? " (tiempos estimados)" : ""),
            model: result.model,
            language: result.language,
            text: result.text,
            segments: result.segments,
            words: result.words,
          })
          .returning();
      } finally {
        await src.cleanup();
        await rm(tmp, { recursive: true, force: true });
      }
    }
    await ctx.update("transcribing", 55);

    if (p.mode === "transcribe") {
      await db.update(schema.projects).set({ status: "ready" }).where(eq(schema.projects.id, ctx.job.projectId));
      ctx.result = { mode: "transcribe", words: transcript.words.length };
      return;
    }

    // 3) Momentos
    await ctx.update("detecting_moments", 60);
    const sentences = buildSentences(transcript.words, segmentEndIndices(transcript.words, transcript.segments));
    const llm = getLlm();
    const detected = await detectMoments(
      llm,
      sentences,
      { minSec: p.clipLength.minSec, maxSec: p.clipLength.maxSec, maxClips: p.maxClips, language: transcript.language, windowWords: env.LLM_WINDOW_WORDS },
      video.durationSec ?? sentences[sentences.length - 1].e,
      ctx.signal,
      (done, total) => ctx.update("detecting_moments", 60 + (done / total) * 28).catch(() => {}),
    );
    if (detected.clips.length === 0)
      throw new Error(`La IA no encontró momentos que cumplan la duración pedida (${p.clipLength.minSec}–${p.clipLength.maxSec} s) con frases completas. Prueba otro rango de duración.`);

    // 4) Clips: sustituye las sugerencias anteriores no renderizadas.
    await ctx.update("generating_clips", 90);
    await db.delete(schema.clips).where(and(eq(schema.clips.projectId, ctx.job.projectId), inArray(schema.clips.status, ["suggested", "failed"])));
    const kept = await db.query.clips.findMany({ where: eq(schema.clips.projectId, ctx.job.projectId), columns: { position: true } });
    const base = kept.reduce((m, c) => Math.max(m, c.position), 0);
    await db.insert(schema.clips).values(
      detected.clips.map((c, i) => ({
        projectId: ctx.job.projectId,
        videoId: video.id,
        position: base + i + 1,
        title: c.title,
        topic: c.topic,
        startSec: c.startSec,
        endSec: c.endSec,
        transcript: c.transcript,
        reason: c.reason,
        hook: c.hook,
        score: c.score,
        scoreBreakdown: c.scoreBreakdown,
        edit: defaultEdit(p.aspectRatio, p.captionStyle),
      })),
    );
    await db.update(schema.projects).set({ status: "ready" }).where(eq(schema.projects.id, ctx.job.projectId));
    ctx.result = { mode: "full", provider: llm.id, model: llm.model, candidates: detected.candidates, accepted: detected.clips.length, rejected: detected.rejected, topics: detected.topics };
  } catch (err) {
    if (!ctx.cancelled) await db.update(schema.projects).set({ status: "error" }).where(eq(schema.projects.id, ctx.job.projectId));
    throw err;
  }
}
