/* eslint-disable @typescript-eslint/no-explicit-any -- respuestas JSON dinámicas en pruebas */
/**
 * Fases 3–6 de extremo a extremo con el servidor y el worker reales:
 * video con voz → transcripción real (Whisper local) → clip → edición →
 * render 9:16 con seguimiento de rostro y subtítulos → descarga → ZIP.
 * Requiere TRANSCRIPTION_PROVIDER=local y los modelos de scripts/download-models.sh.
 */
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { beforeAll, describe, expect, it } from "vitest";
import { BASE, Client, uniqueEmail } from "./helpers";

const FIX = path.join(__dirname, "fixtures");
const c = new Client();
let projectId = "";
let clipId = "";
const detail = () => c.req(`/api/projects/${projectId}`).then((r) => r.body);

async function waitFor<T>(fn: () => Promise<T>, ok: (v: T) => boolean, ms = 120_000): Promise<T> {
  const end = Date.now() + ms;
  let last: T;
  do {
    last = await fn();
    if (ok(last)) return last;
    await new Promise((r) => setTimeout(r, 700));
  } while (Date.now() < end);
  return last;
}

async function upload(file: string) {
  const buf = readFileSync(path.join(FIX, file));
  const init = await c.req(`/api/projects/${projectId}/uploads`, { method: "POST", json: { filename: file, size: buf.length, mimeType: "video/mp4" } });
  const id = init.body.video.id;
  for (let off = 0; off < buf.length; off += 8 * 1024 * 1024)
    await c.req(`/api/uploads/${id}?offset=${off}`, { method: "PUT", body: buf.subarray(off, off + 8 * 1024 * 1024), headers: { "content-type": "application/octet-stream" } });
  return c.req(`/api/uploads/${id}/complete`, { method: "POST" });
}

function probe(buf: Buffer) {
  const f = path.join(FIX, `.probe-${Date.now()}.mp4`);
  writeFileSync(f, buf);
  try {
    return JSON.parse(execFileSync("ffprobe", ["-v", "error", "-print_format", "json", "-show_streams", "-show_format", f]).toString());
  } finally {
    rmSync(f);
  }
}

beforeAll(async () => {
  await c.req("/api/auth/register", { method: "POST", json: { name: "E2E", email: uniqueEmail("e2e"), password: "contraseña-segura" } });
  projectId = (await c.req("/api/projects", { method: "POST", json: { name: "Podcast E2E" } })).body.project.id;
  expect((await upload("podcast-es.mp4")).status).toBe(200);
});

describe("Fase 3 — análisis", () => {
  it("rechaza el análisis completo con un error claro si la IA no está configurada", async () => {
    const r = await c.req(`/api/projects/${projectId}/analyze`, { method: "POST", json: { mode: "full", clipLength: { preset: "short", minSec: 15, maxSec: 35 } } });
    if (r.status === 202) return; // hay un proveedor de IA configurado en este entorno
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/IA de análisis no está configurada/);
  });

  it("valida el rango de duración", async () => {
    const r = await c.req(`/api/projects/${projectId}/analyze`, { method: "POST", json: { mode: "transcribe", clipLength: { preset: "custom", minSec: 40, maxSec: 20 } } });
    expect(r.status).toBe(400);
  });

  it("transcribe de verdad el audio con Whisper local, con etapas y progreso", async () => {
    const r = await c.req(`/api/projects/${projectId}/analyze`, { method: "POST", json: { mode: "transcribe", language: "es", clipLength: { preset: "short", minSec: 15, maxSec: 35 } } });
    expect(r.status).toBe(202);
    const seen = new Set<string>();
    const d = await waitFor(detail, (b) => {
      const j = b.jobs.find((x: any) => x.type === "analyze");
      if (j) seen.add(j.stage);
      return j && ["completed", "failed"].includes(j.status);
    });
    const job = d.jobs.find((x: any) => x.type === "analyze");
    expect(job.error).toBeNull();
    expect(job.status).toBe("completed");
    expect([...seen].some((s) => ["extracting_audio", "transcribing"].includes(s))).toBe(true);
    expect(d.project.status).toBe("ready");
    // La página del proyecto muestra la transcripción real
    const page = await c.req(`/projects/${projectId}`);
    expect(page.body).toContain("Transcripción");
  });
});

describe("Fases 4–6 — clip manual, edición, render y descarga", () => {
  it("crea un clip manual y devuelve las palabras transcritas del tramo", async () => {
    const r = await c.req(`/api/projects/${projectId}/clips`, { method: "POST", json: { startSec: 63, endSec: 80, title: "Los primeros tres segundos" } });
    expect(r.status).toBe(201);
    clipId = r.body.clip.id;
    expect(r.body.clip.transcript.toLowerCase()).toMatch(/segundos|consejo|atenci/);
    const g = await c.req(`/api/clips/${clipId}`);
    expect(g.body.transcriptWords.length).toBeGreaterThan(50);
    expect(g.body.clip.edit.aspectRatio).toBe("9:16");
  });

  it("rechaza rangos no válidos", async () => {
    expect((await c.req(`/api/clips/${clipId}`, { method: "PATCH", json: { startSec: 50, endSec: 40 } })).status).toBe(400);
    expect((await c.req(`/api/clips/${clipId}`, { method: "PATCH", json: { endSec: 5000 } })).status).toBe(400);
  });

  it("guarda la edición: recorte, estilo de subtítulos y palabras corregidas", async () => {
    const g = (await c.req(`/api/clips/${clipId}`)).body;
    const words = g.transcriptWords.map((w: any) => (w.s >= 69 && w.s < 70.5 ? { ...w, w: "CORREGIDO" } : w));
    const edit = { ...g.clip.edit, captions: { ...g.clip.edit.captions, preset: "highlight", highlightMode: "karaoke", highlightColor: "#FF8A1F" } };
    const r = await c.req(`/api/clips/${clipId}`, { method: "PATCH", json: { startSec: 63.2, endSec: 79.5, edit, captionWords: words } });
    expect(r.status).toBe(200);
    expect(r.body.clip.startSec).toBeCloseTo(63.2);
    expect(r.body.clip.transcript).toContain("CORREGIDO");
  });

  it("renderiza un MP4 real 9:16 1080×1920 con audio, seguimiento de rostro y SRT", async () => {
    const r = await c.req(`/api/clips/${clipId}/render`, { method: "POST", json: { resolution: 1080, quality: "high", fps: "source", subtitles: "both" } });
    expect(r.status).toBe(202);
    expect((await c.req(`/api/clips/${clipId}/render`, { method: "POST", json: { resolution: 1080, quality: "high", fps: "source", subtitles: "both" } })).status).toBe(409);
    const d = await waitFor(() => c.req(`/api/clips/${clipId}`).then((x) => x.body), (b) => ["ready", "failed"].includes(b.clip.status));
    expect(d.lastJob.error).toBeNull();
    expect(d.clip.status).toBe("ready");
    expect(d.clip.renderInfo).toMatchObject({ width: 1080, height: 1920, reframe: "track", subtitles: "both" });

    const res = await fetch(`${BASE}/api/media/clips/${clipId}/video.mp4?download=1`, { headers: { cookie: c.cookie } });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toMatch(/attachment; filename=".*\.mp4"/);
    const info = probe(Buffer.from(await res.arrayBuffer()));
    const v = info.streams.find((s: any) => s.codec_type === "video");
    const a = info.streams.find((s: any) => s.codec_type === "audio");
    expect([v.width, v.height]).toEqual([1080, 1920]);
    expect(a.codec_name).toBe("aac");
    expect(Number(info.format.duration)).toBeGreaterThan(16);
    expect(Number(info.format.duration)).toBeLessThan(16.6);

    const srt = await c.req(`/api/media/clips/${clipId}/subtitles.srt`);
    expect(srt.status).toBe(200);
    expect(srt.body).toMatch(/00:00:0\d,\d{3} --> /);
    expect(srt.body).toContain("CORREGIDO");
  });

  it("re-genera con otra relación de aspecto (1:1, 720p, 30 FPS, sin subtítulos)", async () => {
    const g = (await c.req(`/api/clips/${clipId}`)).body;
    await c.req(`/api/clips/${clipId}`, { method: "PATCH", json: { edit: { ...g.clip.edit, aspectRatio: "1:1", reframe: "manual", manualFocus: { x: 0.3, y: 0.5 } } } });
    await c.req(`/api/clips/${clipId}/render`, { method: "POST", json: { resolution: 720, quality: "medium", fps: 30, subtitles: "none" } });
    const d = await waitFor(() => c.req(`/api/clips/${clipId}`).then((x) => x.body), (b) => b.lastJob.status === "completed" || b.lastJob.status === "failed");
    expect(d.lastJob.error).toBeNull();
    expect(d.clip.renderInfo).toMatchObject({ width: 720, height: 720, reframe: "manual", subtitles: "none" });
    // 30 FPS pedidos sobre una fuente de 25 FPS: no se inventan fotogramas y se avisa
    expect(d.clip.renderInfo.fps).toBe(25);
    expect(d.clip.renderInfo.warnings.join(" ")).toMatch(/25 FPS/);
    expect((await c.req(`/api/media/clips/${clipId}/subtitles.srt`)).status).toBe(404);
  });

  it("exporta varios clips en un ZIP real", async () => {
    const second = (await c.req(`/api/projects/${projectId}/clips`, { method: "POST", json: { startSec: 24.5, endSec: 44 } })).body.clip.id;
    const r = await c.req(`/api/projects/${projectId}/render`, { method: "POST", json: { clipIds: [second], exportOpts: { resolution: 720, quality: "low", fps: "source", subtitles: "burned" } } });
    expect(r.body.queued).toEqual([second]);
    await waitFor(() => c.req(`/api/clips/${second}`).then((x) => x.body), (b) => b.clip.status === "ready" || b.clip.status === "failed");
    const zip = await fetch(`${BASE}/api/projects/${projectId}/export`, { headers: { cookie: c.cookie } });
    expect(zip.status).toBe(200);
    expect(zip.headers.get("content-type")).toBe("application/zip");
    const buf = Buffer.from(await zip.arrayBuffer());
    expect(buf.subarray(0, 2).toString()).toBe("PK");
    const names = buf.toString("latin1").match(/\d{2}-[\w-]+\.mp4/g) ?? [];
    expect(new Set(names).size).toBe(2);
  });

  it("persistencia: al volver a abrir el proyecto siguen los clips y sus archivos", async () => {
    const fresh = new Client();
    fresh.cookie = c.cookie;
    const d = (await fresh.req(`/api/projects/${projectId}`)).body;
    expect(d.clips.filter((x: any) => x.status === "ready")).toHaveLength(2);
    const page = await fresh.req(`/projects/${projectId}/clips/${clipId}`);
    expect(page.status).toBe(200);
    expect(page.body).toContain("Los primeros tres segundos");
  });

  it("elimina un clip y sus archivos", async () => {
    expect((await c.req(`/api/clips/${clipId}`, { method: "DELETE" })).status).toBe(200);
    expect((await c.req(`/api/media/clips/${clipId}/video.mp4`)).status).toBe(404);
  });
});
