// «Crear vídeo inspirado en esta oportunidad»: del Radar Viral a un vídeo ORIGINAL terminado.
// 1–9 análisis del vídeo de referencia (Gemini lo ve desde YouTube, sin descargarlo) y propuesta de idea propia;
// 10 guion original; 11–12 modalidad y estilo elegidos; 13 escenas (+ reparto); imágenes; 14 voz; 15 vídeo final.
// Nunca se copian guion, imágenes, voz ni música del vídeo de referencia.
import { sql } from '../db/index.js';
import { AppError } from '../core/errors.js';
import { enqueue, defineJob, runInline } from '../core/jobs.js';
import { emit } from '../core/events.js';
import { charge } from '../core/credits.js';
import * as W from './writer.js';
import { getStyle } from './styles.js';

export async function createInspired(user, { videoId, format = '16:9', styleId, minutes = 3, voice, auto = true }) {
  if (!/^[\w-]{11}$/.test(videoId || '')) throw new AppError(400, 'Vídeo no válido');
  const style = await getStyle(styleId || 'cinematic-stickman');
  if (!style) throw new AppError(400, 'Estilo no válido');
  const url = `https://www.youtube.com/watch?v=${videoId}`;
  const [v] = await sql`select title from yt_videos where id = ${videoId}`;
  const [p] = await sql`insert into projects(owner_id, title, mode, format, style_id, source, voice, status)
    values (${user.id}, ${`Inspirado en: ${v?.title || videoId}`.slice(0, 90)}, 'url', ${format}, ${style.id}, ${sql.json({ url, fromRadar: true })}, ${sql.json(voice || {})}, 'borrador') returning *`;
  await enqueue('oportunidad.crear', { projectId: p.id, minutes, auto }, { ownerId: user.id, projectId: p.id });
  return p;
}

defineJob('oportunidad.crear', async (job, { progress }) => {
  const id = job.payload.projectId;
  const step = async (frac, msg) => { await progress(frac, msg); emit(job.owner_id, 'project', { projectId: id, step: msg }); };
  await step(0.03, 'Pasos 1–9: analizando el vídeo de referencia (gancho, estructura, ritmo, formato)…');
  await runInline('proyecto.url', { projectId: id }, job);
  let [p] = await sql`select * from projects where id = ${id}`;
  const a = p.source.analysis || {};
  await step(0.15, 'Paso 10: escribiendo un guion original…');
  const ch = await charge(p.owner_id, 'texto.guion', 1, { inspired: true }, id);
  try {
    const script = await W.generateScript({ topic: a.idea_original_propuesta || p.title, template: a.plantilla_sugerida || 'storytelling', minutes: job.payload.minutes, reference: a });
    await sql`update projects set script = ${script}, idea = ${a.idea_original_propuesta || p.idea}, template = ${a.plantilla_sugerida || 'storytelling'}, updated_at = now() where id = ${id}`;
  } catch (e) { await ch.refund(e.message); throw e; }
  if (!job.payload.auto) return 'Análisis y guion listos: revisa el proyecto y continúa en el editor.';
  await step(0.25, 'Paso 13: dividiendo en escenas y detectando el reparto…');
  await runInline('proyecto.dividir', { projectId: id }, job);
  const scenes = await sql`select id from scenes where project_id = ${id} order by idx`;
  let k = 0;
  for (const s of scenes) {
    await sql`update scenes set image_status = 'en_cola' where id = ${s.id}`;
    try { await runInline('escena.imagen', { projectId: id, sceneId: s.id }, job); } catch (e) { /* queda en error y se puede reintentar */ }
    await step(0.3 + (0.4 * ++k) / scenes.length, `Imágenes ${k}/${scenes.length}`);
  }
  const failed = await sql`select idx from scenes where project_id = ${id} and image_status <> 'lista'`;
  if (failed.length) throw new Error(`Fallaron las imágenes de las escenas ${failed.map((x) => x.idx).join(', ')}: reinténtalas en el editor y exporta.`);
  [p] = await sql`select * from projects where id = ${id}`;
  if (p.voice?.provider && p.voice?.voiceId) {
    await step(0.72, 'Paso 14: generando la voz…');
    await runInline('proyecto.voz', { projectId: id, sceneIds: scenes.map((s) => s.id) }, job);
  }
  await step(0.85, 'Paso 15: montando el vídeo…');
  await runInline('proyecto.render', { projectId: id, kind: 'final', resolution: '1080p' }, job);
  return 'Vídeo original terminado y verificado.';
});
