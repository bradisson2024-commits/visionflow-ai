/* eslint-disable @typescript-eslint/no-explicit-any -- respuestas JSON dinámicas en pruebas */
/**
 * Fase 2 — importación real de videos.
 * Requiere: servidor (npm start) y worker (npm run worker) en marcha, ambos con
 * IMPORT_ALLOW_PRIVATE_HOSTS=true para poder descargar desde el servidor local de pruebas.
 */
import { createReadStream, readFileSync, statSync } from "node:fs";
import http from "node:http";
import path from "node:path";
import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BASE, Client, uniqueEmail } from "./helpers";

const FIX = path.join(__dirname, "fixtures");
const CHUNK = 8 * 1024 * 1024;
const sha = (b: Buffer | Uint8Array) => createHash("sha256").update(b).digest("hex");

/** Sube un archivo en partes como lo hace el navegador. */
async function uploadFile(c: Client, projectId: string, file: string, opts: { stopAfterChunks?: number } = {}) {
  const buf = readFileSync(path.join(FIX, file));
  const init = await c.req(`/api/projects/${projectId}/uploads`, {
    method: "POST",
    json: { filename: file, size: buf.length, mimeType: file.endsWith(".mov") ? "video/quicktime" : "video/mp4" },
  });
  if (init.status !== 201) return { init };
  const videoId = init.body.video.id as string;
  let offset = 0;
  let chunks = 0;
  while (offset < buf.length) {
    if (opts.stopAfterChunks !== undefined && chunks >= opts.stopAfterChunks) return { init, videoId, offset };
    const part = buf.subarray(offset, Math.min(offset + CHUNK, buf.length));
    const r = await c.req(`/api/uploads/${videoId}?offset=${offset}`, { method: "PUT", body: part, headers: { "content-type": "application/octet-stream" } });
    expect(r.status).toBe(200);
    offset = r.body.receivedBytes;
    chunks++;
  }
  const done = await c.req(`/api/uploads/${videoId}/complete`, { method: "POST" });
  return { init, videoId, offset, chunks, done };
}

async function waitFor<T>(fn: () => Promise<T>, ok: (v: T) => boolean, ms = 30_000): Promise<T> {
  const end = Date.now() + ms;
  let last: T;
  do {
    last = await fn();
    if (ok(last)) return last;
    await new Promise((r) => setTimeout(r, 400));
  } while (Date.now() < end);
  return last;
}

// Servidor HTTP local que hace de "sitio externo" para importar por enlace.
let server: http.Server;
let ORIGIN = "";
beforeAll(async () => {
  server = http.createServer((req, res) => {
    const u = new URL(req.url!, "http://x");
    if (u.pathname === "/page.html") {
      res.writeHead(200, { "content-type": "text/html" }).end("<html>no soy un video</html>");
      return;
    }
    if (u.pathname === "/redirect") {
      res.writeHead(302, { location: "/files/clip.mov" }).end();
      return;
    }
    const m = /^\/(files|slow)\/(.+)$/.exec(u.pathname);
    if (!m) return void res.writeHead(404).end();
    const file = path.join(FIX, path.basename(m[2]));
    res.writeHead(200, { "content-type": "video/mp4", "content-length": String(statSync(file).size) });
    if (m[1] === "files") return void createReadStream(file).pipe(res);
    // Envío lento: 64 KB cada 150 ms (para probar la cancelación)
    const stream = createReadStream(file, { highWaterMark: 64 * 1024 });
    stream.on("data", (chunk) => {
      stream.pause();
      res.write(chunk);
      setTimeout(() => stream.resume(), 150);
    });
    stream.on("end", () => res.end());
    res.on("close", () => stream.destroy());
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  ORIGIN = `http://127.0.0.1:${(server.address() as any).port}`;
});
afterAll(() => server.close());

describe("Fase 2 — subida de archivos", () => {
  const c = new Client();
  let projectId = "";

  beforeAll(async () => {
    await c.req("/api/auth/register", { method: "POST", json: { name: "Subidas", email: uniqueEmail("up"), password: "contraseña-segura" } });
    projectId = (await c.req("/api/projects", { method: "POST", json: { name: "Subidas" } })).body.project.id;
  });

  it("sube un MP4 1080p de 19 MB en varias partes y lo verifica con FFprobe", async () => {
    const r = await uploadFile(c, projectId, "big-1080p.mp4");
    expect(r.chunks).toBe(3);
    expect(r.done!.status).toBe(200);
    const v = r.done!.body.video;
    expect(v).toMatchObject({ uploadStatus: "uploaded", width: 1920, height: 1080, fps: 30, videoCodec: "h264", audioCodec: "aac" });
    expect(v.durationSec).toBeGreaterThan(29.5);
    expect(v.durationSec).toBeLessThan(30.5);
    const det = await c.req(`/api/projects/${projectId}`);
    expect(det.body.project.status).toBe("uploaded");
    expect(det.body.videos).toHaveLength(1);
  });

  it("el archivo guardado es idéntico byte a byte (descarga del original)", async () => {
    const det = await c.req(`/api/projects/${projectId}`);
    const id = det.body.videos[0].id;
    const res = await fetch(`${BASE}/api/media/videos/${id}/source?download=1`, { headers: { cookie: c.cookie } });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toContain("attachment");
    const got = Buffer.from(await res.arrayBuffer());
    expect(sha(got)).toBe(sha(readFileSync(path.join(FIX, "big-1080p.mp4"))));
  });

  it("sirve rangos de bytes para el reproductor y genera miniatura JPEG", async () => {
    const id = (await c.req(`/api/projects/${projectId}`)).body.videos[0].id;
    const res = await fetch(`${BASE}/api/media/videos/${id}/source`, { headers: { cookie: c.cookie, range: "bytes=100-199" } });
    expect(res.status).toBe(206);
    expect(res.headers.get("content-range")).toMatch(/^bytes 100-199\/\d+$/);
    expect((await res.arrayBuffer()).byteLength).toBe(100);
    const th = await fetch(`${BASE}/api/media/videos/${id}/thumbnail`, { headers: { cookie: c.cookie } });
    const img = Buffer.from(await th.arrayBuffer());
    expect(th.headers.get("content-type")).toBe("image/jpeg");
    expect(img.subarray(0, 3).toString("hex")).toBe("ffd8ff");
  });

  it("otro usuario no puede descargar el video", async () => {
    const other = new Client();
    await other.req("/api/auth/register", { method: "POST", json: { name: "Otro", email: uniqueEmail("o"), password: "contraseña-segura" } });
    const id = (await c.req(`/api/projects/${projectId}`)).body.videos[0].id;
    expect((await other.req(`/api/media/videos/${id}/source`)).status).toBe(404);
    expect((await other.req(`/api/uploads/${id}`, { method: "DELETE" })).status).toBe(404);
  });

  it("acepta MOV y reemplaza el video anterior del proyecto", async () => {
    const r = await uploadFile(c, projectId, "clip.mov");
    expect(r.done!.status).toBe(200);
    expect(r.done!.body.video).toMatchObject({ width: 1280, height: 720, fps: 25 });
    expect((await c.req(`/api/projects/${projectId}`)).body.videos).toHaveLength(1);
  });

  it("detecta video vertical 1080×1920", async () => {
    const p = (await c.req("/api/projects", { method: "POST", json: { name: "Vertical" } })).body.project.id;
    const r = await uploadFile(c, p, "vertical.mp4");
    expect(r.done!.body.video).toMatchObject({ width: 1080, height: 1920 });
  });

  it("acepta un video sin audio pero avisa de que no se podrá transcribir", async () => {
    const p = (await c.req("/api/projects", { method: "POST", json: { name: "Mudo" } })).body.project.id;
    const r = await uploadFile(c, p, "no-audio.mp4");
    expect(r.done!.status).toBe(200);
    expect(r.done!.body.video.audioCodec).toBeNull();
    expect(r.done!.body.video.error).toMatch(/sin pista de audio|no tiene pista de audio/i);
  });

  it("rechaza extensiones no compatibles antes de subir", async () => {
    const r = await c.req(`/api/projects/${projectId}/uploads`, { method: "POST", json: { filename: "notas.txt", size: 100 } });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/Formato no compatible/);
  });

  it("rechaza un archivo .mp4 que no es un video real (verificación con FFprobe)", async () => {
    const p = (await c.req("/api/projects", { method: "POST", json: { name: "Falso" } })).body.project.id;
    const r = await uploadFile(c, p, "fake.mp4");
    expect(r.done!.status).toBe(422);
    expect(r.done!.body.error).toMatch(/no es un video legible/);
    const det = await c.req(`/api/projects/${p}`);
    expect(det.body.project.status).toBe("error");
    expect(det.body.videos[0].uploadStatus).toBe("failed");
  });

  it("rechaza partes con desfase e informa del offset esperado (reanudación)", async () => {
    const p = (await c.req("/api/projects", { method: "POST", json: { name: "Reanudar" } })).body.project.id;
    const r = await uploadFile(c, p, "big-1080p.mp4", { stopAfterChunks: 1 });
    const bad = await c.req(`/api/uploads/${r.videoId}?offset=0`, { method: "PUT", body: Buffer.alloc(10), headers: { "content-type": "application/octet-stream" } });
    expect(bad.status).toBe(409);
    expect(bad.body.details.expectedOffset).toBe(CHUNK);
    // Reanuda desde donde quedó y termina
    const buf = readFileSync(path.join(FIX, "big-1080p.mp4"));
    let offset = (await c.req(`/api/uploads/${r.videoId}`)).body.video.receivedBytes;
    expect(offset).toBe(CHUNK);
    while (offset < buf.length) {
      const res = await c.req(`/api/uploads/${r.videoId}?offset=${offset}`, { method: "PUT", body: buf.subarray(offset, offset + CHUNK), headers: { "content-type": "application/octet-stream" } });
      offset = res.body.receivedBytes;
    }
    expect((await c.req(`/api/uploads/${r.videoId}/complete`, { method: "POST" })).status).toBe(200);
  });

  it("no permite completar una subida incompleta", async () => {
    const p = (await c.req("/api/projects", { method: "POST", json: { name: "Incompleta" } })).body.project.id;
    const r = await uploadFile(c, p, "big-1080p.mp4", { stopAfterChunks: 1 });
    const done = await c.req(`/api/uploads/${r.videoId}/complete`, { method: "POST" });
    expect(done.status).toBe(409);
  });

  it("cancela una subida a medias: borra el video y el proyecto vuelve a 'sin video'", async () => {
    const p = (await c.req("/api/projects", { method: "POST", json: { name: "Cancelar" } })).body.project.id;
    const r = await uploadFile(c, p, "big-1080p.mp4", { stopAfterChunks: 1 });
    expect((await c.req(`/api/uploads/${r.videoId}`, { method: "DELETE" })).status).toBe(200);
    const det = await c.req(`/api/projects/${p}`);
    expect(det.body.videos).toHaveLength(0);
    expect(det.body.project.status).toBe("draft");
  });

  it("al eliminar el proyecto se borran sus archivos", async () => {
    const p = (await c.req("/api/projects", { method: "POST", json: { name: "Borrar" } })).body.project.id;
    const r = await uploadFile(c, p, "clip.mov");
    const key = r.done!.body.video.storageKey as string;
    const dir = path.join(__dirname, "..", "storage");
    expect(statSync(path.join(dir, key)).size).toBeGreaterThan(0);
    await c.req(`/api/projects/${p}`, { method: "DELETE" });
    expect(() => statSync(path.join(dir, `projects/${p}`))).toThrow();
  });
});

describe("Fase 2 — importación por enlace (worker en segundo plano)", () => {
  const c = new Client();
  beforeAll(async () => {
    await c.req("/api/auth/register", { method: "POST", json: { name: "Enlaces", email: uniqueEmail("url"), password: "contraseña-segura" } });
  });
  const newProject = async (name: string) => (await c.req("/api/projects", { method: "POST", json: { name } })).body.project.id as string;
  const detail = (p: string) => c.req(`/api/projects/${p}`).then((r) => r.body);

  it("rechaza enlaces de YouTube/TikTok/Instagram explicando la alternativa", async () => {
    const p = await newProject("Plataformas");
    for (const url of ["https://www.youtube.com/watch?v=abc", "https://youtu.be/abc", "https://www.tiktok.com/@a/video/1", "https://www.instagram.com/reel/x/"]) {
      const r = await c.req(`/api/projects/${p}/imports`, { method: "POST", json: { url } });
      expect(r.status).toBe(422);
      expect(r.body.error).toMatch(/términos de uso/);
    }
  });

  it("rechaza URLs no válidas o con esquema no permitido", async () => {
    const p = await newProject("Malas");
    expect((await c.req(`/api/projects/${p}/imports`, { method: "POST", json: { url: "no es url" } })).status).toBe(400);
    expect((await c.req(`/api/projects/${p}/imports`, { method: "POST", json: { url: "file:///etc/passwd" } })).status).toBe(400);
  });

  it("descarga un video por enlace (siguiendo una redirección) y lo verifica", async () => {
    const p = await newProject("Enlace OK");
    const r = await c.req(`/api/projects/${p}/imports`, { method: "POST", json: { url: `${ORIGIN}/redirect` } });
    expect(r.status).toBe(202);
    const d = await waitFor(() => detail(p), (b) => b.videos[0]?.uploadStatus !== "uploading");
    expect(d.videos[0]).toMatchObject({ uploadStatus: "uploaded", source: "url", width: 1280, height: 720, originalFilename: "clip.mov" });
    expect(d.jobs[0]).toMatchObject({ type: "import_url", status: "completed", stage: "completed", progress: 100 });
    expect(d.project.status).toBe("uploaded");
  });

  it("falla con un mensaje claro si el enlace abre una página web, y permite reintentar", async () => {
    const p = await newProject("Página");
    await c.req(`/api/projects/${p}/imports`, { method: "POST", json: { url: `${ORIGIN}/page.html` } });
    const d = await waitFor(() => detail(p), (b) => b.jobs[0]?.status === "failed");
    expect(d.jobs[0].error).toMatch(/página web, no un archivo de video/);
    expect(d.videos[0].uploadStatus).toBe("failed");
    expect(d.project.status).toBe("error");
    const retry = await c.req(`/api/jobs/${d.jobs[0].id}/retry`, { method: "POST" });
    expect(retry.status).toBe(200);
    const again = await waitFor(() => detail(p), (b) => b.jobs[0]?.status === "failed" && b.jobs[0]?.attempts >= 2);
    expect(again.jobs[0].attempts).toBe(2);
  });

  it("falla si el archivo descargado no es un video", async () => {
    const p = await newProject("Falso por enlace");
    await c.req(`/api/projects/${p}/imports`, { method: "POST", json: { url: `${ORIGIN}/files/fake.mp4` } });
    const d = await waitFor(() => detail(p), (b) => b.jobs[0]?.status === "failed");
    expect(d.jobs[0].error).toMatch(/no es un video legible/);
  });

  it("muestra progreso real y se puede cancelar a mitad de la descarga", async () => {
    const p = await newProject("Cancelar enlace");
    await c.req(`/api/projects/${p}/imports`, { method: "POST", json: { url: `${ORIGIN}/slow/big-1080p.mp4` } });
    const mid = await waitFor(() => detail(p), (b) => b.jobs[0]?.stage === "downloading" && b.jobs[0]?.progress > 0);
    expect(mid.videos[0].receivedBytes).toBeGreaterThan(0);
    expect(mid.videos[0].receivedBytes).toBeLessThan(mid.videos[0].sizeBytes);
    expect((await c.req(`/api/uploads/${mid.videos[0].id}`, { method: "DELETE" })).status).toBe(200);
    const after = await waitFor(() => detail(p), (b) => b.jobs[0]?.status === "cancelled");
    expect(after.jobs[0].status).toBe("cancelled");
    expect(after.videos).toHaveLength(0);
    expect(after.project.status).toBe("draft");
  });
});
