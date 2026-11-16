// Música y efectos. Usa tus pistas de data/musica/ (subidas en Configuración). Si no hay ninguna,
// compone una pista instrumental original con osciladores de FFmpeg y lo deja anotado en el proyecto.
import fs from 'node:fs';
import path from 'node:path';
import { paths } from '../core/paths.js';
import { ffmpeg } from '../services/ffmpeg.js';

export function musicTracks() {
  if (!fs.existsSync(paths.music)) return [];
  return fs.readdirSync(paths.music).filter((f) => /\.(mp3|wav|m4a|ogg|flac|aac)$/i.test(f)).sort();
}

// Re menor – Si bemol – Fa – Do, 3 s por acorde, con arpegio suave (misterio, sin dramatismo).
const PROGRESSION = [[146.83, 174.61, 220.0], [116.54, 146.83, 174.61], [87.31, 130.81, 174.61], [130.81, 164.81, 196.0]];

export async function composeMusic(out, seconds) {
  const loop = `${out}.loop.wav`;
  const inputs = [], labels = [];
  PROGRESSION.forEach((ch, i) => {
    const pad = ch.map((f) => `0.07*sin(2*PI*${f}*t)`).join('+');
    const arp = ch.map((f, k) => `0.05*sin(2*PI*${f * 2}*t)*exp(-4*mod(t-${k * 0.5}\\,1.5))*gte(t\\,${k * 0.5})`).join('+');
    const bass = `0.10*sin(2*PI*${ch[0] / 2}*t)*exp(-1.5*mod(t\\,1.5))`;
    inputs.push('-f', 'lavfi', '-i', `aevalsrc='(${pad}+${arp}+${bass})*min(1\\,t/0.8)*min(1\\,(3-t)/0.8)':s=44100:d=3`);
    labels.push(`[${i}:a]`);
  });
  await ffmpeg([...inputs, '-filter_complex', `${labels.join('')}concat=n=${PROGRESSION.length}:v=0:a=1,lowpass=f=2200,aecho=0.7:0.5:220:0.25,aformat=channel_layouts=stereo[m]`, '-map', '[m]', loop]);
  try { await ffmpeg(['-stream_loop', '-1', '-i', loop, '-t', seconds.toFixed(3), '-ar', '44100', out]); } finally { fs.rmSync(loop, { force: true }); }
}

const SFX = {
  transicion: "anoisesrc=c=pink:a=0.5:d=0.6:r=44100,highpass=f=500,afade=t=in:d=0.3,afade=t=out:st=0.3:d=0.3",
  revelacion: "aevalsrc='0.6*sin(2*PI*65*t)*exp(-2.5*t)+0.2*sin(2*PI*988*t)*exp(-3*t)+0.15*sin(2*PI*1319*t)*exp(-3*t)':s=44100:d=1.5",
  tension: "aevalsrc='0.3*sin(2*PI*(55+15*t)*t)*min(1\\,t/0.7)*min(1\\,(1.8-t)/0.5)':s=44100:d=1.8",
};

export async function effects(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const out = {};
  for (const [k, src] of Object.entries(SFX)) {
    const f = path.join(dir, `${k}.wav`);
    if (!fs.existsSync(f)) await ffmpeg(['-f', 'lavfi', '-i', src, '-af', 'volume=0.7,aformat=channel_layouts=stereo', '-ar', '44100', f]);
    out[k] = f;
  }
  return out;
}
