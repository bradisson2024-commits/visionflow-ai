/**
 * Renderizado real de un clip con FFmpeg:
 * corte preciso → reencuadre (seguimiento de rostro / dividido / manual / centro)
 * → escala a la resolución de salida → FPS → subtítulos ASS grabados
 * → audio sincronizado con volumen y fundidos cortos para evitar chasquidos.
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { env } from "../env";
import type { Clip, ClipEdit, ExportOptions, RenderInfo, TranscriptWord, Video } from "../db/schema";
import { run, extractThumbnail } from "../media/ffmpeg";
import { ASPECTS, outputSize } from "@/lib/captions";
import { planCrop, piecewiseExpr, type CropPlan, type Detections } from "./reframe";
import { buildAss, buildSrt, clipWords } from "./subtitles";

export const DEFAULT_EXPORT: ExportOptions = { resolution: 1080, quality: "high", fps: "source", subtitles: "burned" };
const CRF = { high: 19, medium: 23, low: 27 } as const;
const FONTS_DIR = path.join(process.cwd(), "assets", "fonts");
const YUNET = path.join(process.cwd(), "models", "face_detection_yunet_2023mar.onnx");

function detectFaces(src: string, start: number, end: number, signal?: AbortSignal): Promise<Detections> {
  const script = path.join(process.cwd(), "worker", "py", "face_track.py");
  return new Promise((resolve, reject) => {
    if (!existsSync(YUNET)) return reject(new Error("Modelo de detección de rostros no encontrado (ejecuta scripts/download-models.sh)."));
    const p = spawn(env.PYTHON_PATH, ["-I", script, src, String(start), String(end), "4", YUNET], { signal });
    let out = "";
    let err = "";
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (err += d));
    p.on("error", (e) => reject(new Error(`No se pudo ejecutar Python para detectar rostros: ${e.message}`)));
    p.on("close", (code) => {
      if (code !== 0) return reject(new Error(`La detección de rostros falló: ${err.trim().split("\n").pop()}`));
      try {
        resolve(JSON.parse(out));
      } catch {
        reject(new Error("La detección de rostros devolvió datos no válidos."));
      }
    });
  });
}

function cropFilter(input: string, cw: number, ch: number, keys: { t: number; x: number; y: number }[], ow: number, oh: number, out: string) {
  const x = piecewiseExpr(keys.map((k) => ({ t: k.t, v: k.x })));
  const y = piecewiseExpr(keys.map((k) => ({ t: k.t, v: k.y })));
  return `${input}crop=w=${cw}:h=${ch}:x='${x}':y='${y}',scale=${ow}:${oh}:flags=lanczos,setsar=1${out}`;
}

export type RenderResult = { videoFile: string; srtFile: string | null; thumbFile: string; info: RenderInfo; cleanup: () => Promise<void> };

export async function renderClip(opts: {
  sourceFile: string;
  video: Video;
  clip: Clip;
  edit: ClipEdit;
  words: TranscriptWord[];
  exportOpts: ExportOptions;
  signal?: AbortSignal;
  onProgress?: (pct: number, stage: "reframe" | "encode") => void | Promise<void>;
}): Promise<RenderResult> {
  const { video, clip, edit, exportOpts: ex } = opts;
  const warnings: string[] = [];
  const dur = clip.endSec - clip.startSec;
  if (dur < 1) throw new Error("El clip dura menos de 1 segundo.");
  if (!video.width || !video.height) throw new Error("Faltan las dimensiones del video original.");
  const tmp = await mkdtemp(path.join(os.tmpdir(), "cf-render-"));

  // 1) Tamaño de salida (sin ampliar por encima de la resolución de origen)
  const srcShort = Math.min(video.width, video.height);
  let res = ex.resolution;
  if (res > srcShort) {
    res = srcShort >= 720 ? 720 : (Math.floor(srcShort / 2) * 2 as 720);
    warnings.push(`La fuente tiene ${srcShort}px en su lado corto: se exporta a ${res}px para no ampliar la imagen.`);
  }
  const { w: ow, h: oh } = outputSize(edit.aspectRatio, res as 720 | 1080);
  const aspect = ASPECTS.find((a) => a.id === edit.aspectRatio)!;
  const outAspect = aspect.w / aspect.h;

  // 2) Reencuadre
  let det: Detections | null = null;
  if (edit.reframe === "auto") {
    await opts.onProgress?.(2, "reframe");
    try {
      det = await detectFaces(opts.sourceFile, clip.startSec, clip.endSec, opts.signal);
    } catch (e) {
      warnings.push(`${(e as Error).message} Se usó recorte centrado.`);
    }
  }
  const plan: CropPlan = planCrop(det, outAspect, { mode: edit.reframe, manualFocus: edit.manualFocus, zoom: edit.zoom, allowSplit: edit.reframe === "auto" }, video.width, video.height);
  await opts.onProgress?.(15, "reframe");

  // 3) FPS
  const srcFps = video.fps ?? 30;
  let fps = ex.fps === "source" ? srcFps : ex.fps;
  if (fps > srcFps + 0.5) {
    warnings.push(`El video original tiene ${srcFps} FPS: no se puede exportar a ${fps} FPS sin inventar fotogramas; se usa ${srcFps}.`);
    fps = srcFps;
  }

  // 4) Subtítulos
  const words = clipWords(opts.words, clip.startSec, clip.endSec);
  const burn = (ex.subtitles === "burned" || ex.subtitles === "both") && edit.captions.enabled;
  const assFile = path.join(tmp, "captions.ass");
  if (burn) {
    if (!words.length) warnings.push("No hay palabras transcritas en este tramo: el clip sale sin subtítulos.");
    await writeFile(assFile, buildAss(words, edit.captions, ow, oh), "utf8");
  }
  let srtFile: string | null = null;
  if (ex.subtitles === "srt" || ex.subtitles === "both") {
    srtFile = path.join(tmp, "captions.srt");
    await writeFile(srtFile, buildSrt(words, Math.max(4, edit.captions.wordsPerLine)), "utf8");
  }

  // 5) Grafo de filtros
  const graph: string[] = [];
  if (plan.mode === "split" && plan.split) {
    const half = Math.floor(oh / 2 / 2) * 2;
    graph.push("[0:v]split=2[s0][s1]");
    graph.push(cropFilter("[s0]", plan.split[0].cropW, plan.split[0].cropH, plan.split[0].keys, ow, half, "[top]"));
    graph.push(cropFilter("[s1]", plan.split[1].cropW, plan.split[1].cropH, plan.split[1].keys, ow, oh - half, "[bot]"));
    graph.push("[top][bot]vstack=inputs=2[vc]");
  } else {
    graph.push(cropFilter("[0:v]", plan.cropW, plan.cropH, plan.keys, ow, oh, "[vc]"));
  }
  const post = [`fps=${fps}`, "format=yuv420p"];
  if (burn) post.push(`ass=filename='${assFile.replace(/'/g, "")}':fontsdir='${FONTS_DIR.replace(/'/g, "")}'`);
  graph.push(`[vc]${post.join(",")}[vout]`);
  const hasAudio = !!video.audioCodec;
  if (hasAudio) {
    const vol = Math.max(0, Math.min(3, edit.volume ?? 1));
    const fadeOut = Math.max(0, dur - 0.12).toFixed(3);
    graph.push(`[0:a]volume=${vol},afade=t=in:st=0:d=0.06,afade=t=out:st=${fadeOut}:d=0.12,aresample=async=1[aout]`);
  }
  const graphFile = path.join(tmp, "graph.txt");
  await writeFile(graphFile, graph.join(";\n"), "utf8");

  // 6) Codificación (búsqueda exacta: -ss antes de -i con recodificación)
  const outFile = path.join(tmp, "clip.mp4");
  const args = [
    "-y", "-v", "error", "-stats",
    "-ss", clip.startSec.toFixed(3), "-i", opts.sourceFile, "-t", dur.toFixed(3),
    "-filter_complex_script", graphFile,
    "-map", "[vout]", ...(hasAudio ? ["-map", "[aout]"] : []),
    "-c:v", "libx264", "-preset", "veryfast", "-crf", String(CRF[ex.quality]), "-profile:v", "high",
    ...(hasAudio ? ["-c:a", "aac", "-b:a", "160k", "-ar", "48000"] : []),
    "-movflags", "+faststart", "-shortest", outFile,
  ];
  await run(env.FFMPEG_PATH, args, {
    signal: opts.signal,
    onStderr: (s) => {
      const m = /time=(\d+):(\d+):(\d+\.\d+)/.exec(s);
      if (m) opts.onProgress?.(15 + Math.min(1, (+m[1] * 3600 + +m[2] * 60 + +m[3]) / dur) * 80, "encode");
    },
  });

  const thumbFile = path.join(tmp, "thumb.jpg");
  await extractThumbnail(outFile, Math.min(1, dur / 2), thumbFile);
  const { size } = await stat(outFile);
  return {
    videoFile: outFile,
    srtFile,
    thumbFile,
    info: {
      width: ow,
      height: oh,
      fps,
      durationSec: dur,
      sizeBytes: size,
      reframe: plan.mode,
      reframeNote: plan.note,
      facesFound: plan.facesFound,
      subtitles: burn ? (srtFile ? "both" : "burned") : srtFile ? "srt" : "none",
      warnings,
    },
    cleanup: () => rm(tmp, { recursive: true, force: true }),
  };
}
