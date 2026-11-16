// Música instrumental y efectos de sonido. Si no hay pistas propias en assets/music, se compone una pista
// ambiental original con osciladores de FFmpeg (audio real, sin derechos de terceros) y se informa de ello.
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { ffmpeg } from './media.js';

const AUDIO_EXT = /\.(mp3|wav|m4a|aac|ogg|flac)$/i;

export function pickMusic(seed = 0) {
  if (!fs.existsSync(config.musicDir)) return null;
  const files = fs.readdirSync(config.musicDir).filter((f) => AUDIO_EXT.test(f)).sort();
  if (!files.length) return null;
  return path.join(config.musicDir, files[Math.abs(seed) % files.length]);
}

// Progresión menor de suspense: Am – F – C – G (Hz), 4 s por acorde.
const CHORDS = [
  [110.0, 220.0, 261.63, 329.63],
  [87.31, 174.61, 220.0, 261.63],
  [65.41, 130.81, 196.0, 329.63],
  [98.0, 196.0, 246.94, 293.66],
];

function chordExpr(freqs, dur) {
  const env = `min(1\\,t/1.4)*min(1\\,(${dur}-t)/1.6)`;
  const tones = freqs.map((f, i) => `${(i === 0 ? 0.16 : 0.09).toFixed(2)}*sin(2*PI*${f}*t)*(1+0.15*sin(2*PI*0.${3 + i}*t))`).join('+');
  const pulse = `0.05*sin(2*PI*${freqs[0] / 2}*t)*exp(-3*mod(t\\,1))`; // latido grave suave cada segundo
  return `(${tones}+${pulse})*${env}`;
}

export async function synthMusic(outFile, durationSec) {
  const dur = 4;
  const inputs = [];
  CHORDS.forEach((c) => inputs.push('-f', 'lavfi', '-i', `aevalsrc=${chordExpr(c, dur)}:s=44100:d=${dur}`));
  const concat = CHORDS.map((_, i) => `[${i}:a]`).join('') + `concat=n=${CHORDS.length}:v=0:a=1,lowpass=f=1600,aecho=0.8:0.6:180|360:0.3|0.18,volume=0.8[loop]`;
  const loopFile = `${outFile}.loop.wav`;
  await ffmpeg([...inputs, '-filter_complex', concat, '-map', '[loop]', '-ac', '2', loopFile]);
  try {
    await ffmpeg(['-stream_loop', '-1', '-i', loopFile, '-t', durationSec.toFixed(3), '-af', 'aformat=channel_layouts=stereo', '-ar', '44100', outFile]);
  } finally { fs.rmSync(loopFile, { force: true }); }
}

export const SFX = {
  whoosh: { d: 0.7, args: ['-f', 'lavfi', '-i', 'anoisesrc=c=pink:d=0.7:a=0.6:r=44100'], af: 'highpass=f=300,lowpass=f=4000,afade=t=in:d=0.35,afade=t=out:st=0.35:d=0.35,volume=0.55' },
  revelacion: { d: 1.6, args: ['-f', 'lavfi', '-i', "aevalsrc='0.7*sin(2*PI*55*t)*exp(-3*t)+0.18*sin(2*PI*880*t)*exp(-2.5*t)+0.12*sin(2*PI*1320*t)*exp(-2.2*t)':s=44100:d=1.6"], af: 'aecho=0.8:0.5:90:0.25,volume=0.75' },
  tension: { d: 2.0, args: ['-f', 'lavfi', '-i', "aevalsrc='0.35*sin(2*PI*(70+10*t)*t)*min(1\\,t/0.8)*min(1\\,(2-t)/0.6)':s=44100:d=2"], af: 'lowpass=f=600,volume=0.8' },
};

export async function ensureSfx(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const out = {};
  for (const [name, s] of Object.entries(SFX)) {
    const f = path.join(dir, `${name}.wav`);
    if (!fs.existsSync(f)) await ffmpeg([...s.args, '-af', `${s.af},aformat=channel_layouts=stereo`, '-ar', '44100', f]);
    out[name] = { file: f, duration: s.d };
  }
  return out;
}
