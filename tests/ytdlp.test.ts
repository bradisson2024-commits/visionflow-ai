/**
 * yt-dlp: descarga real con su extractor genérico desde un servidor HTTP local
 * (YouTube no es accesible en el entorno de pruebas) y traducción de errores.
 */
import http from "node:http";
import { createReadStream, mkdtempSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { explainYtdlpError, platformDownload, platformInfo } from "@/server/media/ytdlp";

const FILE = path.join(__dirname, "fixtures", "clip.mov");
let server: http.Server;
let base = "";
beforeAll(async () => {
  server = http.createServer((req, res) => {
    const size = statSync(FILE).size;
    res.writeHead(200, { "content-type": "video/mp4", "content-length": String(size) });
    if (req.method === "HEAD") return void res.end();
    createReadStream(FILE).pipe(res);
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
afterAll(() => server.close());

describe("yt-dlp", () => {
  it("lee la información y descarga el archivo con progreso", async () => {
    const info = await platformInfo(`${base}/mi-video.mp4`);
    expect(info.title).toBeTruthy();
    const dir = mkdtempSync(path.join(os.tmpdir(), "cf-ytdlp-test-"));
    const progress: number[] = [];
    const file = await platformDownload(`${base}/mi-video.mp4`, dir, { maxBytes: 100 * 1024 * 1024, onProgress: (d) => progress.push(d) });
    expect(statSync(file).size).toBe(statSync(FILE).size);
    expect(progress.length).toBeGreaterThan(0);
  });

  it("respeta el tamaño máximo", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "cf-ytdlp-test-"));
    await expect(platformDownload(`${base}/grande.mp4`, dir, { maxBytes: 1000 })).rejects.toThrow();
  });

  it("traduce los errores habituales de YouTube", () => {
    expect(explainYtdlpError("ERROR: [youtube] abc: Sign in to confirm you’re not a bot")).toMatch(/bloqueó la descarga/);
    expect(explainYtdlpError("ERROR: [youtube] abc: Private video")).toMatch(/privado/);
    expect(explainYtdlpError("ERROR: [youtube] abc: Video unavailable")).toMatch(/no está disponible/);
    expect(explainYtdlpError("ERROR: Unable to download API page: ('Unable to connect to proxy', OSError('Tunnel connection failed: 403'))")).toMatch(/no pudo conectarse/);
  });
});
