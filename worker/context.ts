import { and, eq } from "drizzle-orm";
import { db, schema } from "@/server/db";
import type { Job } from "@/server/db/schema";

type Stage = (typeof schema.jobStage.enumValues)[number];

/** Estado de un trabajo en ejecución: progreso, etapa y cancelación. */
export class JobContext {
  readonly abort = new AbortController();
  cancelled = false;
  /** Resultado que se guarda en jobs.result al completar. */
  result: Record<string, unknown> | undefined;
  private poll: NodeJS.Timeout;

  constructor(public job: Job) {
    // Comprueba periódicamente si el usuario canceló (o borró) el trabajo.
    this.poll = setInterval(async () => {
      const r = await db.query.jobs.findFirst({ where: eq(schema.jobs.id, job.id), columns: { status: true } });
      if (!r || r.status === "cancelled") {
        this.cancelled = true;
        this.abort.abort(new Error("Cancelado por el usuario."));
      }
    }, 1500);
  }

  get signal() {
    return this.abort.signal;
  }

  async start() {
    await db.update(schema.jobs).set({ status: "running", startedAt: new Date(), attempts: this.job.attempts + 1, error: null }).where(eq(schema.jobs.id, this.job.id));
  }

  async update(stage: Stage, progress: number) {
    if (this.cancelled) throw new Error("Cancelado por el usuario.");
    await db.update(schema.jobs).set({ stage, progress: Math.max(0, Math.min(100, Math.round(progress))) }).where(eq(schema.jobs.id, this.job.id));
  }

  async complete(result?: Record<string, unknown>) {
    await db.update(schema.jobs).set({ status: "completed", stage: "completed", progress: 100, finishedAt: new Date(), result: result ?? null }).where(this.stillRunning());
  }

  async fail(message: string) {
    await db.update(schema.jobs).set({ status: "failed", stage: "error", error: message, finishedAt: new Date() }).where(this.stillRunning());
  }

  /** Un trabajo cancelado por el usuario nunca se sobrescribe como completado o fallido. */
  private stillRunning() {
    return and(eq(schema.jobs.id, this.job.id), eq(schema.jobs.status, "running"));
  }

  dispose() {
    clearInterval(this.poll);
  }
}
