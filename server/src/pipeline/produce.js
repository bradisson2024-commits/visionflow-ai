// Orquestación completa: guion → escenas → personajes → storyboard → imágenes → voz → música → montaje → render.
// Cada etapa es idempotente: si se interrumpe, al reanudar solo se genera lo que falta.
import fs from 'node:fs';
import path from 'node:path';
import { all, get, run, now, uid, tx, parseJSON, projectDir, mediaSubdir } from '../db.js';
import { getSettings } from '../settings.js';
import { getStyle, styleBlock } from '../styles.js';
import { analyzeScript, buildScenePrompt, estimateSeconds } from './analyze.js';
import { generateImage } from '../providers/image.js';
import { synthesize, composeMusic, MUSIC_MOODS } from '../providers/audio.js';
import { probeDuration } from '../media.js';
import { renderVideo, makeThumbnail } from './render.js';
import { registerHandler } from '../jobs.js';

export function loadProject(id) {
  const p = get('SELECT * FROM projects WHERE id = ?', id);
  if (!p) throw Object.assign(new Error('Proyecto no encontrado'), { status: 404 });
  p.narration = parseJSON(p.narration_json, {});
  p.music = parseJSON(p.music_json, {});
  p.options = parseJSON(p.options_json, {});
  p.analysis = parseJSON(p.analysis_json, null);
  return p;
}

export function loadScenes(projectId) {
  return all('SELECT * FROM scenes WHERE project_id = ? ORDER BY idx', projectId).map(s => ({ ...s, characters: parseJSON(s.characters_json, []) }));
}

/** Personajes del proyecto: key → { id, name, description, role, ref (ruta de referencia en el estilo actual) } */
export function projectCast(projectId, styleId) {
  const rows = all(`SELECT c.*, pc.char_key, r.image_path AS ref FROM project_characters pc
    JOIN characters c ON c.id = pc.character_id
    LEFT JOIN character_refs r ON r.character_id = c.id AND r.style_id = ?
    WHERE pc.project_id = ?`, styleId, projectId);
  return new Map(rows.map(r => [r.char_key, r]));
}

function setProject(id, fields) {
  const keys = Object.keys(fields);
  run(`UPDATE projects SET ${keys.map(k => `${k} = ?`).join(', ')}, updated_at = ? WHERE id = ?`, ...keys.map(k => fields[k]), now(), id);
}

async function pool(items, limit, fn, signal) {
  let i = 0;
  const errors = [];
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      if (signal?.aborted) return;
      const item = items[i++];
      try { await fn(item); } catch (e) { if (signal?.aborted) return; errors.push({ item, error: e }); }
    }
  });
  await Promise.all(workers);
  if (signal?.aborted) throw signal.reason || new Error('Cancelado');
  return errors;
}

// ---------- Etapas ----------

async function stageAnalyze(p, ctx) {
  const style = getStyle(p.style_id);
  ctx.stage('analyzing', 1);
  const cast = projectCast(p.id, p.style_id);
  const saved = [...cast.values()].map(c => ({ key: c.char_key, name: c.name, description: c.description, role: c.role }));
  const result = await analyzeScript({ title: p.title, script: p.script, style, savedCharacters: saved, language: p.narration.language || getSettings().language, signal: ctx.signal });
  ctx.tick(1, 1);
  ctx.log(`Guion analizado: ${result.scenes.length} escenas, ${result.characters.length} personajes.`);

  ctx.stage('scenes', result.scenes.length);
  const speed = p.narration.speed || 1;
  tx(() => {
    run('DELETE FROM scenes WHERE project_id = ?', p.id);
    // Personajes nuevos detectados → se guardan en la biblioteca de Personajes para reutilizarlos.
    for (const c of result.characters) {
      if (c.saved || cast.has(c.key)) continue;
      const cid = uid('chr_');
      run('INSERT INTO characters(id, name, description, role, origin_project_id, created_at, updated_at) VALUES(?,?,?,?,?,?,?)', cid, c.name, c.description, c.role, p.id, now(), now());
      run('INSERT INTO project_characters(project_id, character_id, char_key) VALUES(?,?,?)', p.id, cid, c.key);
    }
    for (const s of result.scenes) {
      run(`INSERT INTO scenes(id, project_id, idx, narration, visual_description, characters_json, action, location, emotion, shot, camera, lighting, image_prompt, est_duration, updated_at)
           VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        uid('scn_'), p.id, s.idx, s.narration, s.visual_description, JSON.stringify(s.characters), s.action, s.location, s.emotion, s.shot, s.camera, s.lighting, s.image_prompt,
        estimateSeconds(s.narration, speed), now());
    }
  });
  setProject(p.id, { analysis_json: JSON.stringify({ summary: result.summary, analyzed_at: now(), style_id: p.style_id }) });
  ctx.tick(result.scenes.length, result.scenes.length, `${result.scenes.length} escenas creadas`);
}

export async function generateCharacterRef(character, style, { signal } = {}) {
  const dir = mediaSubdir('characters');
  const out = path.join(dir, `${character.id}_${style.id}.png`);
  const prompt = [
    styleBlock(style),
    `CHARACTER REFERENCE SHEET of a single character, ${character.name}: ${character.description}.`,
    'Full body, standing, front three-quarter view, neutral pose, calm neutral expression, plain light neutral background, the whole figure visible, clear silhouette, consistent proportions. Only this character. No text, no labels.',
  ].join('\n');
  await generateImage({ prompt, aspect: '1:1', outPath: out, signal });
  run(`INSERT INTO character_refs(character_id, style_id, image_path, created_at) VALUES(?,?,?,?)
       ON CONFLICT(character_id, style_id) DO UPDATE SET image_path = excluded.image_path, created_at = excluded.created_at`, character.id, style.id, out, now());
  run('UPDATE characters SET updated_at = ? WHERE id = ?', now(), character.id);
  return out;
}

async function stageCharacters(p, ctx) {
  const style = getStyle(p.style_id);
  const used = new Set(loadScenes(p.id).flatMap(s => s.characters));
  const cast = projectCast(p.id, p.style_id);
  const missing = [...cast.values()].filter(c => used.has(c.char_key) && !(c.ref && fs.existsSync(c.ref)));
  ctx.stage('characters', missing.length);
  let done = 0;
  const errors = await pool(missing, Number(getSettings().image_concurrency) || 3, async c => {
    await generateCharacterRef(c, style, ctx);
    ctx.tick(++done, missing.length, `Referencia de ${c.name}`);
    ctx.log(`Referencia de personaje creada: ${c.name}`);
  }, ctx.signal);
  if (errors.length) throw new Error(`No se pudo crear la referencia de ${errors.map(e => e.item.name).join(', ')}: ${errors[0].error.message}`);
}

export async function generateSceneImage(p, scene, { signal } = {}) {
  const style = getStyle(p.style_id);
  const cast = projectCast(p.id, p.style_id);
  const chars = scene.characters.map(k => cast.get(k)).filter(Boolean);
  const aspect = p.options.aspect || '16:9';
  const prompt = buildScenePrompt({ styleText: styleBlock(style), scene, characters: chars, aspect });
  const refs = chars.map(c => c.ref).filter(r => r && fs.existsSync(r));
  const out = path.join(projectDir(p.id), 'images', `scene_${String(scene.idx).padStart(4, '0')}.png`);
  await generateImage({ prompt, refs, aspect, outPath: out, signal });
  run('UPDATE scenes SET image_path = ?, image_error = NULL, updated_at = ? WHERE id = ?', out, now(), scene.id);
  return out;
}

async function stageImages(p, ctx) {
  const scenes = loadScenes(p.id);
  const todo = scenes.filter(s => !(s.image_path && fs.existsSync(s.image_path)));
  ctx.stage('images', scenes.length);
  let done = scenes.length - todo.length;
  ctx.tick(done, scenes.length);
  const errors = await pool(todo, Number(getSettings().image_concurrency) || 3, async s => {
    try {
      await generateSceneImage(p, s, ctx);
    } catch (e) {
      run('UPDATE scenes SET image_error = ? WHERE id = ?', e.message, s.id);
      throw e;
    }
    ctx.tick(++done, scenes.length, `Imagen ${done}/${scenes.length}`);
  }, ctx.signal);
  if (errors.length) {
    throw new Error(`${errors.length} imagen(es) no se pudieron generar (escena ${errors.map(e => e.item.idx + 1).join(', ')}): ${errors[0].error.message}`);
  }
}

export async function generateSceneAudio(p, scene, scenes, { signal } = {}) {
  const out = path.join(projectDir(p.id), 'audio', `scene_${String(scene.idx).padStart(4, '0')}.mp3`);
  const prev = scenes[scene.idx - 1], next = scenes[scene.idx + 1];
  await synthesize({ text: scene.narration, voice: p.narration, outPath: out, context: { previous_text: prev?.narration, next_text: next?.narration }, signal });
  const d = await probeDuration(out);
  run('UPDATE scenes SET audio_path = ?, audio_duration = ?, updated_at = ? WHERE id = ?', out, d, now(), scene.id);
  return out;
}

async function stageVoice(p, ctx) {
  const scenes = loadScenes(p.id);
  if (!p.narration.enabled) {
    ctx.stage('voice', 0, 'Narración desactivada');
    return;
  }
  const todo = scenes.filter(s => !(s.audio_path && fs.existsSync(s.audio_path)));
  ctx.stage('voice', scenes.length);
  let done = scenes.length - todo.length;
  ctx.tick(done, scenes.length);
  // En serie para respetar los límites de concurrencia de los planes de voz.
  for (const s of todo) {
    ctx.throwIfAborted();
    await generateSceneAudio(p, s, scenes, ctx);
    ctx.tick(++done, scenes.length, `Narración ${done}/${scenes.length}`);
  }
}

function sceneDurations(p) {
  const pad = Number(getSettings().scene_padding) || 0.35;
  const scenes = loadScenes(p.id);
  for (const s of scenes) {
    const d = p.narration.enabled && s.audio_duration ? s.audio_duration + 0.12 + pad : Math.max(3, s.est_duration || estimateSeconds(s.narration));
    run('UPDATE scenes SET duration = ? WHERE id = ?', d, s.id);
    s.duration = d;
  }
  return scenes;
}

async function stageMusic(p, ctx, total) {
  const m = p.music || {};
  if (!m.mode || m.mode === 'none') { ctx.stage('music', 0, 'Sin música'); return null; }
  if (m.mode === 'track') {
    ctx.stage('music', 1);
    const t = get('SELECT * FROM music_tracks WHERE id = ?', m.track_id);
    if (!t || !fs.existsSync(t.path)) throw new Error('La pista de música seleccionada ya no existe.');
    ctx.tick(1, 1, t.name);
    return t.path;
  }
  // mode === 'generate': música IA a la medida del video (máx. 10 min; si el video es más largo se repite).
  ctx.stage('music', 1);
  const mood = MUSIC_MOODS.find(x => x.id === m.mood) || MUSIC_MOODS.find(x => x.id === 'historia');
  const prompt = m.prompt?.trim() || mood.prompt;
  const seconds = Math.min(600, Math.ceil(total) + 3);
  if (p.music_path && fs.existsSync(p.music_path) && m.generated_for === `${prompt}|${seconds}`) { ctx.tick(1, 1); return p.music_path; }
  const id = uid('mus_');
  const out = path.join(mediaSubdir('music'), `${id}.mp3`);
  await composeMusic({ prompt, seconds, outPath: out, signal: ctx.signal });
  const d = await probeDuration(out);
  run('INSERT INTO music_tracks(id, name, mood, prompt, source, path, duration, created_at) VALUES(?,?,?,?,?,?,?,?)', id, `${mood.name} — ${p.title}`, mood.id, prompt, 'ai', out, d, now());
  setProject(p.id, { music_path: out, music_json: JSON.stringify({ ...m, generated_for: `${prompt}|${seconds}`, generated_track_id: id }) });
  ctx.tick(1, 1, 'Música creada');
  ctx.log(`Música IA creada (${Math.round(d)} s).`);
  return out;
}

async function stageRender(p, ctx, scenes, musicPath) {
  const s = getSettings();
  ctx.stage('montage', scenes.length);
  const avatar = p.options.avatar_id ? get('SELECT * FROM avatars WHERE id = ?', p.options.avatar_id) : null;
  const dir = projectDir(p.id);
  const out = path.join(dir, 'video.mp4');
  const tmp = path.join(dir, 'video.tmp.mp4');
  let rendering = false;
  const res = await renderVideo({
    workDir: dir,
    scenes: scenes.map(sc => ({ image: sc.image_path, audio: p.narration.enabled ? sc.audio_path : null, duration: sc.duration, camera: sc.camera })),
    outPath: tmp,
    aspect: p.options.aspect || '16:9',
    resolution: p.options.resolution || s.resolution,
    fps: Number(s.fps) || 30,
    transition: p.options.transition || s.transition,
    motion: (p.options.camera_motion ?? s.camera_motion) !== 'off',
    music: musicPath,
    musicVolume: Number(p.music.volume ?? s.music_volume),
    ducking: s.music_ducking !== 'off',
    avatar: avatar?.image_path && fs.existsSync(avatar.image_path) ? avatar.image_path : null,
    signal: ctx.signal,
    onClip: (d, t) => ctx.tick(d, t, `Escena ${d}/${t} montada`),
    onRenderProgress: f => {
      if (!rendering) { rendering = true; ctx.stage('render', 0); }
      ctx.fraction(f, `${Math.round(f * 100)} %`);
    },
  });
  fs.renameSync(tmp, out);
  const thumb = path.join(dir, 'thumbnail.jpg');
  await makeThumbnail(scenes[0].image_path, thumb);
  setProject(p.id, { status: 'done', error: null, video_path: out, narration_path: res.narration, duration: res.duration });
  ctx.log(`Video renderizado: ${res.duration.toFixed(1)} s.`);
}

// ---------- Tareas ----------

/** Crear video completo. payload.reanalyze fuerza un nuevo análisis del guion. */
async function produce(projectId, payload, ctx) {
  let p = loadProject(projectId);
  if (!p.script.trim()) throw new Error('El guion está vacío.');
  getStyle(p.style_id);
  setProject(p.id, { status: 'processing', error: null });

  const haveScenes = loadScenes(p.id).length > 0;
  if (payload.reanalyze || !haveScenes) await stageAnalyze(p, ctx);
  p = loadProject(projectId);

  await stageCharacters(p, ctx);
  if (p.options.review_storyboard && !payload.approved) {
    setProject(p.id, { status: 'storyboard' });
    ctx.stage('storyboard', 0);
    return { stage: 'storyboard' };
  }
  await stageImages(p, ctx);
  await stageVoice(p, ctx);
  const scenes = sceneDurations(p);
  const total = scenes.reduce((a, s) => a + s.duration, 0);
  const musicPath = await stageMusic(p, ctx, total);
  p = loadProject(projectId);
  await stageRender(p, ctx, scenes, musicPath);
  return { stage: 'done' };
}

/** Solo storyboard (análisis + escenas), sin imágenes. */
async function storyboard(projectId, payload, ctx) {
  const p = loadProject(projectId);
  if (!p.script.trim()) throw new Error('El guion está vacío.');
  getStyle(p.style_id);
  setProject(p.id, { status: 'processing', error: null });
  await stageAnalyze(p, ctx);
  setProject(p.id, { status: 'storyboard' });
  ctx.stage('storyboard', 0);
  return { stage: 'storyboard' };
}

/** Regenerar la imagen de una escena concreta. */
async function sceneImage(projectId, { scene_id }, ctx) {
  const p = loadProject(projectId);
  const scene = loadScenes(projectId).find(s => s.id === scene_id);
  if (!scene) throw new Error('Escena no encontrada');
  await stageCharacters(p, ctx);
  ctx.stage('images', 1, `Regenerando imagen de la escena ${scene.idx + 1}`);
  await generateSceneImage(p, scene, ctx);
  ctx.tick(1, 1);
  markOutdated(p);
  return { stage: 'done' };
}

/** Regenerar la narración de una escena concreta. */
async function sceneAudio(projectId, { scene_id }, ctx) {
  const p = loadProject(projectId);
  const scenes = loadScenes(projectId);
  const scene = scenes.find(s => s.id === scene_id);
  if (!scene) throw new Error('Escena no encontrada');
  ctx.stage('voice', 1, `Regenerando narración de la escena ${scene.idx + 1}`);
  await generateSceneAudio(p, scene, scenes, ctx);
  ctx.tick(1, 1);
  markOutdated(p);
  return { stage: 'done' };
}

/** Si el video ya estaba renderizado y se cambia algo, queda pendiente de volver a renderizar. */
function markOutdated(p) {
  const cur = loadProject(p.id).status;
  setProject(p.id, { status: cur === 'done' || cur === 'outdated' ? 'outdated' : cur, error: null });
}

/**
 * Extensión: continúa un video existente con un nuevo fragmento de guion.
 * Se analizan solo las frases nuevas (con los mismos personajes y estilo), se añaden
 * las escenas al final y se vuelve a renderizar el video completo.
 */
async function extend(projectId, { text }, ctx) {
  let p = loadProject(projectId);
  if (!text?.trim()) throw new Error('Escribe el texto con el que quieres continuar el video.');
  const style = getStyle(p.style_id);
  setProject(p.id, { status: 'processing', error: null });
  ctx.stage('analyzing', 1, 'Analizando la continuación');
  const cast = projectCast(p.id, p.style_id);
  const saved = [...cast.values()].map(c => ({ key: c.char_key, name: c.name, description: c.description, role: c.role }));
  const prevScenes = loadScenes(p.id);
  const context = prevScenes.slice(-3).map(s => s.narration).join(' ');
  const result = await analyzeScript({ title: `${p.title} (continuación; contexto previo: «${context.slice(-600)}»)`, script: text, style, savedCharacters: saved, language: p.narration.language || getSettings().language, signal: ctx.signal });
  ctx.tick(1, 1);
  const offset = prevScenes.length;
  ctx.stage('scenes', result.scenes.length, 'Añadiendo escenas');
  tx(() => {
    for (const c of result.characters) {
      if (c.saved || cast.has(c.key)) continue;
      const cid = uid('chr_');
      run('INSERT INTO characters(id, name, description, role, origin_project_id, created_at, updated_at) VALUES(?,?,?,?,?,?,?)', cid, c.name, c.description, c.role, p.id, now(), now());
      run('INSERT INTO project_characters(project_id, character_id, char_key) VALUES(?,?,?)', p.id, cid, c.key);
    }
    for (const s of result.scenes) {
      run(`INSERT INTO scenes(id, project_id, idx, narration, visual_description, characters_json, action, location, emotion, shot, camera, lighting, image_prompt, est_duration, updated_at)
           VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        uid('scn_'), p.id, offset + s.idx, s.narration, s.visual_description, JSON.stringify(s.characters), s.action, s.location, s.emotion, s.shot, s.camera, s.lighting, s.image_prompt,
        estimateSeconds(s.narration, p.narration.speed || 1), now());
    }
    setProject(p.id, { script: p.script.trimEnd() + '\n\n' + text.trim() });
  });
  ctx.tick(result.scenes.length, result.scenes.length, `${result.scenes.length} escenas nuevas`);
  return produce(projectId, { approved: true }, ctx);
}

registerHandler('produce', produce);
registerHandler('extend', extend);
registerHandler('storyboard', storyboard);
registerHandler('scene_image', sceneImage);
registerHandler('scene_audio', sceneAudio);
