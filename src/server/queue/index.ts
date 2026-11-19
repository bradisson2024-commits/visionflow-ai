/**
 * Cola de trabajos en segundo plano (BullMQ sobre Redis).
 * La fila de `jobs` en PostgreSQL es la fuente de verdad del estado visible;
 * BullMQ sólo transporta el identificador y gestiona la ejecución.
 */
import { Queue } from "bullmq";
import IORedis from "ioredis";
import { db, schema } from "../db";
import { env } from "../env";

export const QUEUE_NAME = "clipforge";
export type JobPayload = { jobId: string };

const g = globalThis as unknown as { __cfQueue?: Queue<JobPayload> };

export function redisConnection() {
  return new IORedis(env.REDIS_URL, { maxRetriesPerRequest: null });
}

export function queue(): Queue<JobPayload> {
  if (!g.__cfQueue) g.__cfQueue = new Queue<JobPayload>(QUEUE_NAME, { connection: redisConnection() });
  return g.__cfQueue;
}

type NewJob = typeof schema.jobs.$inferInsert;

/** Crea el registro del trabajo y lo encola. */
export async function enqueueJob(values: NewJob) {
  const [job] = await db.insert(schema.jobs).values(values).returning();
  await queue().add(values.type, { jobId: job.id }, { jobId: job.id, removeOnComplete: 1000, removeOnFail: 1000 });
  return job;
}
