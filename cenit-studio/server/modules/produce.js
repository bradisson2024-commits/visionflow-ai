// «Terminar vídeo»: con las imágenes ya hechas, un solo trabajo genera lo que falte y exporta el MP4:
// voz (la elegida o, si no hay, una voz gratuita de Microsoft Edge en español) → subtítulos automáticos
// sincronizados (salvo que el usuario los haya desactivado) → música de la biblioteca (si no eligió ninguna
// y no la desactivó) → exportación MP4 verificada.
import { sql } from '../db/index.js';
import { AppError } from '../core/errors.js';
import { enqueue, defineJob, runInline } from '../core/jobs.js';
import { emit } from '../core/events.js';
import { own } from './projects.js';
import { catalog } from './voices.js';
import { config } from '../config.js';

const pause = (ms) => new Promise((r) => setTimeout(r, ms)); // deja ver cada paso en pantalla
const PREFERRED_EDGE = ['es-MX-JorgeNeural', 'es-US-AlonsoNeural', 'es-ES-AlvaroNeural', 'es-CO-GonzaloNeural', 'es-AR-TomasNeural'];

async function defaultVoice() {
  try {
    const { voices } = await catalog();
    const edge = voices.filter((v) => v.provider === 'edge');
    const pick = PREFERRED_EDGE.map((id) => edge.find((v) => v.id === id)).find(Boolean) || edge.find((v) => v.language === 'es');
    if (pick) return { provider: 'edge', voiceId: pick.id, engine: 'edge', speed: 1, pitch: 0 };
  } catch { /* sin catálogo de Edge */ }
  if (config.geminiKey) return { provider: 'gemini', voiceId: 'Charon', engine: 'gemini', speed: 1, pitch: 0 };
  throw new AppError(400, 'No hay ninguna voz disponible: elige una en la pestaña Voz.');
}

export async function requestProduce(user, projectId, { resolution = '1080p', music = true } = {}) {
  const p = await own(user, projectId);
  const scenes = await sql`select idx, image_status from scenes where project_id = ${p.id} order by idx`;
  if (!scenes.length) throw new AppError(400, 'Primero divide el guion en escenas.');
  const missing = scenes.filter((s) => s.image_status !== 'lista').map((s) => s.idx);
  if (missing.length) throw new AppError(400, `Faltan imágenes en ${missing.length} escena(s): ${missing.slice(0, 15).join(', ')}${missing.length > 15 ? '…' : ''}.`);
  return enqueue('proyecto.producir', { projectId: p.id, resolution, music }, { ownerId: user.id, projectId: p.id });
}

defineJob('proyecto.producir', async (job, { progress }) => {
  const id = job.payload.projectId;
  const step = async (f, msg) => { await progress(f, msg); emit(job.owner_id, 'project', { projectId: id, step: msg }); };
  let [p] = await sql`select * from projects where id = ${id}`;

  // 1) Voz
  if (p.voice?.engine === 'audio_subido') {
    await step(0.02, 'Repartiendo tu narración por escenas…');
    await runInline('proyecto.audio_cortar', { projectId: id }, job);
  } else {
    if (!p.voice?.provider || !p.voice?.voiceId) {
      const v = await defaultVoice();
      await sql`update projects set voice = ${sql.json({ ...(p.voice || {}), ...v })}, updated_at = now() where id = ${id}`;
    }
    const todo = await sql`select id from scenes where project_id = ${id} and audio_status <> 'lista' order by idx`;
    if (todo.length) {
      await step(0.03, `Generando la voz (${todo.length} escenas)…`);
      for (const s of todo) await sql`update scenes set audio_status = 'en_cola', audio_error = null where id = ${s.id}`;
      await runInline('proyecto.voz', { projectId: id, sceneIds: todo.map((s) => s.id) }, job, (v, m) => step(0.03 + v * 0.5, m));
    }
  }

  // 2) Subtítulos: automáticos y sincronizados con la voz en la exportación, salvo que estén desactivados.
  [p] = await sql`select * from projects where id = ${id}`;
  if (p.subtitles?.enabled === undefined) await sql`update projects set subtitles = ${sql.json({ ...(p.subtitles || {}), enabled: true })} where id = ${id}`;
  await step(0.55, p.subtitles?.enabled === false ? 'Subtítulos desactivados en tu proyecto.' : 'Subtítulos automáticos sincronizados con la voz.');
  await pause(2500);

  // 3) Música de fondo
  if (job.payload.music !== false && !p.music?.trackId && p.music?.enabled !== false) {
    const [t] = await sql`select id, title from music_tracks where owner_id is null and kind = 'musica' order by (mood ilike '%suspense%' or mood ilike '%misterio%' or mood ilike '%épic%') desc, title limit 1`;
    if (t) {
      await sql`update projects set music = ${sql.json({ ...(p.music || {}), trackId: t.id, volume: 0.18, fadeIn: 2, fadeOut: 3, ducking: true })} where id = ${id}`;
    }
  }
  [p] = await sql`select * from projects where id = ${id}`;
  await step(0.57, p.music?.trackId ? 'Música de fondo añadida (puedes cambiarla en la pestaña Música).' : 'Sin música de fondo.');
  await pause(2500);

  // 4) MP4
  await step(0.6, 'Montando el vídeo…');
  await runInline('proyecto.render', { projectId: id, kind: 'final', resolution: job.payload.resolution || '1080p' }, job, (v, m) => step(0.6 + v * 0.4, m));
  emit(job.owner_id, 'project', { projectId: id });
  return 'Vídeo terminado: descárgalo en la pestaña Edición (⬇ Descargar MP4).';
});
