// Módulo 13 · Paso 7: editor automático con FFmpeg. Secuencia de ilustraciones estáticas (sin animar personajes),
// fundidos discretos en las pausas, narración sincronizada, música con ducking y efectos de sonido.
import fs from 'node:fs';
import path from 'node:path';
import { ffmpeg } from './media.js';
import { pickMusic, synthMusic, ensureSfx } from './audio.js';

const FPS = 30;

/** Pista de narración: cada WAV de escena colocado exactamente en su instante de inicio. */
export async function buildNarrationTrack({ scenes, timeline, wavOf, outFile, onProgress }) {
  const args = [];
  const parts = [];
  scenes.forEach((s, i) => {
    args.push('-i', wavOf(s));
    const ms = Math.round(timeline.entries[i].start * 1000);
    parts.push(`[${i}:a]aformat=sample_rates=44100:channel_layouts=mono,adelay=${ms}:all=1[a${i}]`);
  });
  const mix = `${scenes.map((_, i) => `[a${i}]`).join('')}amix=inputs=${scenes.length}:normalize=0:dropout_transition=0,apad,atrim=0:${timeline.total.toFixed(3)},loudnorm=I=-16:TP=-1.5:LRA=11[out]`;
  const script = `${outFile}.filter.txt`;
  fs.writeFileSync(script, [...parts, mix].join(';\n'));
  try {
    await ffmpeg([...args, '-filter_complex_script', script, '-map', '[out]', '-ar', '44100', '-ac', '1', '-c:a', 'pcm_s16le', outFile], { onStderr: onProgress });
  } finally { fs.rmSync(script, { force: true }); }
}

/** Cama musical (música con ducking bajo la voz + efectos), separada para poder medir que no tapa la voz. */
export async function buildMusicBed({ timeline, narrationFile, workDir, seed, outFile }) {
  let musicFile = pickMusic(seed);
  let musicInfo;
  if (musicFile) musicInfo = { type: 'archivo', file: path.basename(musicFile) };
  else {
    musicFile = path.join(workDir, 'musica_ambiental_original.wav');
    await synthMusic(musicFile, timeline.total);
    musicInfo = { type: 'sintetizada', file: path.basename(musicFile), note: 'Pista ambiental original compuesta con osciladores de FFmpeg (no había música en assets/music).' };
  }
  const sfx = await ensureSfx(path.join(workDir, 'sfx'));
  const T = timeline.total.toFixed(3);
  const inputs = ['-stream_loop', '-1', '-i', musicFile, '-i', narrationFile];
  const filters = [
    `[0:a]aformat=sample_rates=44100:channel_layouts=stereo,atrim=0:${T},asetpts=N/SR/TB,loudnorm=I=-24:TP=-3:LRA=7,afade=t=in:d=2,afade=t=out:st=${Math.max(0, timeline.total - 3).toFixed(3)}:d=3[m]`,
    `[1:a]aformat=sample_rates=44100:channel_layouts=stereo[sc]`,
    `[m][sc]sidechaincompress=threshold=0.02:ratio=6:attack=15:release=450:makeup=1[duck]`,
  ];
  const sfxPlaced = [];
  timeline.entries.forEach((e, i) => {
    if (!e.sfx || i === 0 || !sfx[e.sfx]) return;
    const idx = 2 + sfxPlaced.length;
    inputs.push('-i', sfx[e.sfx].file);
    // El efecto suena en la transición, antes de que empiece la voz de la escena.
    const at = Math.max(0, e.visualStart - (e.sfx === 'whoosh' ? 0.2 : 0.1));
    filters.push(`[${idx}:a]adelay=${Math.round(at * 1000)}:all=1,volume=0.6[x${sfxPlaced.length}]`);
    sfxPlaced.push({ n: e.n, type: e.sfx, at: +at.toFixed(3) });
  });
  const mixIn = ['[duck]', ...sfxPlaced.map((_, k) => `[x${k}]`)].join('');
  filters.push(`${mixIn}amix=inputs=${1 + sfxPlaced.length}:normalize=0:dropout_transition=0,apad,atrim=0:${T}[bed]`);
  const script = `${outFile}.filter.txt`;
  fs.writeFileSync(script, filters.join(';\n'));
  try {
    await ffmpeg([...inputs, '-filter_complex_script', script, '-map', '[bed]', '-ar', '44100', '-ac', '2', '-c:a', 'pcm_s16le', outFile]);
  } finally { fs.rmSync(script, { force: true }); }
  return { music: musicInfo, sfx: sfxPlaced };
}

/** Video final: imágenes estáticas encadenadas con fundidos cortos + mezcla de voz y cama musical. */
export async function renderVideo({ scenes, timeline, imageOf, narrationFile, bedFile, outFile, onProgress }) {
  const args = [];
  scenes.forEach((s, i) => {
    args.push('-loop', '1', '-framerate', String(FPS), '-t', timeline.entries[i].clip.toFixed(3), '-i', imageOf(s));
  });
  const ai = scenes.length;
  args.push('-i', narrationFile, '-i', bedFile);
  const f = [];
  scenes.forEach((_, i) => f.push(`[${i}:v]scale=1920:1080:flags=lanczos,setsar=1,fps=${FPS},format=yuv420p[v${i}]`));
  let last = 'v0';
  let acc = timeline.entries[0].clip;
  for (let i = 1; i < scenes.length; i++) {
    const T = timeline.entries[i].transitionIn;
    const offset = acc - T;
    const out = i === scenes.length - 1 ? 'vout' : `x${i}`;
    if (T > 0) f.push(`[${last}][v${i}]xfade=transition=fade:duration=${T.toFixed(3)}:offset=${offset.toFixed(3)}[${out}]`);
    else f.push(`[${last}][v${i}]concat=n=2:v=1:a=0[${out}]`);
    acc = acc - T + timeline.entries[i].clip;
    last = out;
  }
  if (scenes.length === 1) f.push('[v0]null[vout]');
  f.push(`[${ai}:a]aformat=sample_rates=44100:channel_layouts=stereo[nar]`);
  f.push(`[${ai + 1}:a]aformat=sample_rates=44100:channel_layouts=stereo[bed]`);
  f.push(`[nar][bed]amix=inputs=2:normalize=0:dropout_transition=0,alimiter=limit=0.95[aout]`);
  const script = `${outFile}.filter.txt`;
  fs.writeFileSync(script, f.join(';\n'));
  const tmp = `${outFile}.part.mp4`;
  try {
    await ffmpeg([...args, '-filter_complex_script', script, '-map', '[vout]', '-map', '[aout]',
      '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-tune', 'stillimage', '-pix_fmt', 'yuv420p', '-r', String(FPS),
      '-c:a', 'aac', '-b:a', '192k', '-ar', '44100', '-t', timeline.total.toFixed(3), '-movflags', '+faststart', tmp],
    { onStderr: onProgress });
    fs.renameSync(tmp, outFile);
  } finally { fs.rmSync(script, { force: true }); fs.rmSync(tmp, { force: true }); }
}

/** Narración completa exportable (MP3). */
export async function exportNarrationMp3(wav, mp3) {
  await ffmpeg(['-i', wav, '-c:a', 'libmp3lame', '-b:a', '192k', mp3]);
}

/** Miniatura 1280x720: ilustración Stickman + texto grande. */
export function findBoldFont() {
  const candidates = [
    '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
    '/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf',
    '/usr/share/fonts/TTF/DejaVuSans-Bold.ttf',
    'C:/Windows/Fonts/impact.ttf', 'C:/Windows/Fonts/arialbd.ttf',
    '/System/Library/Fonts/Supplemental/Impact.ttf', '/System/Library/Fonts/Supplemental/Arial Bold.ttf', '/Library/Fonts/Arial Bold.ttf',
  ];
  return candidates.find((c) => fs.existsSync(c)) || null;
}

export async function composeThumbnail({ imageFile, text, outFile }) {
  const font = findBoldFont();
  const base = 'scale=1280:720:force_original_aspect_ratio=increase,crop=1280:720';
  if (!font || !text) {
    await ffmpeg(['-i', imageFile, '-vf', base, '-frames:v', '1', outFile]);
    return { text: false, reason: font ? 'sin texto' : 'no se encontró una fuente en negrita en el sistema' };
  }
  const txtFile = `${outFile}.txt`;
  fs.writeFileSync(txtFile, String(text).toUpperCase().slice(0, 40));
  const esc = (p) => p.replace(/\\/g, '/').replace(/:/g, '\\:');
  const vf = `${base},drawtext=fontfile='${esc(font)}':textfile='${esc(txtFile)}':fontsize=96:fontcolor=0xFFD21F:borderw=8:bordercolor=black:x=(w-text_w)/2:y=h-text_h-48:line_spacing=6`;
  try { await ffmpeg(['-i', imageFile, '-vf', vf, '-frames:v', '1', outFile]); } finally { fs.rmSync(txtFile, { force: true }); }
  return { text: true, font: path.basename(font) };
}
