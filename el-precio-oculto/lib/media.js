// Ejecución de FFmpeg/FFprobe (motor real de edición).
import { spawn } from 'node:child_process';
import { config } from './config.js';

export function run(bin, args, { input, timeoutMs = 3 * 3600 * 1000, onStderr } = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(bin, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '', err = '';
    const t = setTimeout(() => { p.kill('SIGKILL'); reject(new Error(`${bin} superó el tiempo máximo`)); }, timeoutMs);
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { err += d; if (err.length > 2e6) err = err.slice(-1e6); onStderr?.(String(d)); });
    p.on('error', (e) => { clearTimeout(t); reject(new Error(e.code === 'ENOENT' ? `No se encontró ${bin}. Instala FFmpeg y añádelo al PATH (o define FFMPEG_PATH/FFPROBE_PATH).` : e.message)); });
    p.on('close', (code) => {
      clearTimeout(t);
      if (code === 0) resolve({ out, err });
      else reject(Object.assign(new Error(`${bin} terminó con código ${code}: ${err.split('\n').filter(Boolean).slice(-6).join(' | ')}`), { stderr: err }));
    });
    if (input) p.stdin.end(input); else p.stdin.end();
  });
}

export const ffmpeg = (args, o) => run(config.ffmpeg, ['-hide_banner', '-y', ...args], o);

export async function probe(file) {
  const { out } = await run(config.ffprobe, ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', file]);
  return JSON.parse(out);
}

export async function durationOf(file) {
  const j = await probe(file);
  const d = Number(j.format?.duration);
  if (!Number.isFinite(d)) throw new Error(`No se pudo medir la duración de ${file}`);
  return d;
}

export async function ffmpegAvailable() {
  try { const { out } = await run(config.ffmpeg, ['-version'], { timeoutMs: 15000 }); return out.split('\n')[0]; } catch { return null; }
}

/** Escapa una ruta para usarla dentro de un filtro de FFmpeg (drawtext fontfile=…, etc.) */
export const filterPath = (p) => p.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'");

/** Ejecuta FFmpeg y devuelve stdout binario (para leer píxeles). */
export function ffmpegBuffer(args, timeoutMs = 60000) {
  return new Promise((resolve, reject) => {
    const p = spawn(config.ffmpeg, ['-hide_banner', '-v', 'error', ...args]);
    const chunks = [];
    let err = '';
    const t = setTimeout(() => p.kill('SIGKILL'), timeoutMs);
    p.stdout.on('data', (d) => chunks.push(d));
    p.stderr.on('data', (d) => { err += d; });
    p.on('error', (e) => { clearTimeout(t); reject(e); });
    p.on('close', (c) => { clearTimeout(t); c === 0 ? resolve(Buffer.concat(chunks)) : reject(new Error(`ffmpeg: ${err.slice(-300)}`)); });
  });
}

/** Imagen reducida a gris w×h (bytes), para comparar fotogramas con las imágenes de origen. */
export const grayThumb = (file, w = 32, h = 18, extra = []) =>
  ffmpegBuffer([...extra, '-i', file, '-frames:v', '1', '-vf', `scale=${w}:${h}:flags=area,format=gray`, '-f', 'rawvideo', '-']);
