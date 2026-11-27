// Pasos 8–9: montaje y renderizado real con FFmpeg (H.264 + AAC, MP4).
//
// 1. Cada escena se convierte en un clip con movimiento de cámara suave (zoom/paneo
//    tipo Ken Burns) y transición de fundido, con la duración exacta de su narración.
// 2. Los clips se concatenan en orden.
// 3. La narración de cada escena se ajusta a la duración de su escena y se concatena,
//    de modo que cada frase suena mientras se ve su imagen.
// 4. La música se repite si hace falta, se baja automáticamente cuando habla la voz
//    (ducking por sidechain) y se desvanece al final.
import fs from 'node:fs';
import path from 'node:path';
import { runFfmpeg, probeDuration } from '../media.js';

export const RESOLUTIONS = {
  '16:9': { '1080p': [1920, 1080], '720p': [1280, 720] },
  '9:16': { '1080p': [1080, 1920], '720p': [720, 1280] },
  '1:1': { '1080p': [1080, 1080], '720p': [720, 720] },
};

function motionExpr(camera, frames, enabled) {
  const N = Math.max(1, frames - 1);
  const t = `(on/${N})`;
  const Z = 1.12; // zoom máximo: sutil, sin perder la composición
  if (!enabled || camera === 'static') return { z: '1.0', x: '0', y: '0' };
  const cx = 'iw/2-(iw/zoom/2)', cy = 'ih/2-(ih/zoom/2)';
  switch (camera) {
    case 'zoom_out': return { z: `${Z}-${Z - 1}*${t}`, x: cx, y: cy };
    case 'pan_left': return { z: `${Z}`, x: `(iw-iw/zoom)*(1-${t})`, y: cy };
    case 'pan_right': return { z: `${Z}`, x: `(iw-iw/zoom)*${t}`, y: cy };
    case 'pan_up': return { z: `${Z}`, x: cx, y: `(ih-ih/zoom)*(1-${t})` };
    case 'pan_down': return { z: `${Z}`, x: cx, y: `(ih-ih/zoom)*${t}` };
    case 'zoom_in':
    default: return { z: `1+${Z - 1}*${t}`, x: cx, y: cy };
  }
}

/** Clip de video (sin audio) para una escena. */
export async function renderSceneClip({ image, out, duration, camera, W, H, fps, transition, motion, signal }) {
  const frames = Math.max(2, Math.round(duration * fps));
  const m = motionExpr(camera, frames, motion);
  // Se trabaja a 2x para que el zoom/paneo sea suave (zoompan redondea a píxeles enteros).
  const W2 = W * 2, H2 = H * 2;
  const fadeD = Math.min(0.35, duration / 4);
  const filters = [
    `scale=${W2}:${H2}:force_original_aspect_ratio=increase:flags=lanczos`,
    `crop=${W2}:${H2}`,
    `zoompan=z='${m.z}':x='${m.x}':y='${m.y}':d=${frames}:s=${W}x${H}:fps=${fps}`,
    transition === 'fade' ? `fade=t=in:st=0:d=${fadeD.toFixed(3)},fade=t=out:st=${(duration - fadeD).toFixed(3)}:d=${fadeD.toFixed(3)}` : null,
    'format=yuv420p',
  ].filter(Boolean).join(',');
  await runFfmpeg(['-y', '-i', image, '-vf', filters, '-frames:v', String(frames), '-r', String(fps),
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', '-an', out], { signal });
  return out;
}

/** Audio de una escena con la duración exacta de la escena (voz + silencio de respiro). */
export async function renderSceneAudio({ audio, out, duration, signal }) {
  const lead = 0.12;
  const args = audio
    ? ['-y', '-i', audio, '-af', `aresample=44100,aformat=channel_layouts=stereo,adelay=${Math.round(lead * 1000)}:all=1,apad,atrim=0:${duration.toFixed(3)}`, '-c:a', 'pcm_s16le', out]
    : ['-y', '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=stereo', '-t', duration.toFixed(3), '-c:a', 'pcm_s16le', out];
  await runFfmpeg(args, { signal });
  return out;
}

function writeConcatList(file, items) {
  fs.writeFileSync(file, items.map(p => `file '${p.replace(/'/g, "'\\''")}'`).join('\n') + '\n');
}

/**
 * Renderiza el video final. scenes: [{ image, audio, duration, camera }]
 * Devuelve { path, duration }.
 */
export async function renderVideo({ workDir, scenes, outPath, aspect = '16:9', resolution = '1080p', fps = 30, transition = 'fade', motion = true,
  music = null, musicVolume = 0.18, ducking = true, avatar = null, onClip, onRenderProgress, signal }) {
  const [W, H] = (RESOLUTIONS[aspect] || RESOLUTIONS['16:9'])[resolution] || [1920, 1080];
  const dir = path.join(workDir, 'render');
  fs.mkdirSync(dir, { recursive: true });

  // 1–3. Clips de video y audio por escena (orden estricto de la narración).
  const clips = [], auds = [];
  for (let i = 0; i < scenes.length; i++) {
    const s = scenes[i];
    const v = path.join(dir, `clip_${String(i).padStart(4, '0')}.mp4`);
    const a = path.join(dir, `aud_${String(i).padStart(4, '0')}.wav`);
    await renderSceneClip({ image: s.image, out: v, duration: s.duration, camera: s.camera, W, H, fps, transition, motion, signal });
    await renderSceneAudio({ audio: s.audio, out: a, duration: s.duration, signal });
    clips.push(v); auds.push(a);
    onClip?.(i + 1, scenes.length);
  }
  const vlist = path.join(dir, 'video.txt'), alist = path.join(dir, 'audio.txt');
  writeConcatList(vlist, clips);
  writeConcatList(alist, auds);
  const videoOnly = path.join(dir, 'video.mp4');
  const narration = path.join(dir, 'narration.wav');
  await runFfmpeg(['-y', '-f', 'concat', '-safe', '0', '-i', vlist, '-c', 'copy', videoOnly], { signal });
  await runFfmpeg(['-y', '-f', 'concat', '-safe', '0', '-i', alist, '-c', 'copy', narration], { signal });
  const total = scenes.reduce((a, s) => a + s.duration, 0);

  // 4. Mezcla final.
  const args = ['-y', '-i', videoOnly, '-i', narration];
  let idx = 2;
  const fc = [];
  let vOut = '0:v';
  if (avatar) {
    args.push('-loop', '1', '-i', avatar);
    const size = Math.round(Math.min(W, H) * 0.22), margin = Math.round(Math.min(W, H) * 0.04);
    fc.push(`[${idx}:v]scale=${size}:${size}:force_original_aspect_ratio=increase,crop=${size}:${size},format=rgba,` +
      `geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='if(lte(hypot(X-${size / 2},Y-${size / 2}),${size / 2 - 1}),255,0)'[av]`);
    fc.push(`[0:v][av]overlay=W-w-${margin}:H-h-${margin}:shortest=1,format=yuv420p[vout]`);
    vOut = '[vout]';
    idx++;
  }
  let aOut = '[1:a]';
  if (music) {
    args.push('-stream_loop', '-1', '-i', music);
    const fadeStart = Math.max(0, total - 2.5);
    fc.push(`[${idx}:a]aresample=44100,aformat=channel_layouts=stereo,volume=${Number(musicVolume).toFixed(3)},atrim=0:${total.toFixed(3)},afade=t=in:d=1.5,afade=t=out:st=${fadeStart.toFixed(3)}:d=2.5[mus]`);
    if (ducking) {
      fc.push('[1:a]asplit=2[nar][sc]');
      fc.push('[mus][sc]sidechaincompress=threshold=0.03:ratio=6:attack=15:release=450:makeup=1[duck]');
      fc.push('[nar][duck]amix=inputs=2:duration=first:normalize=0,alimiter=limit=0.95[aout]');
    } else {
      fc.push('[1:a][mus]amix=inputs=2:duration=first:normalize=0,alimiter=limit=0.95[aout]');
    }
    aOut = '[aout]';
    idx++;
  }
  if (fc.length) args.push('-filter_complex', fc.join(';'));
  args.push('-map', vOut, '-map', aOut);
  args.push(...(avatar ? ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20'] : ['-c:v', 'copy']));
  args.push('-c:a', 'aac', '-b:a', '192k', '-t', total.toFixed(3), '-movflags', '+faststart', outPath);
  await runFfmpeg(args, { signal, onProgress: sec => onRenderProgress?.(Math.min(1, sec / total)) });

  const duration = await probeDuration(outPath);
  return { path: outPath, duration, narration };
}

export async function makeThumbnail(image, out) {
  await runFfmpeg(['-y', '-i', image, '-vf', 'scale=640:-2', '-frames:v', '1', '-q:v', '4', out]);
  return out;
}
