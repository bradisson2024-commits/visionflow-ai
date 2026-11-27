// Utilidades FFmpeg/FFprobe.
import { spawn } from 'node:child_process';

export const FFMPEG = process.env.FFMPEG_PATH || 'ffmpeg';
export const FFPROBE = process.env.FFPROBE_PATH || 'ffprobe';

export function runFfmpeg(args, { onProgress, signal } = {}) {
  return new Promise((resolve, reject) => {
    const full = ['-hide_banner', '-loglevel', 'error', '-nostdin', ...(onProgress ? ['-progress', 'pipe:1', '-nostats'] : []), ...args];
    const p = spawn(FFMPEG, full, { stdio: ['ignore', 'pipe', 'pipe'] });
    let err = '';
    let buf = '';
    p.stderr.on('data', d => { err += d; if (err.length > 20000) err = err.slice(-20000); });
    p.stdout.on('data', d => {
      if (!onProgress) return;
      buf += d;
      const lines = buf.split('\n');
      buf = lines.pop();
      for (const l of lines) {
        const m = l.match(/^out_time_(?:us|ms)=(\d+)/);
        if (m) onProgress(Number(m[1]) / 1e6);
      }
    });
    const onAbort = () => p.kill('SIGKILL');
    signal?.addEventListener('abort', onAbort, { once: true });
    p.on('error', e => reject(new Error('No se pudo ejecutar FFmpeg: ' + e.message)));
    p.on('close', code => {
      signal?.removeEventListener('abort', onAbort);
      if (signal?.aborted) return reject(signal.reason || new Error('Cancelado'));
      if (code === 0) resolve();
      else reject(new Error(`FFmpeg falló (código ${code}): ${err.trim().split('\n').slice(-6).join(' | ')}`));
    });
  });
}

export function probeDuration(file) {
  return new Promise((resolve, reject) => {
    const p = spawn(FFPROBE, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', file]);
    let out = '', err = '';
    p.stdout.on('data', d => (out += d));
    p.stderr.on('data', d => (err += d));
    p.on('error', reject);
    p.on('close', code => {
      const v = parseFloat(out);
      if (code === 0 && Number.isFinite(v)) resolve(v);
      else reject(new Error('No se pudo leer la duración: ' + err.trim()));
    });
  });
}

export function probeStreams(file) {
  return new Promise((resolve, reject) => {
    const p = spawn(FFPROBE, ['-v', 'error', '-show_entries', 'stream=codec_type,codec_name,width,height:format=duration', '-of', 'json', file]);
    let out = '';
    p.stdout.on('data', d => (out += d));
    p.on('error', reject);
    p.on('close', code => (code === 0 ? resolve(JSON.parse(out)) : reject(new Error('ffprobe falló'))));
  });
}
