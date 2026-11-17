// Edición y exportación: línea de tiempo, transiciones, ajustes de imagen y audio, música, efectos, subtítulos
// y vídeo final MP4 (FFmpeg). También genera la vista previa rápida.
import fs from 'node:fs';
import path from 'node:path';
import { sql } from '../db/index.js';
import { AppError } from '../core/errors.js';
import { enqueue, defineJob } from '../core/jobs.js';
import { emit } from '../core/events.js';
import { put, localPath, scratch } from '../core/storage.js';
import { ffmpeg, ffmpegRaw, probe } from '../services/ffmpeg.js';
import { SIZES } from './visuals.js';
import { autoCues, buildAss } from './subtitles.js';
import { own } from './projects.js';

const XFADE = { fundido: 'fade', deslizar: 'slideleft', zoom: 'zoomin', disolver: 'dissolve', barrido: 'wipeleft', circulo: 'circleopen' };
export const EXPORT_PRESETS = { '720p': 720, '1080p': 1080, '1440p': 1440 };
const FPS = 30;

/** Línea de tiempo: la voz de cada escena empieza cuando termina su transición; la imagen dura su voz + pausa. */
export function timeline(scenes, project) {
  const e = project.edit || {};
  const T = e.transitionSec ?? 0.4, pause = e.pauseSec ?? 0.35;
  let t = 0;
  return scenes.map((s, i) => {
    const trans = i === 0 || s.transition === 'corte' ? 0 : T;
    const voice = s.audio_sec || 0;
    const natural = voice ? trans + voice + pause : project.rhythm.seconds;
    const dur = Math.max(1.2, s.duration_sec && s.duration_sec > natural ? s.duration_sec : natural);
    const item = { idx: s.idx, id: s.id, start: +t.toFixed(3), duration: +dur.toFixed(3), transition: trans ? s.transition : 'corte', transitionSec: trans, voiceStart: +(t + trans).toFixed(3), voiceSec: voice, narration: s.narration };
    t += dur;
    return item;
  });
}

async function visualFor(scene) {
  if (scene.anim_status === 'lista' && scene.anim_path) return { kind: 'video', file: await localPath(scene.anim_path) };
  if (scene.image_status === 'lista' && scene.image_path) return { kind: 'image', file: await localPath(scene.image_path) };
  throw new AppError(400, `La escena ${scene.idx} no tiene imagen. Genérala antes de exportar.`);
}

function sourceArgs(v, secs) {
  return v.kind === 'image' ? ['-loop', '1', '-framerate', String(FPS), '-t', secs.toFixed(3), '-i', v.file] : ['-t', secs.toFixed(3), '-i', v.file];
}

async function renderVideoTrack({ project, scenes, tl, size, out, preset, onProgress }) {
  const [w, h] = size;
  const e = project.edit || {};
  const eq = `eq=brightness=${(e.brightness ?? 0).toFixed(2)}:contrast=${(e.contrast ?? 1).toFixed(2)}:saturation=${(e.saturation ?? 1).toFixed(2)}`;
  const dir = `${out}.seg`;
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const list = [];
  let prev = null;
  {
    for (let i = 0; i < scenes.length; i++) {
      const s = scenes[i], it = tl[i];
      const v = await visualFor(s);
      const frames = Math.round((it.start + it.duration) * FPS) - Math.round(it.start * FPS);
      const kb = v.kind === 'image' && e.kenBurns ? `,zoompan=z='min(1+0.08*on/${frames},1.08)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=${w}x${h}:fps=${FPS}` : '';
      const base = `scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},setsar=1${kb},fps=${FPS},${eq},tpad=stop_mode=clone:stop_duration=${(it.duration + 1).toFixed(2)},format=yuv420p`;
      const still = `scale=${w}:${h},setsar=1,fps=${FPS},format=yuv420p`; // el fotograma anterior ya lleva sus ajustes
      const seg = path.join(dir, `${String(i).padStart(4, '0')}.mp4`);
      const enc = ['-frames:v', String(frames), '-c:v', 'libx264', '-preset', preset, '-crf', '20', '-pix_fmt', 'yuv420p', '-r', String(FPS), '-an', seg];
      if (prev && it.transitionSec > 0) {
        await ffmpeg([...sourceArgs(prev, 2), ...sourceArgs(v, it.duration + 1),
          '-filter_complex', `[0:v]${still}[a];[1:v]${base}[b];[a][b]xfade=transition=${XFADE[it.transition] || 'fade'}:duration=${it.transitionSec}:offset=0[v]`, '-map', '[v]', ...enc]);
      } else {
        await ffmpeg([...sourceArgs(v, it.duration + 1), '-vf', base, ...enc]);
      }
      list.push(`file '${seg.replace(/\\/g, '/').replace(/'/g, "'\\''")}'`);
      prev = { kind: 'image', file: await lastFrame(seg, path.join(dir, `last${i}.png`)) }; // transición desde el último fotograma real
      onProgress?.((i + 1) / scenes.length);
    }
    fs.writeFileSync(path.join(dir, 'list.txt'), list.join('\n'));
    await ffmpeg(['-f', 'concat', '-safe', '0', '-i', path.join(dir, 'list.txt'), '-c', 'copy', out]);
  }
  return dir;
}

async function lastFrame(file, out) { await ffmpeg(['-sseof', '-0.1', '-i', file, '-frames:v', '1', '-update', '1', out]); return out; }

async function mixAudio({ project, scenes, tl, total, out }) {
  const inputs = [], filters = [], mixes = [];
  let n = 0;
  const voiceVol = project.edit?.voiceVolume ?? 1;
  for (const [i, s] of scenes.entries()) {
    if (!s.audio_path || s.audio_status !== 'lista') continue;
    inputs.push('-i', await localPath(s.audio_path));
    filters.push(`[${n}:a]aformat=sample_rates=44100:channel_layouts=stereo,volume=${voiceVol},adelay=${Math.round(tl[i].voiceStart * 1000)}:all=1[v${n}]`);
    mixes.push(`[v${n}]`); n++;
  }
  const hasVoice = mixes.length > 0;
  if (hasVoice) filters.push(`${mixes.join('')}amix=inputs=${mixes.length}:normalize=0:dropout_transition=0,apad,atrim=0:${total.toFixed(3)}[voz]`);
  else filters.push(`anullsrc=r=44100:cl=stereo,atrim=0:${total.toFixed(3)}[voz]`);
  const m = project.music || {};
  let bed = null;
  if (m.trackId) {
    const [t] = await sql`select * from music_tracks where id = ${m.trackId}`;
    if (t) {
      const from = m.startScene ? tl.find((x) => x.idx === Number(m.startScene))?.start ?? 0 : 0;
      const to = m.endScene ? (() => { const x = tl.find((y) => y.idx === Number(m.endScene)); return x ? x.start + x.duration : total; })() : total;
      const len = Math.max(0.5, to - from);
      inputs.push('-stream_loop', '-1', '-i', await localPath(t.path));
      const fadeOut = Math.min(m.fadeOut ?? 3, len / 2);
      filters.push(`[${n}:a]aformat=sample_rates=44100:channel_layouts=stereo,atrim=0:${len.toFixed(3)},asetpts=N/SR/TB,volume=${(m.volume ?? 0.25).toFixed(3)},afade=t=in:d=${Math.min(m.fadeIn ?? 2, len / 2)},afade=t=out:st=${(len - fadeOut).toFixed(3)}:d=${fadeOut},adelay=${Math.round(from * 1000)}:all=1,apad,atrim=0:${total.toFixed(3)}[mus]`);
      n++;
      if (m.ducking !== false && hasVoice) { filters.push('[voz]asplit=2[voz1][key]'); filters.push('[mus][key]sidechaincompress=threshold=0.03:ratio=6:attack=20:release=400[duck]'); bed = '[duck]'; }
      else { bed = '[mus]'; }
    }
  }
  const sfx = [];
  for (const fx of m.sfx || []) {
    const [t] = await sql`select * from music_tracks where id = ${fx.trackId}`;
    const at = tl.find((x) => x.idx === Number(fx.scene));
    if (!t || !at) continue;
    inputs.push('-i', await localPath(t.path));
    filters.push(`[${n}:a]aformat=sample_rates=44100:channel_layouts=stereo,volume=${(fx.volume ?? 0.6).toFixed(2)},adelay=${Math.round((at.start + (fx.offset || 0)) * 1000)}:all=1[fx${n}]`);
    sfx.push(`[fx${n}]`); n++;
  }
  const voiceLabel = bed === '[duck]' ? '[voz1]' : '[voz]';
  const parts = [voiceLabel, ...(bed ? [bed] : []), ...sfx];
  filters.push(`${parts.join('')}amix=inputs=${parts.length}:normalize=0:dropout_transition=0,alimiter=limit=0.95,atrim=0:${total.toFixed(3)}[mix]`);
  await ffmpeg([...inputs, '-filter_complex', filters.join(';'), '-map', '[mix]', '-ar', '44100', '-ac', '2', out]);
}

export async function requestRender(user, projectId, { kind = 'final', resolution = '1080p' } = {}) {
  const p = await own(user, projectId);
  const scenes = await sql`select idx, image_status from scenes where project_id = ${p.id} order by idx`;
  if (!scenes.length) throw new AppError(400, 'El proyecto no tiene escenas.');
  const missing = scenes.filter((s) => s.image_status !== 'lista').map((s) => s.idx);
  if (missing.length) throw new AppError(400, `Faltan imágenes en las escenas ${missing.join(', ')}.`);
  if (!EXPORT_PRESETS[resolution] && kind === 'final') throw new AppError(400, 'Resolución no válida');
  return enqueue('proyecto.render', { projectId: p.id, kind, resolution }, { ownerId: user.id, projectId: p.id });
}

defineJob('proyecto.render', async (job, { progress }) => {
  const [p] = await sql`select * from projects where id = ${job.payload.projectId}`;
  const scenes = await sql`select * from scenes where project_id = ${p.id} order by idx`;
  const final = job.payload.kind === 'final';
  const [bw, bh] = SIZES[p.format];
  const target = final ? EXPORT_PRESETS[job.payload.resolution] : 480;
  const k = target / Math.min(bw, bh);
  const size = [Math.round((bw * k) / 2) * 2, Math.round((bh * k) / 2) * 2];
  const tl = timeline(scenes, p);
  const total = tl.reduce((a, x) => a + x.duration, 0);
  const work = scratch(`proyectos/${p.id}/render/${job.id}/x`);
  const dir = path.dirname(work);
  await progress(0.02, 'Preparando escenas…');
  const silent = path.join(dir, 'video.mp4');
  const segDir = await renderVideoTrack({ project: p, scenes, tl, size, out: silent, preset: final ? 'medium' : 'veryfast', onProgress: (x) => progress(0.05 + x * 0.75, `Escenas ${Math.round(x * 100)} %`) });
  await progress(0.82, 'Mezclando voz, música y efectos…');
  const audio = path.join(dir, 'audio.wav');
  await mixAudio({ project: p, scenes, tl, total, out: audio });
  await progress(0.9, 'Subtítulos y codificación final…');
  const sub = p.subtitles || {};
  const args = ['-i', silent, '-i', audio];
  let vf = null;
  if (sub.enabled !== false && (sub.cues?.length || scenes.some((s) => s.audio_sec))) {
    const cues = sub.manual && sub.cues?.length ? sub.cues : autoCues(tl, sub.style?.maxWords || 6);
    const assFile = path.join(dir, 'subs.ass');
    fs.writeFileSync(assFile, buildAss(cues, sub.style || {}, size));
    vf = `ass='${assFile.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'")}'`;
  }
  const outKey = `proyectos/${p.id}/${final ? 'exportaciones' : 'previas'}/${final ? `video-${job.payload.resolution}` : 'previa'}-${Date.now()}.mp4`;
  const outFile = scratch(outKey);
  await ffmpeg([...args, ...(vf ? ['-vf', vf, '-c:v', 'libx264', '-preset', final ? 'medium' : 'veryfast', '-crf', final ? '19' : '26'] : ['-c:v', 'copy']), '-map', '0:v', '-map', '1:a', '-c:a', 'aac', '-b:a', final ? '192k' : '128k', '-t', total.toFixed(3), '-movflags', '+faststart', outFile]);
  fs.rmSync(segDir, { recursive: true, force: true });
  // Comprobación del archivo: flujos, duración y decodificación completa sin errores.
  const info = await probe(outFile);
  const v = info.streams.find((x) => x.codec_type === 'video'), a = info.streams.find((x) => x.codec_type === 'audio');
  const dur = Number(info.format.duration);
  let decodeErr = '';
  try { decodeErr = (await ffmpegRaw(['-v', 'error', '-i', outFile, '-f', 'null', '-'])).err.trim(); } catch (e) { decodeErr = e.message; }
  if (!v || !a || Math.abs(dur - total) > 0.6 || decodeErr) throw new Error(`El MP4 no superó la comprobación (vídeo ${!!v}, audio ${!!a}, duración ${dur.toFixed(2)}/${total.toFixed(2)} s${decodeErr ? `, errores: ${decodeErr.slice(0, 200)}` : ''}).`);
  await put(outKey, outFile, 'video/mp4');
  const meta = { kind: job.payload.kind, resolution: `${v.width}x${v.height}`, duration: +dur.toFixed(2), sizeBytes: fs.statSync(outFile).size, scenes: scenes.length, at: new Date().toISOString(), checks: ['H.264 + AAC', 'duración prevista', 'decodificado completo sin errores'] };
  if (final) await sql`update projects set export_path = ${outKey}, export_meta = ${sql.json(meta)}, status = 'exportado', updated_at = now() where id = ${p.id}`;
  else await sql`update projects set edit = ${sql.json({ ...(p.edit || {}), previewPath: outKey, previewAt: meta.at })}, updated_at = now() where id = ${p.id}`;
  emit(p.owner_id, 'project', { projectId: p.id });
  return `${final ? 'Vídeo exportado' : 'Vista previa lista'}: ${meta.resolution}, ${meta.duration} s.`;
});
