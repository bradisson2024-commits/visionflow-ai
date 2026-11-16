// Exportador MP4: pista de voz, música con ducking, efectos, imágenes fijas encadenadas y miniatura.
import fs from 'node:fs';
import path from 'node:path';
import { ffmpeg } from '../services/ffmpeg.js';
import { paths } from '../core/paths.js';
import { getSetting } from '../core/settings.js';
import { musicTracks, composeMusic, effects } from './soundtrack.js';

const FPS = 30;
const script = (file, lines) => { fs.writeFileSync(file, lines.join(';\n')); return file; };

export async function voiceTrack({ items, wavs, total, out }) {
  const args = wavs.flatMap((w) => ['-i', w]);
  const lines = items.map((it, i) => `[${i}:a]aresample=44100,aformat=channel_layouts=mono,adelay=${Math.round(it.speechStart * 1000)}:all=1[v${i}]`);
  lines.push(`${items.map((_, i) => `[v${i}]`).join('')}amix=inputs=${items.length}:normalize=0:dropout_transition=0,apad,atrim=0:${total.toFixed(3)},loudnorm=I=-16:TP=-1.5:LRA=11[voz]`);
  const f = script(`${out}.fx`, lines);
  try { await ffmpeg([...args, '-filter_complex_script', f, '-map', '[voz]', '-ar', '44100', '-ac', '1', '-c:a', 'pcm_s16le', out]); } finally { fs.rmSync(f, { force: true }); }
}

export async function bedTrack({ items, total, voice, workDir, out }) {
  const tracks = musicTracks();
  let music, info;
  if (tracks.length) { music = path.join(paths.music, tracks[Math.floor(Math.random() * tracks.length)]); info = { origen: 'biblioteca', archivo: path.basename(music) }; }
  else { music = path.join(workDir, 'musica_original.wav'); await composeMusic(music, total); info = { origen: 'compuesta', archivo: 'musica_original.wav', nota: 'No había pistas en la biblioteca de música: se compuso una pista instrumental original con FFmpeg.' }; }
  const fx = await effects(path.join(workDir, 'efectos'));
  const lufs = Number(getSetting('MUSIC_VOLUME_DB')) || -24;
  const args = ['-stream_loop', '-1', '-i', music, '-i', voice];
  const lines = [
    `[0:a]aformat=sample_rates=44100:channel_layouts=stereo,atrim=0:${total.toFixed(3)},asetpts=N/SR/TB,loudnorm=I=${lufs}:TP=-3,afade=t=in:d=2.5,afade=t=out:st=${Math.max(0, total - 3).toFixed(3)}:d=3[mus]`,
    '[1:a]aformat=channel_layouts=stereo[key]',
    '[mus][key]sidechaincompress=threshold=0.02:ratio=6:attack=20:release=500[duck]',
  ];
  const placed = [];
  items.forEach((it, i) => {
    if (!i || !it.sfx || !fx[it.sfx]) return;
    args.push('-i', fx[it.sfx]);
    const at = Math.max(0, it.showFrom - 0.15);
    lines.push(`[${2 + placed.length}:a]adelay=${Math.round(at * 1000)}:all=1,volume=0.55[e${placed.length}]`);
    placed.push({ n: it.n, efecto: it.sfx, segundo: +at.toFixed(2) });
  });
  lines.push(`[duck]${placed.map((_, k) => `[e${k}]`).join('')}amix=inputs=${1 + placed.length}:normalize=0:dropout_transition=0,apad,atrim=0:${total.toFixed(3)}[cama]`);
  const f = script(`${out}.fx`, lines);
  try { await ffmpeg([...args, '-filter_complex_script', f, '-map', '[cama]', '-ar', '44100', '-ac', '2', '-c:a', 'pcm_s16le', out]); } finally { fs.rmSync(f, { force: true }); }
  return { musica: info, efectos: placed };
}

/**
 * Video final por segmentos (memoria acotada aunque haya 100 escenas):
 *  segmento i = desde que la imagen i empieza a aparecer hasta que empieza a aparecer la i+1;
 *  sus primeros `fadeIn` segundos son el fundido desde la imagen anterior. Los límites se calculan en
 *  fotogramas exactos, los segmentos se unen sin recodificar y al final se mezcla el audio.
 */
export async function renderMp4({ items, images, total, voice, bed, out, onProgress }) {
  const dir = `${out}.segmentos`;
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const frameAt = (t) => Math.round(t * FPS);
  const vf = 'scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=0xF5EDDC,setsar=1,fps=' + FPS + ',format=yuv420p';
  const enc = ['-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-tune', 'stillimage', '-pix_fmt', 'yuv420p', '-r', String(FPS), '-an'];
  const list = [];
  try {
    for (let i = 0; i < items.length; i++) {
      const start = frameAt(items[i].showFrom);
      const end = i + 1 < items.length ? frameAt(items[i + 1].showFrom) : frameAt(total);
      const frames = end - start;
      const seg = path.join(dir, `s${String(i).padStart(4, '0')}.mp4`);
      const secs = (frames / FPS + 0.5).toFixed(3);
      const fade = i > 0 ? items[i].fadeIn : 0;
      if (fade > 0) {
        await ffmpeg(['-loop', '1', '-t', (fade + 0.2).toFixed(3), '-i', images[i - 1], '-loop', '1', '-t', secs, '-i', images[i],
          '-filter_complex', `[0:v]${vf}[a];[1:v]${vf}[b];[a][b]xfade=transition=fade:duration=${fade.toFixed(3)}:offset=0[v]`, '-map', '[v]', '-frames:v', String(frames), ...enc, seg]);
      } else {
        await ffmpeg(['-loop', '1', '-t', secs, '-i', images[i], '-vf', vf, '-frames:v', String(frames), ...enc, seg]);
      }
      list.push(`file '${seg.replace(/\\/g, '/').replace(/'/g, "'\\''")}'`);
      onProgress?.((i + 1) / (items.length + 1));
    }
    const listFile = path.join(dir, 'lista.txt');
    fs.writeFileSync(listFile, list.join('\n'));
    const silent = path.join(dir, 'video.mp4');
    await ffmpeg(['-f', 'concat', '-safe', '0', '-i', listFile, '-c', 'copy', silent]);
    const part = `${out}.part.mp4`;
    await ffmpeg(['-i', silent, '-i', voice, '-i', bed, '-filter_complex', '[1:a]aformat=channel_layouts=stereo[vz];[2:a]aformat=channel_layouts=stereo[cm];[vz][cm]amix=inputs=2:normalize=0:dropout_transition=0,alimiter=limit=0.95[audio]',
      '-map', '0:v', '-map', '[audio]', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-ar', '44100', '-t', total.toFixed(3), '-movflags', '+faststart', part]);
    fs.renameSync(part, out);
    onProgress?.(1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(`${out}.part.mp4`, { force: true });
  }
}

function boldFont() {
  return ['/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', '/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf', 'C:/Windows/Fonts/impact.ttf', 'C:/Windows/Fonts/arialbd.ttf',
    '/System/Library/Fonts/Supplemental/Impact.ttf', '/System/Library/Fonts/Supplemental/Arial Bold.ttf', '/Library/Fonts/Arial Bold.ttf'].find((f) => fs.existsSync(f)) || null;
}

/** Miniatura 1280×720 con el texto grande en amarillo. */
export async function thumbnail({ image, text, out }) {
  const font = boldFont();
  const base = 'scale=1280:720:force_original_aspect_ratio=increase,crop=1280:720';
  if (!font || !text) { await ffmpeg(['-i', image, '-frames:v', '1', '-vf', base, out]); return { conTexto: false }; }
  const tf = `${out}.txt`;
  fs.writeFileSync(tf, String(text).toUpperCase().slice(0, 32));
  const e = (p) => p.replace(/\\/g, '/').replace(/:/g, '\\:');
  try {
    await ffmpeg(['-i', image, '-frames:v', '1', '-vf', `${base},drawbox=x=0:y=ih-200:w=iw:h=200:color=black@0.55:t=fill,drawtext=fontfile='${e(font)}':textfile='${e(tf)}':fontsize=104:fontcolor=0xF2C230:borderw=7:bordercolor=black:x=(w-text_w)/2:y=h-150`, out]);
  } finally { fs.rmSync(tf, { force: true }); }
  return { conTexto: true };
}

export async function mp3(wav, out) { await ffmpeg(['-i', wav, '-c:a', 'libmp3lame', '-b:a', '192k', out]); }
