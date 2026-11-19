import { spawn } from "node:child_process";
import path from "node:path";
import { env } from "../../env";
import type { TranscriptSegment, TranscriptWord } from "../../db/schema";
import type { TranscribeInput, TranscriptionResult } from "./types";

type Out = { language: string; segments: { s: number; e: number; text: string; words: { w: string; s: number; e: number }[] }[] };

/** Whisper local (sherpa-onnx) ejecutado como proceso Python. */
export function transcribeLocal(input: TranscribeInput): Promise<TranscriptionResult> {
  const script = path.join(process.cwd(), "worker", "py", "transcribe_local.py");
  const modelDir = path.resolve(env.LOCAL_WHISPER_MODEL_DIR);
  return new Promise((resolve, reject) => {
    const p = spawn(env.PYTHON_PATH, ["-I", script, input.wav16k, modelDir, path.resolve(env.LOCAL_VAD_MODEL), input.language || "auto", String(env.LOCAL_WHISPER_THREADS)], {
      signal: input.signal,
    });
    let out = "";
    let err = "";
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => {
      const s = String(d);
      for (const m of s.matchAll(/PROGRESS (\d+)/g)) input.onProgress?.(Number(m[1]));
      err += s.replace(/PROGRESS \d+\n?/g, "");
    });
    p.on("error", (e) => reject(new Error(`No se pudo ejecutar Python (${env.PYTHON_PATH}): ${e.message}`)));
    p.on("close", (code) => {
      if (code !== 0) return reject(new Error(`La transcripción local falló: ${err.trim().split("\n").slice(-3).join(" | ") || `código ${code}`}`));
      try {
        const data = JSON.parse(out) as Out;
        const segments: TranscriptSegment[] = data.segments.map((s, i) => ({ id: i, s: s.s, e: s.e, text: s.text }));
        const words: TranscriptWord[] = data.segments.flatMap((s) => s.words.map((w) => ({ w: w.w, s: w.s, e: w.e })));
        resolve({
          provider: "local",
          model: path.basename(modelDir),
          language: data.language === "auto" ? null : data.language,
          text: segments.map((s) => s.text).join(" "),
          segments,
          words,
          estimatedWordTimes: true,
        });
      } catch {
        reject(new Error("La transcripción local devolvió una salida no válida."));
      }
    });
  });
}
