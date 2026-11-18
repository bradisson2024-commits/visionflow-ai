// Generación de imágenes de escena y de referencias del reparto (Gemini Imagen), ampliación y animación
// (Veo para animar personajes/objetos/cámara; FFmpeg para movimiento de cámara gratuito).
import fs from 'node:fs';
import { sql } from '../db/index.js';
import { AppError } from '../core/errors.js';
import { enqueue, defineJob } from '../core/jobs.js';
import { emit } from '../core/events.js';
import { charge } from '../core/credits.js';
import { put, localPath, scratch } from '../core/storage.js';
import * as gemini from '../services/gemini.js';
import { ffmpeg } from '../services/ffmpeg.js';
import { getStyle, stylePrompt } from './styles.js';
import { own } from './projects.js';

export const SIZES = { '16:9': [1920, 1080], '9:16': [1080, 1920], '1:1': [1080, 1080] };

const castLine = (c) => `${c.name} (${c.kind}): ${[c.description, c.wardrobe && `wears ${c.wardrobe}`, c.traits].filter(Boolean).join('; ')}`;

/** Prompt completo de una escena: estilo + continuidad + reparto fijo + descripción de la escena. */
export function buildScenePrompt({ project, style, scene, cast }) {
  const here = cast.filter((c) => scene.character_ids?.includes(c.id));
  const b = project.bible || {};
  return [
    scene.image_prompt,
    here.length && `Recurring characters in this shot, keep their exact look: ${here.map(castLine).join(' | ')}`,
    (b.epoca || b.iluminacion) && `Story continuity: era ${b.epoca || '—'}; lighting ${b.iluminacion || '—'}; palette ${b.paleta || '—'}`,
    `This image illustrates exactly this narration: "${scene.narration}"`,
    stylePrompt(style),
    `Aspect ratio ${project.format}. Single still frame.`,
  ].filter(Boolean).join('. ');
}

async function refImages(cast) {
  const out = [];
  for (const c of cast) if (c.ref_path) out.push({ label: `${c.name} — mantener exactamente su apariencia`, mime: 'image/png', data: fs.readFileSync(await localPath(c.ref_path)).toString('base64') });
  return out.slice(0, 4);
}

async function normalize(buf, project, key) {
  const [w, h] = SIZES[project.format];
  const raw = scratch(`${key}.raw`);
  fs.writeFileSync(raw, buf);
  const out = scratch(key);
  try { await ffmpeg(['-i', raw, '-frames:v', '1', '-vf', `scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h}`, out]); } finally { fs.rmSync(raw, { force: true }); }
  await put(key, out, 'image/png');
  return key;
}

// ------------------------------------------------------------------ escenas
export async function requestImages(user, projectId, sceneIds = null) {
  const p = await own(user, projectId);
  const scenes = sceneIds ? await sql`select id from scenes where project_id = ${p.id} and id = any(${sceneIds})` : await sql`select id from scenes where project_id = ${p.id} and image_status <> 'lista' order by idx`;
  if (!scenes.length) throw new AppError(400, 'No hay escenas pendientes de imagen.');
  for (const s of scenes) {
    await sql`update scenes set image_status = 'en_cola', image_error = null where id = ${s.id}`;
    await enqueue('escena.imagen', { projectId: p.id, sceneId: s.id }, { ownerId: user.id, projectId: p.id });
  }
  emit(user.id, 'project', { projectId: p.id });
  return scenes.length;
}

defineJob('escena.imagen', async (job) => {
  const [s] = await sql`select * from scenes where id = ${job.payload.sceneId}`;
  if (!s) return 'Escena eliminada';
  const [p] = await sql`select * from projects where id = ${s.project_id}`;
  const style = await getStyle(p.style_id);
  const cast = await sql`select * from characters where project_id = ${p.id}`;
  await sql`update scenes set image_status = 'generando' where id = ${s.id}`;
  emit(p.owner_id, 'scene', { projectId: p.id, sceneId: s.id });
  let ch;
  try {
    ch = await charge(p.owner_id, 'imagen.generar', 1, { scene: s.idx }, p.id);
    const prompt = buildScenePrompt({ project: p, style, scene: s, cast });
    const img = await gemini.image({ prompt, refs: await refImages(cast.filter((c) => s.character_ids.includes(c.id))), aspect: p.format });
    const key = await normalize(img.buffer, p, `proyectos/${p.id}/escenas/${s.id}-${Date.now()}.png`);
    await sql`update scenes set image_path = ${key}, image_status = 'lista', image_error = null, anim_status = 'pendiente', anim_path = null where id = ${s.id}`;
    emit(p.owner_id, 'scene', { projectId: p.id, sceneId: s.id });
    return `Imagen de la escena ${s.idx} lista.`;
  } catch (e) {
    await ch?.refund(e.message);
    await sql`update scenes set image_status = 'error', image_error = ${e.message} where id = ${s.id}`;
    emit(p.owner_id, 'scene', { projectId: p.id, sceneId: s.id });
    throw e;
  }
}, { concurrency: 2 });

/** Imagen propia para una escena (hecha fuera de la app, p. ej. en Google Flow): se ajusta al formato del proyecto. */
export async function uploadSceneImage(user, projectId, sceneId, buffer) {
  const p = await own(user, projectId);
  const [s] = await sql`select * from scenes where id = ${sceneId} and project_id = ${p.id}`;
  if (!s) throw new AppError(404, 'Escena no encontrada');
  let key;
  try { key = await normalize(buffer, p, `proyectos/${p.id}/escenas/${s.id}-${Date.now()}.png`); } catch { throw new AppError(400, 'El archivo no es una imagen válida.'); }
  await sql`update scenes set image_path = ${key}, image_status = 'lista', image_error = null, anim_status = 'pendiente', anim_path = null where id = ${s.id}`;
  emit(p.owner_id, 'scene', { projectId: p.id, sceneId: s.id });
  return { ok: true };
}

/** Prompt completo de la escena (el mismo que se enviaría al generador), para usarlo en otra herramienta. */
export async function scenePrompt(user, projectId, sceneId) {
  const p = await own(user, projectId);
  const [s] = await sql`select * from scenes where id = ${sceneId} and project_id = ${p.id}`;
  if (!s) throw new AppError(404, 'Escena no encontrada');
  const style = await getStyle(p.style_id);
  const cast = await sql`select * from characters where project_id = ${p.id}`;
  return { prompt: buildScenePrompt({ project: p, style, scene: s, cast }) };
}

// ------------------------------------------------------------------ reparto
export async function generateReference(user, projectId, charId) {
  const p = await own(user, projectId);
  const [c] = await sql`select * from characters where id = ${charId} and project_id = ${p.id}`;
  if (!c) throw new AppError(404, 'Personaje no encontrado');
  const style = await getStyle(p.style_id);
  const ch = await charge(user.id, 'imagen.referencia', 1, { character: c.name }, p.id);
  try {
    const img = await gemini.image({ aspect: '1:1', prompt: `Character reference sheet of ${castLine(c)}. Full body, front view and three-quarter view side by side, neutral pose, plain light background, clear details of face, body shape, clothing colors and accessories. ${stylePrompt(style)}` });
    const key = `proyectos/${p.id}/reparto/${c.id}-${Date.now()}.png`;
    const f = scratch(key);
    fs.writeFileSync(`${f}.raw`, img.buffer);
    try { await ffmpeg(['-i', `${f}.raw`, '-frames:v', '1', f]); } finally { fs.rmSync(`${f}.raw`, { force: true }); }
    await put(key, f, 'image/png');
    const [u] = await sql`update characters set ref_path = ${key} where id = ${c.id} returning *`;
    return u;
  } catch (e) { await ch.refund(e.message); throw e; }
}

export async function uploadReference(user, projectId, charId, buffer) {
  const p = await own(user, projectId);
  const [c] = await sql`select * from characters where id = ${charId} and project_id = ${p.id}`;
  if (!c) throw new AppError(404, 'Personaje no encontrado');
  const key = `proyectos/${p.id}/reparto/${c.id}-${Date.now()}.png`;
  const raw = scratch(`${key}.raw`);
  fs.writeFileSync(raw, buffer);
  const f = scratch(key);
  try { await ffmpeg(['-i', raw, '-frames:v', '1', '-vf', "scale='min(1536,iw)':-2", f]); } catch { throw new AppError(400, 'El archivo no es una imagen válida.'); } finally { fs.rmSync(raw, { force: true }); }
  await put(key, f, 'image/png');
  const [u] = await sql`update characters set ref_path = ${key} where id = ${c.id} returning *`;
  return u;
}

/** «Ampliar»: reescalado 2× de alta calidad (Lanczos) de la referencia. No inventa detalle nuevo. */
export async function upscaleReference(user, projectId, charId) {
  const p = await own(user, projectId);
  const [c] = await sql`select * from characters where id = ${charId} and project_id = ${p.id}`;
  if (!c?.ref_path) throw new AppError(400, 'El personaje no tiene imagen de referencia.');
  const key = `proyectos/${p.id}/reparto/${c.id}-x2-${Date.now()}.png`;
  const f = scratch(key);
  await ffmpeg(['-i', await localPath(c.ref_path), '-vf', "scale='min(4096,iw*2)':-2:flags=lanczos,unsharp=5:5:0.6", f]);
  await put(key, f, 'image/png');
  const [u] = await sql`update characters set ref_path = ${key} where id = ${c.id} returning *`;
  return u;
}

// ------------------------------------------------------------------ animación
export async function requestAnimation(user, projectId, sceneIds, mode) {
  const p = await own(user, projectId);
  if (!['camara', 'veo'].includes(mode)) throw new AppError(400, 'Modo de animación no válido');
  const scenes = await sql`select id, image_status from scenes where project_id = ${p.id} and id = any(${sceneIds})`;
  if (scenes.some((s) => s.image_status !== 'lista')) throw new AppError(400, 'Genera primero la imagen de las escenas a animar.');
  for (const s of scenes) {
    await sql`update scenes set anim_mode = ${mode}, anim_status = 'en_cola', anim_error = null where id = ${s.id}`;
    await enqueue('escena.animar', { projectId: p.id, sceneId: s.id, mode }, { ownerId: user.id, projectId: p.id });
  }
  return scenes.length;
}

defineJob('escena.animar', async (job, { progress }) => {
  const [s] = await sql`select * from scenes where id = ${job.payload.sceneId}`;
  const [p] = await sql`select * from projects where id = ${s.project_id}`;
  const [w, h] = SIZES[p.format];
  const secs = Math.max(2, Math.min(8, s.duration_sec || s.audio_sec || p.rhythm.seconds));
  await sql`update scenes set anim_status = 'generando' where id = ${s.id}`;
  emit(p.owner_id, 'scene', { projectId: p.id, sceneId: s.id });
  let ch;
  try {
    const img = await localPath(s.image_path);
    const key = `proyectos/${p.id}/animaciones/${s.id}-${Date.now()}.mp4`;
    const out = scratch(key);
    if (job.payload.mode === 'veo') {
      ch = await charge(p.owner_id, 'video.veo', 8, { scene: s.idx }, p.id);
      const veoAspect = p.format === '9:16' ? '9:16' : '16:9'; // Veo no ofrece 1:1: se recorta al centro
      const buf = await gemini.animate({ prompt: `${s.anim_prompt}. Keep the characters, style and composition of the input image.`, image: { mime: 'image/png', data: fs.readFileSync(img).toString('base64') }, aspect: veoAspect, onWait: (sec) => progress(Math.min(0.9, sec / 180), `Veo animando (${sec} s)…`) });
      const raw = `${out}.veo.mp4`;
      fs.writeFileSync(raw, buf);
      await ffmpeg(['-i', raw, '-an', '-vf', `scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},fps=30,format=yuv420p`, '-c:v', 'libx264', '-crf', '18', out]);
      fs.rmSync(raw, { force: true });
    } else {
      // Movimiento de cámara (acercamiento suave) con FFmpeg: mueve la cámara, no anima personajes.
      const frames = Math.round(secs * 30);
      await ffmpeg(['-loop', '1', '-i', img, '-vf', `scale=${w * 2}:${h * 2},zoompan=z='min(1+0.12*on/${frames},1.12)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=${w}x${h}:fps=30,format=yuv420p`, '-frames:v', String(frames), '-c:v', 'libx264', '-crf', '18', out]);
    }
    await put(key, out, 'video/mp4');
    await sql`update scenes set anim_path = ${key}, anim_status = 'lista', anim_error = null where id = ${s.id}`;
    emit(p.owner_id, 'scene', { projectId: p.id, sceneId: s.id });
    return `Escena ${s.idx} animada (${job.payload.mode === 'veo' ? 'Veo' : 'cámara'}).`;
  } catch (e) {
    await ch?.refund(e.message);
    await sql`update scenes set anim_status = 'error', anim_error = ${e.message} where id = ${s.id}`;
    emit(p.owner_id, 'scene', { projectId: p.id, sceneId: s.id });
    throw e;
  }
}, { concurrency: 1 });
