import path from "node:path";
import { env } from "../env";
import { run } from "./ffmpeg";

/** WAV 16 kHz mono (transcripción local). */
export async function extractWav16k(src: string, out: string, signal?: AbortSignal) {
  await run(env.FFMPEG_PATH, ["-y", "-v", "error", "-i", src, "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", out], { signal });
}

/**
 * MP3 mono 32 kbps en trozos de `chunkSec` (las APIs limitan el tamaño por
 * petición, p. ej. 25 MB en OpenAI). 10 min ≈ 2,4 MB.
 */
export async function extractMp3Chunks(src: string, dir: string, durationSec: number, chunkSec = 600, signal?: AbortSignal) {
  const chunks: { file: string; offsetSec: number; mime: string }[] = [];
  for (let off = 0, i = 0; off < durationSec; off += chunkSec, i++) {
    const file = path.join(dir, `audio-${String(i).padStart(3, "0")}.mp3`);
    await run(env.FFMPEG_PATH, ["-y", "-v", "error", "-ss", String(off), "-t", String(chunkSec), "-i", src, "-vn", "-ac", "1", "-ar", "16000", "-b:a", "32k", file], { signal });
    chunks.push({ file, offsetSec: off, mime: "audio/mpeg" });
  }
  return chunks;
}
