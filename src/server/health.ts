import { spawn } from "node:child_process";
import IORedis from "ioredis";
import { sql } from "drizzle-orm";
import { db } from "./db";
import { env } from "./env";

export type Check = { id: string; label: string; ok: boolean; detail: string };

function runVersion(bin: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const p = spawn(bin, ["-version"]);
    let out = "";
    p.stdout.on("data", (d) => (out += d));
    p.on("error", reject);
    p.on("close", (code) => (code === 0 ? resolve(out.split("\n")[0] ?? "") : reject(new Error(`exit ${code}`))));
  });
}

export async function runHealthChecks(): Promise<Check[]> {
  const checks: Check[] = [];
  try {
    await db.execute(sql`select 1`);
    checks.push({ id: "database", label: "Base de datos (PostgreSQL)", ok: true, detail: "Conectada" });
  } catch (e) {
    checks.push({ id: "database", label: "Base de datos (PostgreSQL)", ok: false, detail: (e as Error).message });
  }
  const redis = new IORedis(env.REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 0, connectTimeout: 2000 });
  try {
    await redis.connect();
    await redis.ping();
    checks.push({ id: "queue", label: "Cola de trabajos (Redis)", ok: true, detail: "Conectada" });
  } catch (e) {
    checks.push({ id: "queue", label: "Cola de trabajos (Redis)", ok: false, detail: (e as Error).message });
  } finally {
    redis.disconnect();
  }
  for (const [id, label, bin] of [
    ["ffmpeg", "FFmpeg", env.FFMPEG_PATH],
    ["ffprobe", "FFprobe", env.FFPROBE_PATH],
  ] as const) {
    try {
      checks.push({ id, label, ok: true, detail: await runVersion(bin) });
    } catch (e) {
      checks.push({ id, label, ok: false, detail: `No disponible (${(e as Error).message})` });
    }
  }
  return checks;
}
