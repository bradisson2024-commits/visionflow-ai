import { eq } from "drizzle-orm";
import { db, schema } from "@/server/db";
import type { ExportOptions } from "@/server/db/schema";
import { keys, storage } from "@/server/storage";
import { DEFAULT_EXPORT, renderClip } from "@/server/render/render-clip";
import { defaultEdit } from "@/lib/captions";
import type { JobContext } from "../context";

export async function handleRenderClip(ctx: JobContext) {
  const clipId = ctx.job.clipId!;
  const clip = await db.query.clips.findFirst({ where: eq(schema.clips.id, clipId) });
  if (!clip) throw new Error("El clip ya no existe.");
  const video = await db.query.videos.findFirst({ where: eq(schema.videos.id, clip.videoId) });
  if (!video?.storageKey) throw new Error("El video original ya no existe.");
  const transcript = await db.query.transcripts.findFirst({ where: eq(schema.transcripts.videoId, video.id) });
  const exportOpts = { ...DEFAULT_EXPORT, ...((ctx.job.params.exportOpts as ExportOptions) ?? {}) };
  const edit = clip.edit ?? defaultEdit();

  await db.update(schema.clips).set({ status: "rendering" }).where(eq(schema.clips.id, clip.id));
  await ctx.update("rendering", 1);
  const src = await storage.materialize(video.storageKey);
  try {
    const out = await renderClip({
      sourceFile: src.path,
      video,
      clip,
      edit,
      words: clip.captionWords ?? transcript?.words ?? [],
      exportOpts,
      signal: ctx.signal,
      onProgress: (pct) => ctx.update("rendering", pct).catch(() => {}),
    });
    try {
      // Sustituye los archivos anteriores del clip.
      await storage.deletePrefix(keys.clipPrefix(clip.projectId, clip.id));
      const v = Date.now();
      const videoKey = keys.clipFile(clip.projectId, clip.id, v, ".mp4");
      const thumbKey = keys.clipFile(clip.projectId, clip.id, v, ".jpg");
      const srtKey = out.srtFile ? keys.clipFile(clip.projectId, clip.id, v, ".srt") : null;
      await storage.putFile(videoKey, out.videoFile, "video/mp4");
      await storage.putFile(thumbKey, out.thumbFile, "image/jpeg");
      if (out.srtFile && srtKey) await storage.putFile(srtKey, out.srtFile, "application/x-subrip");
      await db
        .update(schema.clips)
        .set({ status: "ready", outputKey: videoKey, thumbnailKey: thumbKey, subtitleKey: srtKey, renderInfo: out.info, renderedAt: new Date() })
        .where(eq(schema.clips.id, clip.id));
      ctx.result = out.info as unknown as Record<string, unknown>;
    } finally {
      await out.cleanup();
    }
  } catch (err) {
    if (!ctx.cancelled) await db.update(schema.clips).set({ status: "failed" }).where(eq(schema.clips.id, clip.id));
    throw err;
  } finally {
    await src.cleanup();
  }
}
