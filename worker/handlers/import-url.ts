import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { eq } from "drizzle-orm";
import { db, schema } from "@/server/db";
import { env } from "@/server/env";
import { moveFile, tempDir } from "@/server/storage";
import { downloadToPart } from "@/server/services/url-import";
import { finalizeVideo, markVideoFailed, partPath } from "@/server/services/videos";
import { platformDownload, platformInfo } from "@/server/media/ytdlp";
import { queueAnalysis, type AnalyzeInput } from "@/server/services/analysis";
import type { JobContext } from "../context";

const cleanTitle = (t: string) => t.replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 120) || "video";

export async function handleImportUrl(ctx: JobContext) {
  const videoId = ctx.job.videoId!;
  const params = ctx.job.params as { url: string; platform: string | null; autoAnalyze: AnalyzeInput | null; renameFromTitle: boolean };
  const maxBytes = env.MAX_UPLOAD_MB * 1048576;
  await ctx.update("downloading", 0);
  let title: string | null = null;
  try {
    const progress = async (got: number, total: number | null) => {
      await db.update(schema.videos).set({ receivedBytes: got, sizeBytes: total ?? got }).where(eq(schema.videos.id, videoId));
      await ctx.update("downloading", total ? Math.min(90, (got / total) * 90) : 0);
    };

    if (params.platform) {
      // YouTube y otras plataformas: yt-dlp
      const info = await platformInfo(params.url, ctx.signal);
      if (info.isLive) throw new Error("Es una transmisión en directo en curso: espera a que termine para importarla.");
      if (info.durationSec && info.durationSec > env.MAX_IMPORT_MINUTES * 60)
        throw new Error(`El video dura ${Math.round(info.durationSec / 60)} min; el máximo configurado es ${env.MAX_IMPORT_MINUTES} min (MAX_IMPORT_MINUTES).`);
      title = cleanTitle(info.title);
      await db.update(schema.videos).set({ originalFilename: `${title}.mp4`, mimeType: "video/mp4" }).where(eq(schema.videos.id, videoId));
      // Se descarga dentro del almacenamiento para que mover el archivo sea instantáneo.
      const dir = await mkdtemp(path.join(await tempDir("ytdlp"), "dl-"));
      try {
        let last = 0;
        const file = await platformDownload(params.url, dir, {
          maxBytes,
          signal: ctx.signal,
          onProgress: (got, total) => {
            if (Date.now() - last < 700) return;
            last = Date.now();
            progress(got, total).catch(() => {});
          },
        });
        await moveFile(file, await partPath(videoId));
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    } else {
      // Enlace directo a un archivo de video
      let last = 0;
      const { received, filename, contentType } = await downloadToPart(videoId, params.url, maxBytes, ctx.signal, async (got, total) => {
        if (Date.now() - last < 700) return;
        last = Date.now();
        await progress(got, total);
      });
      title = filename.replace(/\.[^.]+$/, "");
      await db.update(schema.videos).set({ originalFilename: filename, mimeType: contentType, sizeBytes: received, receivedBytes: received }).where(eq(schema.videos.id, videoId));
    }

    await ctx.update("probing", 92);
    const video = await finalizeVideo(videoId, await partPath(videoId));
    if (params.renameFromTitle && title) await db.update(schema.projects).set({ name: title }).where(eq(schema.projects.id, ctx.job.projectId));
    ctx.result = { title, durationSec: video.durationSec, platform: params.platform };
  } catch (err) {
    if (ctx.cancelled) return;
    const v = await db.query.videos.findFirst({ where: eq(schema.videos.id, videoId) });
    if (v && v.uploadStatus === "uploading") await markVideoFailed(videoId, v.projectId, (err as Error).message);
    throw err;
  }

  // Análisis automático: «pegar enlace → clips virales».
  if (params.autoAnalyze && !ctx.cancelled) {
    try {
      await queueAnalysis(ctx.job.projectId, params.autoAnalyze);
      ctx.result = { ...ctx.result, autoAnalyze: "queued" };
    } catch (e) {
      // El video quedó importado; el análisis no pudo empezar: se informa sin ocultarlo.
      ctx.result = { ...ctx.result, autoAnalyze: "failed", autoAnalyzeError: (e as Error).message };
      await db.insert(schema.jobs).values({
        type: "analyze",
        projectId: ctx.job.projectId,
        videoId,
        status: "failed",
        stage: "error",
        error: `No se pudo iniciar el análisis automático: ${(e as Error).message}`,
        params: params.autoAnalyze as unknown as Record<string, unknown>,
        finishedAt: new Date(),
      });
    }
  }
}
