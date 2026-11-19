/**
 * Worker de ClipForge: proceso separado que ejecuta los trabajos pesados
 * (descargas, FFmpeg, transcripción, IA) sin bloquear la aplicación web.
 *
 *   npm run worker
 */
import "dotenv/config";
import { Worker } from "bullmq";
import { eq } from "drizzle-orm";
import { db, schema } from "@/server/db";
import { env } from "@/server/env";
import { QUEUE_NAME, redisConnection, type JobPayload } from "@/server/queue";
import { handleImportUrl } from "./handlers/import-url";
import { JobContext } from "./context";

const handlers: Partial<Record<(typeof schema.jobType.enumValues)[number], (ctx: JobContext) => Promise<void>>> = {
  import_url: handleImportUrl,
};

const worker = new Worker<JobPayload>(
  QUEUE_NAME,
  async (bull) => {
    const row = await db.query.jobs.findFirst({ where: eq(schema.jobs.id, bull.data.jobId) });
    if (!row) return; // el proyecto se eliminó
    if (row.status === "cancelled") return;
    const handler = handlers[row.type];
    const ctx = new JobContext(row);
    await ctx.start();
    if (!handler) {
      await ctx.fail(`Tipo de trabajo aún no implementado: ${row.type}`);
      ctx.dispose();
      return;
    }
    try {
      await handler(ctx);
      if (!ctx.cancelled) await ctx.complete();
    } catch (err) {
      if (ctx.cancelled) return;
      console.error(`[worker] trabajo ${row.id} (${row.type}) falló:`, err);
      await ctx.fail((err as Error).message);
    } finally {
      ctx.dispose();
    }
  },
  { connection: redisConnection(), concurrency: env.WORKER_CONCURRENCY },
);

worker.on("ready", () => console.log(`[worker] escuchando la cola "${QUEUE_NAME}" (concurrencia ${env.WORKER_CONCURRENCY})`));
const shutdown = async () => {
  await worker.close();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
