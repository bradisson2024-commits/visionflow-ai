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

describe("yt-dlp: video y audio separados (como en YouTube)", () => {
  it("une el video y el audio con FFmpeg y no pasa una ruta de FFmpeg inválida", async () => {
    const { writeFileSync, chmodSync, readFileSync, existsSync } = await import("node:fs");
    const { execFileSync } = await import("node:child_process");
    const dir = mkdtempSync(path.join(os.tmpdir(), "cf-fake-ytdlp-"));
    const src = path.join(__dirname, "fixtures", "clip.mov");
    // Prepara una pista de sólo video y otra de sólo audio
    execFileSync("ffmpeg", ["-v", "error", "-y", "-i", src, "-an", "-c:v", "copy", path.join(dir, "v.mp4")]);
    execFileSync("ffmpeg", ["-v", "error", "-y", "-i", src, "-vn", "-c:a", "copy", path.join(dir, "a.m4a")]);
    const fake = path.join(dir, "fake-yt-dlp.sh");
    writeFileSync(
      fake,
      `#!/usr/bin/env bash
echo "$@" > "${dir}/args.txt"
out=""; prev=""
for a in "$@"; do [ "$prev" = "-o" ] && out="$a"; prev="$a"; done
d=$(dirname "$out")
cp "${dir}/v.mp4" "$d/source.f137.mp4"
cp "${dir}/a.m4a" "$d/source.f140.m4a"
echo "CFPROG 100 100 NA"
`,
    );
    chmodSync(fake, 0o755);
    process.env.YTDLP_PATH = fake;
    const { vi } = await import("vitest");
    vi.resetModules();
    const mod = await import("@/server/media/ytdlp");
    const outDir = mkdtempSync(path.join(os.tmpdir(), "cf-ytdlp-out-"));
    const file = await mod.platformDownload("https://www.youtube.com/watch?v=x", outDir, { maxBytes: 1e9 });
    expect(path.basename(file)).toBe("source.mp4");
    const probe = JSON.parse(execFileSync("ffprobe", ["-v", "error", "-print_format", "json", "-show_streams", file]).toString());
    expect(probe.streams.map((s: { codec_type: string }) => s.codec_type).sort()).toEqual(["audio", "video"]);
    expect(existsSync(path.join(outDir, "source.f137.mp4"))).toBe(false);
    expect(readFileSync(path.join(dir, "args.txt"), "utf8")).not.toContain("--ffmpeg-location");
    delete process.env.YTDLP_PATH;
  });
});
