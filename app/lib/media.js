'use strict';
// Utilidades de medios basadas en FFmpeg/FFprobe del sistema.
const { spawn, execFile } = require('child_process');

const FFMPEG = process.env.YA_FFMPEG || 'ffmpeg';
const FFPROBE = process.env.YA_FFPROBE || 'ffprobe';

function checkTools() {
  return new Promise(resolve => {
    execFile(FFMPEG, ['-version'], (err, out) => {
      if (err) return resolve({ ok: false, error: 'FFmpeg no está instalado o no se encuentra en el PATH' });
      execFile(FFPROBE, ['-version'], (err2) => {
        if (err2) return resolve({ ok: false, error: 'FFprobe no está instalado o no se encuentra en el PATH' });
        resolve({ ok: true, version: String(out).split('\n')[0] });
      });
    });
  });
}

function probe(file) {
  return new Promise((resolve, reject) => {
    execFile(FFPROBE, ['-v', 'error', '-show_entries',
      'format=duration,format_name:stream=index,codec_type,codec_name,width,height,duration',
      '-of', 'json', file], { maxBuffer: 4 * 1024 * 1024 }, (err, out, stderr) => {
      if (err) return reject(new Error((stderr || err.message).toString().trim().split('\n').pop()));
      try {
        const j = JSON.parse(out);
        const streams = j.streams || [];
        const v = streams.find(s => s.codec_type === 'video');
        const a = streams.find(s => s.codec_type === 'audio');
        resolve({
          format: j.format && j.format.format_name,
          duration: j.format && j.format.duration ? parseFloat(j.format.duration) : (a && a.duration ? parseFloat(a.duration) : null),
          video: v ? { codec: v.codec_name, width: v.width, height: v.height } : null,
          audio: a ? { codec: a.codec_name } : null,
        });
      } catch (e) { reject(e); }
    });
  });
}

// Ejecuta ffmpeg leyendo el progreso real (-progress pipe:1). onProgress recibe {frame, outTimeSec}.
function runFfmpeg(args, onProgress) {
  return new Promise((resolve, reject) => {
    const p = spawn(FFMPEG, ['-hide_banner', '-nostdin', '-y', '-progress', 'pipe:1', '-nostats', ...args]);
    let buf = '';
    let errTail = '';
    p.stdout.on('data', d => {
      buf += d.toString();
      const lines = buf.split('\n');
      buf = lines.pop();
      const info = {};
      for (const l of lines) {
        const [k, v] = l.split('=');
        if (k === 'frame') info.frame = parseInt(v, 10);
        if (k === 'out_time_us' || k === 'out_time_ms') { const n = parseInt(v, 10); if (!isNaN(n)) info.outTimeSec = n / 1e6; }
      }
      if (onProgress && (info.frame != null || info.outTimeSec != null)) onProgress(info);
    });
    p.stderr.on('data', d => { errTail = (errTail + d.toString()).slice(-4000); });
    p.on('error', reject);
    p.on('close', code => {
      if (code === 0) resolve();
      else reject(new Error(`FFmpeg terminó con código ${code}: ${errTail.trim().split('\n').slice(-3).join(' | ')}`));
    });
  });
}

module.exports = { FFMPEG, FFPROBE, checkTools, probe, runFfmpeg };
