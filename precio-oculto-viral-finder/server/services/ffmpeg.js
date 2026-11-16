// FFmpeg / FFprobe del sistema: motor real de montaje y verificación.
import { spawn } from 'node:child_process';
import { getSetting } from '../core/settings.js';

function exec(bin, args, { onLine, binary = false, timeout = 4 * 3600e3 } = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(bin, args, { windowsHide: true });
    const out = [];
    let err = '';
    const t = setTimeout(() => p.kill('SIGKILL'), timeout);
    p.stdout.on('data', (d) => out.push(d));
    p.stderr.on('data', (d) => { const s = String(d); err += s; if (err.length > 4e6) err = err.slice(-2e6); onLine?.(s); });
    p.on('error', (e) => { clearTimeout(t); reject(new Error(e.code === 'ENOENT' ? `No se encuentra «${bin}». Instala FFmpeg o indica su ruta en Configuración.` : e.message)); });
    p.on('close', (code) => {
      clearTimeout(t);
      const stdout = binary ? Buffer.concat(out) : Buffer.concat(out).toString('utf8');
      if (code === 0) resolve({ stdout, stderr: err });
      else reject(Object.assign(new Error(`${bin}: ${err.trim().split('\n').slice(-4).join(' | ')}`), { stderr: err }));
    });
  });
}

export const ffmpeg = (args, o) => exec(getSetting('FFMPEG_PATH'), ['-hide_banner', '-nostdin', '-y', ...args], o);
export const ffmpegRaw = (args, o) => exec(getSetting('FFMPEG_PATH'), ['-hide_banner', '-nostdin', ...args], o);
export const ffprobe = (args) => exec(getSetting('FFPROBE_PATH'), args);

export async function probe(file) {
  const { stdout } = await ffprobe(['-v', 'error', '-show_format', '-show_streams', '-of', 'json', file]);
  return JSON.parse(stdout);
}

export async function duration(file) {
  const d = Number((await probe(file)).format?.duration);
  if (!Number.isFinite(d)) throw new Error(`No se pudo medir la duración de ${file}`);
  return d;
}

export async function version() {
  try { return (await exec(getSetting('FFMPEG_PATH'), ['-version'], { timeout: 15000 })).stdout.split('\n')[0]; } catch { return null; }
}

/** Píxeles en gris de un fotograma reducido (comparaciones de imagen). */
export async function grayPixels(file, { at = null, w = 24, h = 14 } = {}) {
  const args = [...(at != null ? ['-ss', at.toFixed(3)] : []), '-i', file, '-frames:v', '1', '-vf', `scale=${w}:${h}:flags=area,format=gray`, '-f', 'rawvideo', '-v', 'error', '-'];
  return (await ffmpegRaw(args, { binary: true, timeout: 60000 })).stdout;
}
