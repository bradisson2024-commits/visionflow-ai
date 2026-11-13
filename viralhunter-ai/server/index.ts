import { Hono, type Context } from "hono";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { streamSSE } from "hono/streaming";
import { secureHeaders } from "hono/secure-headers";
import { bodyLimit } from "hono/body-limit";
import { cors } from "hono/cors";
import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { env, missing, MissingCredentialError, imageCredKeys } from "./env";
import { sql } from "./db";
import { quotaUsedToday, YouTubeError } from "./services/youtube";
import { runSearch, loadSearch, STEP_LABELS } from "./services/hunter";
import * as replica from "./services/replica";
import { loadAsset } from "./services/assets";
import { listVoices, synthesize } from "./services/voice";
import type { ConfigStatus } from "../shared/types";

const app = new Hono();
const accessToken = (process.env.APP_ACCESS_TOKEN ?? "").trim();

app.use("*", secureHeaders({ crossOriginResourcePolicy: "same-origin" }));
if (env.allowedOrigin) app.use("/api/*", cors({ origin: env.allowedOrigin }));
app.use("/api/*", bodyLimit({ maxSize: 256 * 1024 }));

// Acceso opcional protegido por token (recomendado al desplegar públicamente).
app.use("/api/*", async (c, next) => {
  if (!accessToken || c.req.path === "/api/config" || c.req.path.startsWith("/api/assets/")) return next();
  const got = c.req.header("x-app-token") ?? "";
  const ok = got.length === accessToken.length && timingSafeEqual(Buffer.from(got), Buffer.from(accessToken));
  if (!ok) return c.json({ error: "Token de acceso requerido (APP_ACCESS_TOKEN)." }, 401);
  return next();
});

// Limitador simple para endpoints que consumen APIs de pago o cuota.
const hits = new Map<string, number[]>();
const limit = (max: number, windowMs: number) => async (c: Context, next: () => Promise<void>) => {
  const ip = c.req.header("x-forwarded-for")?.split(",")[0].trim() ?? "local";
  const key = `${ip}:${c.req.routePath}`;
  const now = Date.now();
  const arr = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  if (arr.length >= max) return c.json({ error: "Demasiadas solicitudes, espera un momento." }, 429);
  arr.push(now);
  hits.set(key, arr);
  await next();
};

function errorResponse(c: Context, e: unknown) {
  if (e instanceof MissingCredentialError) return c.json({ error: e.message, missing: e.missing }, 412);
  if (e instanceof YouTubeError) return c.json({ error: e.message, reason: e.reason }, e.status === 403 ? 403 : 502);
  if (e instanceof z.ZodError) return c.json({ error: "Datos no válidos", issues: e.issues }, 400);
  const status = (e as any)?.status;
  console.error(e);
  const code = (typeof status === "number" && status >= 400 && status < 600 ? status : 500) as 400 | 500;
  return c.json({ error: (e as Error).message ?? "Error" }, code);
}

const COST_RECENT = 1300; // unidades aprox. de una búsqueda reciente (9 search.list + lecturas + comprobaciones)

app.get("/api/config", async (c) => {
  const used = await quotaUsedToday();
  const m = missing("DATABASE_URL", "YOUTUBE_API_KEY", "ANTHROPIC_API_KEY", ...imageCredKeys(), "ELEVENLABS_API_KEY");
  const has = (k: string) => !m.some((x) => x.env === k);
  const status: ConfigStatus = {
    database: has("DATABASE_URL"),
    youtube: has("YOUTUBE_API_KEY"),
    ai: has("ANTHROPIC_API_KEY"),
    images: imageCredKeys().every(has),
    voice: has("ELEVENLABS_API_KEY"),
    missing: m,
    quota: {
      usedToday: used,
      dailyLimit: env.youtubeDailyQuota,
      searchesLeftEstimate: Math.max(0, Math.floor((env.youtubeDailyQuota - used) / COST_RECENT)),
      costPerRecentSearch: COST_RECENT,
    },
  };
  return c.json({ ...status, imageProvider: env.imageProvider, accessTokenRequired: !!accessToken });
});

// ---------- Búsquedas (Server-Sent Events con progreso real) ----------
function sse(c: Context, work: (send: (data: unknown) => Promise<void>) => Promise<unknown>) {
  return streamSSE(c, async (stream) => {
    const send = (data: unknown) => stream.writeSSE({ data: JSON.stringify(data) });
    try {
      await work(send);
    } catch (e) {
      await send({ type: "error", message: (e as Error).message, missing: e instanceof MissingCredentialError ? e.missing : undefined });
    }
  });
}

const preflight = (...keys: string[]) => {
  const m = missing(...keys);
  if (m.length) throw new MissingCredentialError(m);
};

app.post("/api/search/recent", limit(6, 60_000), (c) =>
  sse(c, async (send) => {
    preflight("DATABASE_URL", "YOUTUBE_API_KEY");
    await send({ type: "steps", labels: STEP_LABELS });
    const r = await runSearch("recent", null, (e) => void send(e));
    await send({ type: "done", ...r });
  }),
);

const NicheBody = z.object({
  topic: z.string().trim().min(2).max(120),
  language: z.string().regex(/^[a-z]{2}$|^$/).default(""),
  country: z.string().regex(/^[A-Z]{2}$|^$/).default(""),
  publishedAfter: z.string().regex(/^\d{4}-\d{2}-\d{2}$|^$/).default(""),
  publishedBefore: z.string().regex(/^\d{4}-\d{2}-\d{2}$|^$/).default(""),
});

app.post("/api/search/niche", limit(6, 60_000), async (c) => {
  let body: z.infer<typeof NicheBody>;
  try {
    body = NicheBody.parse(await c.req.json());
  } catch (e) {
    return errorResponse(c, e);
  }
  return sse(c, async (send) => {
    preflight("DATABASE_URL", "YOUTUBE_API_KEY");
    await send({ type: "steps", labels: STEP_LABELS });
    const r = await runSearch("niche", body, (e) => void send(e));
    await send({ type: "done", ...r });
  });
});

app.get("/api/searches", async (c) => {
  try {
    const rows = await sql()`select s.id, s.kind, s.params, s.niches, s.status, s.quota_units, s.created_at,
        (select count(*)::int from search_results r where r.search_id = s.id) as results
      from searches s order by s.created_at desc limit 30`;
    return c.json(rows);
  } catch (e) {
    return errorResponse(c, e);
  }
});

app.get("/api/searches/:id", async (c) => {
  try {
    const r = await loadSearch(z.string().uuid().parse(c.req.param("id")));
    return r ? c.json(r) : c.json({ error: "No encontrada" }, 404);
  } catch (e) {
    return errorResponse(c, e);
  }
});

// ---------- ReplicaPro ----------
const Url = z.object({ url: z.string().trim().min(3).max(300) });
const id = (c: Context) => z.string().uuid().parse(c.req.param("id"));

app.post("/api/projects", async (c) => {
  try {
    const { url } = Url.parse(await c.req.json());
    return c.json({ id: await replica.createProject(url) });
  } catch (e) {
    return errorResponse(c, e);
  }
});
app.get("/api/projects", async (c) => {
  try {
    return c.json(await replica.listProjects());
  } catch (e) {
    return errorResponse(c, e);
  }
});
app.get("/api/projects/:id", async (c) => {
  try {
    const p = await replica.getProject(id(c));
    return p ? c.json(p) : c.json({ error: "Proyecto no encontrado" }, 404);
  } catch (e) {
    return errorResponse(c, e);
  }
});

app.post("/api/projects/:id/analyze", limit(10, 60_000), async (c) => {
  let pid: string, url: string;
  try {
    pid = id(c);
    url = Url.parse(await c.req.json()).url;
  } catch (e) {
    return errorResponse(c, e);
  }
  return sse(c, async (send) => {
    preflight("DATABASE_URL", "YOUTUBE_API_KEY");
    await send({ type: "steps", labels: replica.ANALYZE_STEPS });
    const a = await replica.analyzeChannel(pid, url, (e) => void send(e));
    await send({ type: "done", analysis: a });
  });
});

const wrap = (f: (c: Context) => Promise<unknown>) => async (c: Context) => {
  try {
    return c.json((await f(c)) ?? { ok: true });
  } catch (e) {
    return errorResponse(c, e);
  }
};

app.post("/api/projects/:id/style/analyze", limit(10, 60_000), wrap(async (c) => replica.analyzeStyle(id(c))));
app.post(
  "/api/projects/:id/style/images",
  limit(10, 60_000),
  wrap(async (c) => {
    const { extra } = z.object({ extra: z.string().max(500).optional() }).parse(await c.req.json().catch(() => ({})));
    return { images: await replica.referenceImages(id(c), extra) };
  }),
);
app.post(
  "/api/projects/:id/character",
  limit(10, 60_000),
  wrap(async (c) => {
    const { description } = z.object({ description: z.string().trim().min(5).max(800) }).parse(await c.req.json());
    return { images: await replica.characterImage(id(c), description) };
  }),
);
app.get("/api/voices", wrap(async () => listVoices()));
app.post(
  "/api/projects/:id/voice/sample",
  limit(20, 60_000),
  wrap(async (c) => {
    const b = z
      .object({
        voiceId: z.string().min(5).max(64),
        text: z.string().trim().min(5).max(600),
        language: z.string().regex(/^[a-z]{2}$/),
        stability: z.number().min(0).max(1),
        similarity: z.number().min(0).max(1),
        style: z.number().min(0).max(1),
        speed: z.number().min(0.7).max(1.2),
      })
      .parse(await c.req.json());
    return synthesize({ projectId: id(c), ...b });
  }),
);
app.post(
  "/api/projects/:id/style/approve",
  wrap(async (c) => {
    const choices = z
      .object({
        language: z.string().regex(/^[a-z]{2}$/),
        character: z.object({ mode: z.enum(["none", "create"]), description: z.string().max(800).optional(), assetId: z.string().uuid().optional() }),
        voice: z
          .object({ voiceId: z.string(), voiceName: z.string(), stability: z.number(), similarity: z.number(), style: z.number(), speed: z.number(), sampleAssetId: z.string().uuid().optional() })
          .nullable(),
        referenceAssetIds: z.array(z.string().uuid()).max(10).default([]),
      })
      .parse(await c.req.json());
    await replica.approveStyle(id(c), choices);
  }),
);
app.post("/api/projects/:id/branding/generate", limit(5, 60_000), async (c) => {
  let pid: string;
  try {
    pid = id(c);
  } catch (e) {
    return errorResponse(c, e);
  }
  return sse(c, async (send) => {
    preflight("DATABASE_URL", "ANTHROPIC_API_KEY", ...imageCredKeys());
    await send({ type: "steps", labels: replica.BRANDING_STEPS });
    const proposals = await replica.generateBranding(pid, (e) => void send(e));
    await send({ type: "done", proposals });
  });
});
app.post(
  "/api/projects/:id/branding/approve",
  wrap(async (c) => {
    const { index } = z.object({ index: z.number().int().min(0).max(9) }).parse(await c.req.json());
    await replica.approveBranding(id(c), index);
  }),
);
app.post(
  "/api/projects/:id/videos/generate",
  limit(5, 60_000),
  wrap(async (c) => {
    const { count } = z.object({ count: z.number().int().min(1).max(6).default(3) }).parse(await c.req.json().catch(() => ({})));
    return replica.generateVideos(id(c), count);
  }),
);
app.post(
  "/api/projects/:id/videos/:index/thumbnail",
  limit(10, 60_000),
  wrap(async (c) => replica.videoThumbnail(id(c), z.coerce.number().int().min(0).parse(c.req.param("index")))),
);
app.post(
  "/api/projects/:id/stage",
  wrap(async (c) => {
    const { stage } = z.object({ stage: z.number().int().min(1).max(4) }).parse(await c.req.json());
    return { stage: await replica.setStage(id(c), stage) };
  }),
);

app.get("/api/assets/:id", async (c) => {
  try {
    const a = await loadAsset(id(c));
    if (!a) return c.json({ error: "No encontrado" }, 404);
    return new Response(new Uint8Array(a.data), { headers: { "Content-Type": a.mimeType, "Cache-Control": "private, max-age=31536000, immutable" } });
  } catch (e) {
    return errorResponse(c, e);
  }
});

// Ajustes no secretos (preferencias)
app.get("/api/settings/:key", wrap(async (c) => {
  const [r] = await sql()`select value from settings where key = ${z.string().max(64).parse(c.req.param("key"))}`;
  return { value: r?.value ?? null };
}));
app.put("/api/settings/:key", wrap(async (c) => {
  const key = z.string().max(64).parse(c.req.param("key"));
  const { value } = z.object({ value: z.unknown() }).parse(await c.req.json());
  await sql()`insert into settings (key, value) values (${key}, ${sql().json(value as any)}) on conflict (key) do update set value = excluded.value, updated_at = now()`;
}));

// Producción: servir el frontend compilado
if (env.production) {
  app.use("/*", serveStatic({ root: "./dist" }));
  app.get("*", serveStatic({ path: "./dist/index.html" }));
}

serve({ fetch: app.fetch, port: env.port }, (i) => console.log(`ViralHunter AI API en http://localhost:${i.port}`));
