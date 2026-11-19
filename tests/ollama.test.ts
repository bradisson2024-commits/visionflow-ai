/* eslint-disable @typescript-eslint/no-explicit-any -- respuestas JSON dinámicas en pruebas */
/**
 * Integración con Ollama usando un servidor FALSO que imita su API (/api/tags y
 * /api/chat). Verifica la conexión de la app (petición, esquema, errores) y el
 * flujo completo del análisis. NO evalúa la calidad de un modelo real.
 *
 * Requiere servidor y worker arrancados con:
 *   LLM_PROVIDER=ollama OLLAMA_URL=http://127.0.0.1:11999 LLM_MODEL=qwen2.5:7b
 */
import http from "node:http";
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { windows } from "@/server/analysis/detect";
import { Client, uniqueEmail } from "./helpers";

const c = new Client();
let server: http.Server;
let mode: "ok" | "missing-model" = "ok";
const requests: any[] = [];
let enabled = false;

beforeAll(async () => {
  server = http.createServer(async (req, res) => {
    if (req.url === "/api/tags") {
      res.setHeader("content-type", "application/json");
      return void res.end(JSON.stringify({ models: mode === "ok" ? [{ name: "qwen2.5:7b", model: "qwen2.5:7b" }] : [{ name: "llama3.2:latest" }] }));
    }
    if (req.url === "/api/chat") {
      let body = "";
      for await (const ch of req) body += ch;
      const json = JSON.parse(body);
      requests.push(json);
      // Responde con candidatos en función de las frases numeradas recibidas.
      const ids = [...json.messages[1].content.matchAll(/^\[(\d+)\]/gm)].map((m: RegExpMatchArray) => Number(m[1]));
      const sc = (v: number) => ({ hook: v, topicInterest: v, curiosity: v, emotion: v, clarity: v, standalone: v, retention: v, ending: v, socialPotential: v });
      const clips = [
        { startSentence: ids[Math.floor(ids.length * 0.5)], endSentence: ids[Math.floor(ids.length * 0.5)] + 2, title: "Consejo práctico", topic: "Contenido", momentType: "consejo práctico", hook: "h", reason: "r", scores: sc(85) },
        { startSentence: ids[Math.floor(ids.length * 0.2)], endSentence: ids[Math.floor(ids.length * 0.2)] + 2, title: "La historia", topic: "Historia", momentType: "historia", hook: "h", reason: "r", scores: sc(70) },
      ];
      res.setHeader("content-type", "application/json");
      return void res.end(JSON.stringify({ model: json.model, message: { role: "assistant", content: JSON.stringify({ topics: [], clips }) }, done: true, done_reason: "stop" }));
    }
    res.writeHead(404).end();
  });
  await new Promise<void>((r) => server.listen(11999, "127.0.0.1", r));
  await c.req("/api/auth/register", { method: "POST", json: { name: "Ollama", email: uniqueEmail("oll"), password: "contraseña-segura" } });
  const services = (await c.req("/api/services")).body.services;
  enabled = services.find((s: any) => s.id === "llm")?.provider === "ollama";
});
afterAll(() => server.close());

describe("ventanas para modelos locales", () => {
  it("divide transcripciones largas con solapamiento", () => {
    const s = Array.from({ length: 100 }, (_, i) => ({ i, s: i, e: i + 1, text: "a b c d e f g h i j", w0: 0, w1: 0 }));
    const w = windows(s, 200);
    expect(w.length).toBeGreaterThan(4);
    expect(w[0][w[0].length - 1].i).toBeGreaterThanOrEqual(w[1][0].i); // solapan
    expect(w[w.length - 1].at(-1)!.i).toBe(99);
    expect(windows(s, 0)).toHaveLength(1);
  });
});

describe("Ollama (servidor falso)", () => {
  it("analiza el video de punta a punta y crea clips ordenados por puntuación", async (ctx) => {
    if (!enabled) ctx.skip();
    const projectId = (await c.req("/api/projects", { method: "POST", json: { name: "Ollama" } })).body.project.id;
    const buf = readFileSync(path.join(__dirname, "fixtures", "podcast-es.mp4"));
    const v = (await c.req(`/api/projects/${projectId}/uploads`, { method: "POST", json: { filename: "p.mp4", size: buf.length } })).body.video.id;
    await c.req(`/api/uploads/${v}?offset=0`, { method: "PUT", body: buf, headers: { "content-type": "application/octet-stream" } });
    await c.req(`/api/uploads/${v}/complete`, { method: "POST" });

    const r = await c.req(`/api/projects/${projectId}/analyze`, { method: "POST", json: { mode: "full", language: "es", clipLength: { preset: "short", minSec: 12, maxSec: 30 }, maxClips: 5 } });
    expect(r.status).toBe(202);
    let d: any;
    for (let i = 0; i < 200; i++) {
      d = (await c.req(`/api/projects/${projectId}`)).body;
      const j = d.jobs.find((x: any) => x.type === "analyze");
      if (j && ["completed", "failed"].includes(j.status)) break;
      await new Promise((res) => setTimeout(res, 700));
    }
    const job = d.jobs.find((x: any) => x.type === "analyze");
    expect(job.error).toBeNull();
    expect(job.result.provider).toBe("ollama");
    // La petición a Ollama: modelo, esquema JSON y contexto ampliado
    const req = requests.at(-1);
    expect(req.model).toBe("qwen2.5:7b");
    expect(req.stream).toBe(false);
    expect(req.format.type).toBe("object");
    expect(req.format.properties.clips).toBeDefined();
    expect(req.options.num_ctx).toBeGreaterThanOrEqual(8192);
    // Clips creados, ajustados a la duración y ordenados por puntuación
    expect(d.clips.length).toBe(2);
    const sorted = [...d.clips].sort((a: any, b: any) => b.score - a.score);
    expect(sorted[0].title).toBe("Consejo práctico");
    for (const cl of d.clips) expect(cl.endSec - cl.startSec).toBeGreaterThanOrEqual(12 * 0.85);
  });

  it("si falta el modelo, avisa antes de encolar con el comando para instalarlo", async (ctx) => {
    if (!enabled) ctx.skip();
    mode = "missing-model";
    const projectId = (await c.req("/api/projects")).body.projects[0].id;
    const r = await c.req(`/api/projects/${projectId}/analyze`, { method: "POST", json: { mode: "full", clipLength: { preset: "short", minSec: 12, maxSec: 30 } } });
    expect(r.status).toBe(400);
    expect(r.body.error).toContain("ollama pull qwen2.5:7b");
    mode = "ok";
  });

  it("el estado del sistema muestra si Ollama está listo", async (ctx) => {
    if (!enabled) ctx.skip();
    const h = (await c.req("/api/health")).body.checks.find((x: any) => x.id === "ollama");
    expect(h.ok).toBe(true);
  });
});
