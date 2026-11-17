import { spawn } from 'node:child_process';
import { config } from '../config.js';

function run(bin, args, { binary = false, onStderr, timeout = 6 * 3600e3 } = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(bin, args, { windowsHide: true });
    const out = []; let err = '';
    const t = setTimeout(() => p.kill('SIGKILL'), timeout);
    p.stdout.on('data', (d) => out.push(d));
    p.stderr.on('data', (d) => { err += d; if (err.length > 4e6) err = err.slice(-1e6); onStderr?.(String(d)); });
    p.on('error', (e) => { clearTimeout(t); reject(new Error(e.code === 'ENOENT' ? `No se encontró ${bin}: instala FFmpeg o configura FFMPEG_PATH.` : e.message)); });
    p.on('close', (c) => { clearTimeout(t); const o = binary ? Buffer.concat(out) : Buffer.concat(out).toString(); c === 0 ? resolve({ out: o, err }) : reject(Object.assign(new Error(`${bin}: ${err.trim().split('\n').slice(-3).join(' | ')}`), { stderr: err })); });
  });
}
export const ffmpeg = (args, o) => run(config.ffmpeg, ['-hide_banner', '-nostdin', '-y', ...args], o);
export const ffmpegRaw = (args, o) => run(config.ffmpeg, ['-hide_banner', '-nostdin', ...args], o);
export async function probe(file) { return JSON.parse((await run(config.ffprobe, ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', file])).out); }
export async function duration(file) { const d = Number((await probe(file)).format?.duration); if (!Number.isFinite(d)) throw new Error('Duración no medible'); return d; }
export async function version() { try { return (await run(config.ffmpeg, ['-version'], { timeout: 10000 })).out.split('\n')[0]; } catch { return null; } }
export async function grayPixels(file, at = null, w = 24, h = 14) {
  return (await ffmpegRaw([...(at != null ? ['-ss', at.toFixed(3)] : []), '-i', file, '-frames:v', '1', '-vf', `scale=${w}:${h}:flags=area,format=gray`, '-f', 'rawvideo', '-v', 'error', '-'], { binary: true, timeout: 60000 })).out;
}
