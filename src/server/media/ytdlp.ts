/**
 * Descarga desde plataformas de video (YouTube y otras) con yt-dlp.
 * https://github.com/yt-dlp/yt-dlp  —  `pip install yt-dlp`
 *
 * El usuario confirma que tiene derecho a usar el video. Descargar de
 * plataformas puede ir contra sus términos de uso: es decisión del operador
 * activarlo (PLATFORM_IMPORT_ENABLED).
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { readdir, rm } from "node:fs/promises";
import path from "node:path";
import { env } from "../env";
import { run } from "./ffmpeg";

export type PlatformInfo = { id: string; title: string; durationSec: number | null; uploader: string | null; isLive: boolean };

function baseArgs() {
  const a = ["--no-playlist", "--no-warnings", "--ignore-config"];
  if (env.YTDLP_COOKIES_FILE && existsSync(env.YTDLP_COOKIES_FILE)) a.push("--cookies", env.YTDLP_COOKIES_FILE);
  return a;
}

/** Traduce los errores habituales de yt-dlp a mensajes claros. */
export function explainYtdlpError(stderr: string): string {
  const s = stderr.toLowerCase();
  if (s.includes("sign in to confirm") || s.includes("not a bot"))
    return "YouTube bloqueó la descarga desde este servidor («confirma que no eres un bot»). Ejecuta ClipForge en tu propio computador o configura YTDLP_COOKIES_FILE con las cookies de tu cuenta (ver docs/CONFIGURACION.md).";
  if (s.includes("unable to connect to proxy") || s.includes("tunnel connection failed") || s.includes("network is unreachable") || s.includes("timed out") || s.includes("name or service not known") || s.includes("getaddrinfo failed"))
    return "El servidor no pudo conectarse a la plataforma (sin internet o la red del servidor la bloquea). Comprueba la conexión del equipo donde corre ClipForge.";
  if (s.includes("private video")) return "El video es privado: no se puede descargar.";
  if (s.includes("age") && s.includes("restrict")) return "El video tiene restricción de edad: configura YTDLP_COOKIES_FILE con una cuenta que pueda verlo.";
  if (s.includes("members-only") || s.includes("join this channel")) return "El video es sólo para miembros del canal.";
  if (s.includes("video unavailable") || s.includes("not available")) return "El video no está disponible (eliminado, bloqueado en tu región o enlace incorrecto).";
  if (s.includes("is not a valid url") || s.includes("unsupported url")) return "El enlace no es válido o la plataforma no está soportada.";
  const last = stderr.trim().split("\n").pop()?.replace(/;? ?please report this issue.*$/i, "").slice(0, 300);
  if (s.includes("unable to download") || s.includes("http error")) return `No se pudo descargar el video: ${last}`;
  return `yt-dlp falló: ${stderr.trim().split("\n").slice(-2).join(" ") || "error desconocido"}`;
}

function runYtdlp(args: string[], signal?: AbortSignal, onLine?: (line: string) => void): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const p = spawn(env.YTDLP_PATH, args, { signal });
    let stdout = "";
    let stderr = "";
    let buf = "";
    p.stdout.on("data", (d) => {
      const s = String(d);
      stdout += s;
      buf += s;
      const lines = buf.split(/\r|\n/);
      buf = lines.pop() ?? "";
      for (const l of lines) if (l.trim()) onLine?.(l.trim());
    });
    p.stderr.on("data", (d) => (stderr += d));
    p.on("error", (e) =>
      reject((e as NodeJS.ErrnoException).code === "ENOENT" ? new Error("yt-dlp no está instalado en el servidor. Instálalo con: pip install yt-dlp") : e),
    );
    p.on("close", (code) => (code === 0 ? resolve({ stdout, stderr }) : reject(new Error(explainYtdlpError(stderr)))));
  });
}

/** Lee título y duración sin descargar. */
export async function platformInfo(url: string, signal?: AbortSignal): Promise<PlatformInfo> {
  const { stdout } = await runYtdlp([...baseArgs(), "--dump-single-json", "--skip-download", url], signal);
  const j = JSON.parse(stdout) as { id: string; title?: string; duration?: number; uploader?: string; is_live?: boolean; live_status?: string };
  return { id: j.id, title: j.title ?? "video", durationSec: j.duration ?? null, uploader: j.uploader ?? null, isLive: !!j.is_live || j.live_status === "is_live" };
}

/** Descarga el mejor MP4 hasta 1080p (video + audio unidos con FFmpeg). Devuelve la ruta del archivo. */
export async function platformDownload(
  url: string,
  outDir: string,
  opts: { maxBytes: number; signal?: AbortSignal; onProgress?: (downloaded: number, total: number | null) => void },
): Promise<string> {
  const args = [
    ...baseArgs(),
    "-f", "bv*[height<=1080][ext=mp4]+ba[ext=m4a]/b[height<=1080][ext=mp4]/bv*[height<=1080]+ba/b[height<=1080]/b",
    "--merge-output-format", "mp4",
    // Sólo se indica la ubicación si es una ruta real; si no, yt-dlp busca FFmpeg en el PATH.
    ...(path.isAbsolute(env.FFMPEG_PATH) && existsSync(env.FFMPEG_PATH) ? ["--ffmpeg-location", env.FFMPEG_PATH] : []),
    "--max-filesize", String(opts.maxBytes),
    "--newline",
    "--progress-template", "download:CFPROG %(progress.downloaded_bytes)s %(progress.total_bytes)s %(progress.total_bytes_estimate)s",
    "-o", path.join(outDir, "source.%(ext)s"),
    url,
  ];
  await runYtdlp(args, opts.signal, (line) => {
    const m = /^CFPROG (\S+) (\S+) (\S+)/.exec(line);
    if (!m) return;
    const done = Number(m[1]);
    const total = Number(m[2]) || Number(m[3]) || null;
    if (Number.isFinite(done)) opts.onProgress?.(done, total);
  });
  const all = (await readdir(outDir)).filter((f) => f.startsWith("source.") && !f.endsWith(".part") && !f.endsWith(".ytdl"));
  const merged = all.filter((f) => !/\.f[\w-]+\./.test(f));
  if (merged.length) return path.join(outDir, merged.sort((a, b) => (a.endsWith(".mp4") ? -1 : b.endsWith(".mp4") ? 1 : 0))[0]);

  // Video y audio llegaron por separado (p. ej. sin FFmpeg disponible para yt-dlp): se unen aquí.
  const parts = all.filter((f) => /\.f[\w-]+\./.test(f));
  const audio = parts.find((f) => /\.(m4a|webm|opus|mp3|aac)$/.test(f) && !/\.mp4$/.test(f)) ?? null;
  const video = parts.find((f) => f !== audio) ?? null;
  if (video && audio) {
    const out = path.join(outDir, "source.mp4");
    await run(env.FFMPEG_PATH, ["-y", "-v", "error", "-i", path.join(outDir, video), "-i", path.join(outDir, audio), "-map", "0:v:0", "-map", "1:a:0", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", out], { signal: opts.signal });
    await rm(path.join(outDir, video), { force: true });
    await rm(path.join(outDir, audio), { force: true });
    return out;
  }
  if (video) return path.join(outDir, video);
  throw new Error(`yt-dlp terminó pero no se encontró el video descargado${all.length ? ` (archivos: ${all.join(", ")})` : ""}. Puede que supere el tamaño máximo permitido.`);
}
