/** Envoltorios de FFprobe/FFmpeg ejecutados como procesos hijos. */
import { spawn } from "node:child_process";
import { env } from "../env";

export type RunResult = { stdout: string; stderr: string };

export function run(bin: string, args: string[], opts: { signal?: AbortSignal; onStderr?: (line: string) => void } = {}): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const p = spawn(bin, args, { signal: opts.signal });
    let stdout = "";
    let stderr = "";
    p.stdout.on("data", (d) => (stdout += d));
    p.stderr.on("data", (d) => {
      const s = String(d);
      stderr += s;
      if (stderr.length > 200_000) stderr = stderr.slice(-100_000);
      opts.onStderr?.(s);
    });
    p.on("error", reject);
    p.on("close", (code) =>
      code === 0 ? resolve({ stdout, stderr }) : reject(new Error(`${bin} terminó con código ${code}: ${stderr.trim().split("\n").slice(-3).join(" | ")}`)),
    );
  });
}

export type ProbeInfo = {
  durationSec: number;
  width: number;
  height: number;
  fps: number | null;
  videoCodec: string;
  audioCodec: string | null;
  formatName: string;
  rotation: number;
};

/** Lee los metadatos reales del archivo. Lanza un error si no es un video válido. */
export async function probe(file: string): Promise<ProbeInfo> {
  let out: string;
  try {
    ({ stdout: out } = await run(env.FFPROBE_PATH, ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", file]));
  } catch {
    throw new Error("El archivo no es un video legible (FFprobe no pudo abrirlo).");
  }
  const data = JSON.parse(out) as {
    format?: { duration?: string; format_name?: string };
    streams?: Array<{ codec_type: string; codec_name: string; width?: number; height?: number; avg_frame_rate?: string; duration?: string; side_data_list?: Array<{ rotation?: number }>; tags?: { rotate?: string } }>;
  };
  const v = data.streams?.find((s) => s.codec_type === "video" && s.width && s.height);
  if (!v) throw new Error("El archivo no contiene una pista de video.");
  const a = data.streams?.find((s) => s.codec_type === "audio");
  const duration = Number(data.format?.duration ?? v.duration ?? 0);
  if (!Number.isFinite(duration) || duration <= 0) throw new Error("No se pudo determinar la duración del video.");
  const [n, d] = (v.avg_frame_rate ?? "0/0").split("/").map(Number);
  const rotation = Math.abs(Number(v.side_data_list?.find((x) => x.rotation != null)?.rotation ?? v.tags?.rotate ?? 0)) % 360;
  const swap = rotation === 90 || rotation === 270;
  return {
    durationSec: duration,
    width: swap ? v.height! : v.width!,
    height: swap ? v.width! : v.height!,
    fps: d ? Math.round((n / d) * 100) / 100 : null,
    videoCodec: v.codec_name,
    audioCodec: a?.codec_name ?? null,
    formatName: data.format?.format_name ?? "",
    rotation,
  };
}

/** Extrae un fotograma representativo como JPEG (ancho máx. 640 px). */
export async function extractThumbnail(file: string, atSec: number, outFile: string) {
  await run(env.FFMPEG_PATH, [
    "-y", "-v", "error", "-ss", String(Math.max(0, atSec)), "-i", file,
    "-frames:v", "1", "-vf", "scale='min(640,iw)':-2", "-q:v", "4", outFile,
  ]);
}
