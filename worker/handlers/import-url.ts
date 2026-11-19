import { eq } from "drizzle-orm";
import { db, schema } from "@/server/db";
import { env } from "@/server/env";
import { downloadToPart } from "@/server/services/url-import";
import { finalizeVideo, markVideoFailed, partPath } from "@/server/services/videos";
import type { JobContext } from "../context";

export async function handleImportUrl(ctx: JobContext) {
  const videoId = ctx.job.videoId!;
  const url = String(ctx.job.params.url);
  await ctx.update("downloading", 0);
  try {
    const { received, filename, contentType } = await downloadToPart(videoId, url, env.MAX_UPLOAD_MB * 1048576, ctx.signal, async (got, total) => {
      await db.update(schema.videos).set({ receivedBytes: got, sizeBytes: total ?? got }).where(eq(schema.videos.id, videoId));
      await ctx.update("downloading", total ? (got / total) * 90 : 0);
    });
    await db.update(schema.videos).set({ originalFilename: filename, mimeType: contentType, sizeBytes: received, receivedBytes: received }).where(eq(schema.videos.id, videoId));
    await ctx.update("probing", 92);
    await finalizeVideo(videoId, await partPath(videoId));
  } catch (err) {
    if (ctx.cancelled) return;
    const v = await db.query.videos.findFirst({ where: eq(schema.videos.id, videoId) });
    if (v && v.uploadStatus === "uploading") await markVideoFailed(videoId, v.projectId, (err as Error).message);
    throw err;
  }
}
