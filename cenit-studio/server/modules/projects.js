// Proyectos de vídeo: creación por modalidad, guion, ritmo, división en escenas, casting y estimaciones.
import { sql } from '../db/index.js';
import { AppError } from '../core/errors.js';
import { enqueue, defineJob } from '../core/jobs.js';
import { emit } from '../core/events.js';
import { charge, cost } from '../core/credits.js';
import { put, scratch } from '../core/storage.js';
import { getStyle } from './styles.js';
import { TEMPLATES } from './templates.js';
import * as W from './writer.js';
import { duration as mediaDuration } from '../services/ffmpeg.js';

export const RHYTHMS = { rapido: 4, normal: 5, lento: 8 };
const FORMATS = ['9:16', '16:9', '1:1'];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export async function own(user, id) {
  if (!UUID.test(String(id))) throw new AppError(404, 'Proyecto no encontrado');
  const [p] = await sql`select * from projects where id = ${id} and owner_id = ${user.id}`;
  if (!p) throw new AppError(404, 'Proyecto no encontrado');
  return p;
}

export async function full(user, id) {
  const p = await own(user, id);
  const style = await getStyle(p.style_id);
  const scenes = await sql`select * from scenes where project_id = ${id} order by idx`;
  const cast = await sql`select * from characters where project_id = ${id} order by created_at`;
  const jobs = await sql`select id, kind, status, progress, message, payload, created_at from jobs where project_id = ${id} order by id desc limit 30`;
  const est = await estimate(p, scenes.length || null);
  const dur = scenes.reduce((a, s) => a + (s.duration_sec || s.audio_sec || p.rhythm.seconds), 0);
  return { ...p, style, scenes, cast, jobs, estimate: est, summary: { scenes: scenes.length, durationSec: Math.round(dur || W.words(p.script) / W.WPM * 60) } };
}

export async function list(user) {
  return sql`select p.id, p.title, p.mode, p.format, p.style_id, p.status, p.updated_at, p.export_path, s.name as style_name,
    (select count(*)::int from scenes x where x.project_id = p.id) as scenes,
    (select image_path from scenes x where x.project_id = p.id and image_path is not null order by idx limit 1) as cover
    from projects p join styles s on s.id = p.style_id where p.owner_id = ${user.id} order by p.updated_at desc`;
}

export async function create(user, b) {
  if (!['guion', 'idea', 'url', 'audio'].includes(b.mode)) throw new AppError(400, 'Modalidad no válida');
  if (!FORMATS.includes(b.format)) throw new AppError(400, 'Formato no válido');
  const style = await getStyle(b.style_id);
  if (!style) throw new AppError(400, 'Estilo no válido');
  if (b.mode === 'guion' && W.words(b.script) < 20) throw new AppError(400, 'Pega un guion de al menos 20 palabras.');
  if (b.mode === 'idea' && !String(b.idea || '').trim()) throw new AppError(400, 'Escribe una idea o palabra clave.');
  if (b.mode === 'url' && !/^https?:\/\//.test(b.url || '')) throw new AppError(400, 'Pega una URL válida.');
  const title = String(b.title || b.idea || (b.script || '').split(/[.!?]/)[0] || b.url || 'Nuevo vídeo').slice(0, 90);
  const rhythm = { preset: b.rhythm || 'normal', seconds: RHYTHMS[b.rhythm] || Number(b.seconds) || 5 };
  const [p] = await sql`insert into projects(owner_id, title, mode, format, style_id, template, idea, script, rhythm, source, status)
    values (${user.id}, ${title}, ${b.mode}, ${b.format}, ${style.id}, ${b.template || null}, ${b.idea || null}, ${b.mode === 'guion' ? b.script.trim() : null}, ${sql.json(rhythm)},
      ${b.mode === 'url' ? sql.json({ url: b.url }) : null}, 'borrador') returning *`;
  if (b.mode === 'url') await enqueue('proyecto.url', { projectId: p.id }, { ownerId: user.id, projectId: p.id });
  return p;
}

export async function update(user, id, b) {
  const p = await own(user, id);
  const allowed = ['title', 'template', 'idea', 'script', 'format', 'style_id', 'voice', 'subtitles', 'music', 'edit'];
  const set = {};
  for (const k of allowed) if (b[k] !== undefined) set[k] = b[k];
  if (b.rhythm) set.rhythm = { preset: b.rhythm.preset, seconds: b.rhythm.preset === 'lento' ? Math.max(5, Math.min(20, Number(b.rhythm.seconds) || 8)) : RHYTHMS[b.rhythm.preset] || 5 };
  if (set.format && !FORMATS.includes(set.format)) throw new AppError(400, 'Formato no válido');
  if (set.style_id && !(await getStyle(set.style_id))) throw new AppError(400, 'Estilo no válido');
  if (!Object.keys(set).length) return p;
  const [u] = await sql`update projects set ${sql(Object.fromEntries(Object.entries(set).map(([k, v]) => [k, typeof v === 'object' && v !== null ? sql.json(v) : v])))}, updated_at = now() where id = ${p.id} returning *`;
  emit(user.id, 'project', { projectId: id });
  return u;
}

/** Estimación de escenas y créditos según el proveedor y las tarifas configuradas. */
export async function estimate(p, sceneCount = null) {
  const n = sceneCount || Math.max(1, Math.round((W.words(p.script || p.idea || '') / W.WPM) * 60 / (p.rhythm?.seconds || 5)));
  const img = await cost('imagen.generar', n);
  const veo = await cost('video.veo', n * Math.min(8, p.rhythm?.seconds || 5));
  const words = W.words(p.script || '');
  const voiceOp = `voz.${p.voice?.engine || 'gemini'}`;
  const voice = await cost(voiceOp in { 'voz.gemini': 1, 'voz.edge': 1, 'voz.elevenlabs': 1 } ? voiceOp : 'voz.gemini', words);
  return { scenes: n, imageCredits: img, animateAllCredits: veo, voiceCredits: voice };
}

// ------------------------------------------------------------------ guion
export async function generateScript(user, id, { topic, template, minutes }) {
  const p = await own(user, id);
  const t = String(topic || p.idea || '').trim();
  if (!t) throw new AppError(400, 'Escribe la idea o palabra clave.');
  const ch = await charge(user.id, 'texto.guion', 1, { topic: t }, p.id);
  try {
    const script = await W.generateScript({ topic: t, template: template || p.template, minutes: Number(minutes) || 3, reference: p.source?.analysis });
    return update(user, id, { script, idea: t, template: template || p.template, title: p.title === 'Nuevo vídeo' ? t.slice(0, 90) : p.title });
  } catch (e) { await ch.refund(e.message); throw e; }
}

export async function improveIdea(user, id, idea) {
  const p = await own(user, id);
  const ch = await charge(user.id, 'texto.guion', 1, { improve: true }, p.id);
  try { return await W.improveIdea(idea || p.idea, p.template); } catch (e) { await ch.refund(e.message); throw e; }
}

// ------------------------------------------------------------------ escenas
export async function requestSplit(user, id) {
  const p = await own(user, id);
  if (p.mode !== 'audio' && W.words(p.script) < 20) throw new AppError(400, 'Primero genera o escribe el guion.');
  return enqueue('proyecto.dividir', { projectId: p.id }, { ownerId: user.id, projectId: p.id });
}

defineJob('proyecto.dividir', async (job, { progress }) => {
  const [p] = await sql`select * from projects where id = ${job.payload.projectId}`;
  const style = await getStyle(p.style_id);
  await progress(0.1, 'Leyendo la historia completa…');
  const ch = await charge(p.owner_id, 'texto.analisis', 2, { split: true }, p.id);
  try {
    const script = p.mode === 'audio' ? p.source.segments.map((s) => s.text).join(' ') : p.script;
    const bible = await W.storyBible(script, style.name).catch(() => ({}));
    await progress(0.3, 'Reparto detectado; describiendo las escenas…');
    // Casting: confirmados del usuario + detectados (sin duplicar nombres)
    const existing = await sql`select * from characters where project_id = ${p.id}`;
    for (const c of bible.reparto || []) {
      if (existing.some((e) => e.name.toLowerCase() === String(c.nombre).toLowerCase())) continue;
      await sql`insert into characters(project_id, kind, name, role, description, wardrobe, traits) values (${p.id}, ${['personaje', 'animal', 'objeto', 'escenario'].includes(c.tipo) ? c.tipo : 'personaje'}, ${c.nombre}, ${c.papel || null}, ${c.descripcion_fisica || null}, ${c.vestimenta || null}, ${c.rasgos || null})`;
    }
    const cast = await sql`select * from characters where project_id = ${p.id}`;
    const onDescribe = (f) => progress(0.3 + 0.65 * f, `Describiendo escenas… ${Math.round(f * 100)}%`);
    let scenes;
    if (p.mode === 'audio') {
      const groups = W.scenesFromSegments(p.source.segments, p.rhythm.seconds);
      const vis = await W.describeScenes({ groups: groups.map((g) => g.text), bible, styleName: style.name, cast, onProgress: onDescribe });
      scenes = groups.map((g, i) => ({ ...vis[i], start: g.start, end: g.end }));
    } else {
      scenes = await W.splitScenes({ script, seconds: p.rhythm.seconds, bible, styleName: style.name, cast, onProgress: onDescribe });
    }
    await sql.begin(async (tx) => {
      await tx`delete from scenes where project_id = ${p.id}`;
      let i = 1;
      for (const s of scenes) {
        const ids = cast.filter((c) => s.cast.some((n) => n.toLowerCase() === c.name.toLowerCase())).map((c) => c.id);
        await tx`insert into scenes(project_id, idx, narration, visual, image_prompt, anim_prompt, character_ids, duration_sec)
          values (${p.id}, ${i++}, ${s.narration}, ${s.visual}, ${s.image_prompt}, ${s.anim_prompt}, ${ids}, ${null})`;
      }
      const times = p.mode === 'audio' ? scenes.map((s, k) => ({ start: k === 0 ? 0 : s.start, end: scenes[k + 1] ? scenes[k + 1].start : p.source.audioSeconds })) : null;
      await tx`update projects set bible = ${tx.json(bible)}, source = ${times ? tx.json({ ...p.source, sceneTimes: times }) : p.source ? tx.json(p.source) : null}, status = 'escenas', updated_at = now() where id = ${p.id}`;
    });
    emit(p.owner_id, 'project', { projectId: p.id });
    const pending = scenes.filter((s) => !s.described).length;
    return `${scenes.length} escenas y ${cast.length} miembros del reparto.${pending ? ` ${pending} escenas quedaron sin descripción de imagen (Gemini no respondió): revisa su «Prompt Img».` : ''}`;
  } catch (e) { await ch.refund(e.message); throw e; }
});

defineJob('proyecto.url', async (job, { progress }) => {
  const [p] = await sql`select * from projects where id = ${job.payload.projectId}`;
  await progress(0.2, 'Analizando la fuente…');
  const ch = await charge(p.owner_id, 'texto.analisis', 1, { url: p.source.url }, p.id);
  try {
    const a = await W.analyzeUrl(p.source.url);
    await sql`update projects set source = ${sql.json({ ...p.source, ...a })}, idea = ${a.analysis?.idea_original_propuesta || p.idea}, template = coalesce(template, ${a.analysis?.plantilla_sugerida || null}), title = ${(a.analysis?.idea_original_propuesta || p.title).slice(0, 90)}, updated_at = now() where id = ${p.id}`;
    emit(p.owner_id, 'project', { projectId: p.id });
    return 'Análisis listo: revisa la idea original propuesta y genera el guion.';
  } catch (e) { await ch.refund(e.message); throw e; }
});

export async function attachAudio(user, id, { filename, buffer, mime }) {
  const p = await own(user, id);
  if (p.mode !== 'audio') throw new AppError(400, 'Este proyecto no es de modalidad audio.');
  const ext = (/\.(mp3|wav|m4a|ogg|aac|flac)$/i.exec(filename || '') || [])[1];
  if (!ext) throw new AppError(400, 'Formato de audio no admitido (mp3, wav, m4a, ogg, aac, flac).');
  const key = `proyectos/${p.id}/narracion_original.${ext.toLowerCase()}`;
  const f = scratch(key);
  (await import('node:fs')).writeFileSync(f, buffer);
  let d;
  try { d = await mediaDuration(f); } catch { throw new AppError(400, 'El archivo no es un audio válido.'); }
  await put(key, f, mime);
  await sql`update projects set source = ${sql.json({ audio: key, audioSeconds: d })}, updated_at = now() where id = ${p.id}`;
  return enqueue('proyecto.audio', { projectId: p.id, mime: mime || `audio/${ext}` }, { ownerId: user.id, projectId: p.id });
}

defineJob('proyecto.audio', async (job, { progress }) => {
  const [p] = await sql`select * from projects where id = ${job.payload.projectId}`;
  await progress(0.2, 'Transcribiendo la narración…');
  const ch = await charge(p.owner_id, 'texto.analisis', 1, { transcribe: true }, p.id);
  try {
    const fs = await import('node:fs');
    const { localPath } = await import('../core/storage.js');
    const t = await W.transcribeAudio(fs.readFileSync(await localPath(p.source.audio)), job.payload.mime);
    const script = t.segments.map((s) => s.text).join(' ');
    await sql`update projects set source = ${sql.json({ ...p.source, language: t.language, segments: t.segments })}, script = ${script}, voice = ${sql.json({ ...(p.voice || {}), engine: 'audio_subido' })}, updated_at = now() where id = ${p.id}`;
    emit(p.owner_id, 'project', { projectId: p.id });
    return `${t.segments.length} frases transcritas con sus tiempos.`;
  } catch (e) { await ch.refund(e.message); throw e; }
});

// ------------------------------------------------------------------ casting
export async function saveCharacter(user, projectId, b) {
  await own(user, projectId);
  const f = { kind: ['personaje', 'animal', 'objeto', 'escenario'].includes(b.kind) ? b.kind : 'personaje', name: String(b.name || '').trim(), role: b.role || null, description: b.description || null, wardrobe: b.wardrobe || null, traits: b.traits || null, confirmed: !!b.confirmed };
  if (!f.name) throw new AppError(400, 'El personaje necesita un nombre.');
  if (b.id) {
    const [c] = await sql`update characters set ${sql(f)} where id = ${b.id} and project_id = ${projectId} returning *`;
    if (!c) throw new AppError(404, 'Personaje no encontrado');
    return c;
  }
  const [c] = await sql`insert into characters ${sql({ ...f, project_id: projectId })} returning *`;
  return c;
}
export async function deleteCharacter(user, projectId, cid) { await own(user, projectId); await sql`delete from characters where id = ${cid} and project_id = ${projectId}`; }

// ------------------------------------------------------------------ edición de escenas
export async function updateScene(user, projectId, sceneId, b) {
  await own(user, projectId);
  const allowed = ['narration', 'visual', 'image_prompt', 'anim_prompt', 'anim_mode', 'duration_sec', 'transition', 'character_ids'];
  const set = Object.fromEntries(Object.entries(b).filter(([k]) => allowed.includes(k)));
  if (set.anim_mode && !['ninguna', 'camara', 'veo'].includes(set.anim_mode)) throw new AppError(400, 'Modo de animación no válido');
  if (set.transition && !TRANSITIONS.includes(set.transition)) throw new AppError(400, 'Transición no válida');
  if (set.narration !== undefined) Object.assign(set, { audio_status: 'pendiente', audio_path: null, audio_sec: null });
  if (!Object.keys(set).length) throw new AppError(400, 'Nada que actualizar');
  const [s] = await sql`update scenes set ${sql(set)} where id = ${sceneId} and project_id = ${projectId} returning *`;
  if (!s) throw new AppError(404, 'Escena no encontrada');
  return s;
}
export const TRANSITIONS = ['corte', 'fundido', 'deslizar', 'zoom', 'disolver', 'barrido', 'circulo'];

export async function reorder(user, projectId, ids) {
  await own(user, projectId);
  await sql.begin(async (tx) => {
    let i = 1;
    for (const id of ids) await tx`update scenes set idx = ${i++} where id = ${id} and project_id = ${projectId}`;
  });
}

export async function deleteScene(user, projectId, sceneId) {
  await own(user, projectId);
  await sql.begin(async (tx) => {
    await tx`delete from scenes where id = ${sceneId} and project_id = ${projectId}`;
    const rest = await tx`select id from scenes where project_id = ${projectId} order by idx`;
    let i = 1;
    for (const r of rest) await tx`update scenes set idx = ${i++} where id = ${r.id}`;
  });
}

export { TEMPLATES };
