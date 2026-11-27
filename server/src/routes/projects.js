import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { all, get, run, now, uid, tx, mediaUrl, parseJSON, projectDir } from '../db.js';
import { loadProject, loadScenes, projectCast } from '../pipeline/produce.js';
import { enqueue, cancel, activeJob, lastJob, publicJob } from '../jobs.js';
import { listStyles } from '../styles.js';
import { countWords, estimateSeconds, writeScript, improveScript, suggestTitles } from '../pipeline/analyze.js';

export const projects = Router();

const DEFAULT_NARRATION = { enabled: true, provider: null, voice_id: null, voice_name: null, speed: 1, stability: 0.5, style: 0, tone: '', language: 'es' };
const DEFAULT_MUSIC = { mode: 'none', mood: 'historia', prompt: '', track_id: null, volume: 0.18 };
const DEFAULT_OPTIONS = { aspect: '16:9', review_storyboard: false, avatar_id: null, transition: null, camera_motion: null, resolution: null };

function sceneOut(s) {
  return {
    id: s.id, idx: s.idx, narration: s.narration, visual_description: s.visual_description, characters: s.characters,
    action: s.action, location: s.location, emotion: s.emotion, shot: s.shot, camera: s.camera, lighting: s.lighting,
    image_prompt: s.image_prompt, est_duration: s.est_duration, duration: s.duration, audio_duration: s.audio_duration,
    image_url: s.image_path && fs.existsSync(s.image_path) ? mediaUrl(s.image_path) : null,
    audio_url: s.audio_path && fs.existsSync(s.audio_path) ? mediaUrl(s.audio_path) : null,
    image_error: s.image_error,
  };
}

function thumbOf(p) {
  const t = path.join(projectDir(p.id), 'thumbnail.jpg');
  if (fs.existsSync(t)) return mediaUrl(t);
  const first = get('SELECT image_path FROM scenes WHERE project_id = ? AND image_path IS NOT NULL ORDER BY idx LIMIT 1', p.id);
  return first?.image_path && fs.existsSync(first.image_path) ? mediaUrl(first.image_path) : null;
}

export function projectSummary(p) {
  const style = listStyles().find(s => s.id === p.style_id);
  const sc = get('SELECT COUNT(*) AS n, SUM(image_path IS NOT NULL) AS imgs FROM scenes WHERE project_id = ?', p.id);
  return {
    id: p.id, title: p.title, status: p.status, error: p.error, style_id: p.style_id, style_name: style?.name || null,
    duration: p.duration, words: countWords(p.script), scene_count: sc.n, images: sc.imgs || 0,
    thumbnail_url: thumbOf(p),
    video_url: p.video_path && fs.existsSync(p.video_path) ? mediaUrl(p.video_path) : null,
    created_at: p.created_at, updated_at: p.updated_at,
    job: publicJob(activeJob(p.id)),
  };
}

function projectFull(id) {
  const p = loadProject(id);
  const cast = [...projectCast(id, p.style_id).values()].map(c => ({ id: c.id, key: c.char_key, name: c.name, description: c.description, role: c.role, ref_url: c.ref && fs.existsSync(c.ref) ? mediaUrl(c.ref) : null }));
  return {
    ...projectSummary(p),
    script: p.script,
    narration: { ...DEFAULT_NARRATION, ...p.narration },
    music: { ...DEFAULT_MUSIC, ...p.music },
    options: { ...DEFAULT_OPTIONS, ...p.options },
    analysis: p.analysis,
    scenes: loadScenes(id).map(sceneOut),
    cast,
    music_url: p.music_path && fs.existsSync(p.music_path) ? mediaUrl(p.music_path) : null,
    last_job: publicJob(lastJob(id)),
  };
}

function setCast(projectId, characterIds) {
  const current = all('SELECT * FROM project_characters WHERE project_id = ?', projectId);
  const keep = new Set(characterIds);
  for (const c of current) if (!keep.has(c.character_id)) run('DELETE FROM project_characters WHERE project_id = ? AND character_id = ?', projectId, c.character_id);
  const have = new Set(current.map(c => c.character_id));
  const usedKeys = new Set(current.map(c => c.char_key));
  for (const cid of characterIds) {
    if (have.has(cid)) continue;
    const ch = get('SELECT * FROM characters WHERE id = ?', cid);
    if (!ch) continue;
    let key = ch.name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'personaje';
    while (usedKeys.has(key)) key += '_2';
    usedKeys.add(key);
    run('INSERT INTO project_characters(project_id, character_id, char_key) VALUES(?,?,?)', projectId, cid, key);
  }
}

projects.get('/', (req, res) => {
  res.json(all('SELECT * FROM projects ORDER BY updated_at DESC').map(projectSummary));
});

projects.post('/', (req, res) => {
  const b = req.body || {};
  const id = uid('prj_');
  run(`INSERT INTO projects(id, title, script, style_id, narration_json, music_json, options_json, status, created_at, updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)`,
    id, (b.title || 'Video sin título').trim(), b.script || '', b.style_id || '2d-stickman',
    JSON.stringify({ ...DEFAULT_NARRATION, ...(b.narration || {}) }), JSON.stringify({ ...DEFAULT_MUSIC, ...(b.music || {}) }),
    JSON.stringify({ ...DEFAULT_OPTIONS, ...(b.options || {}) }), 'draft', now(), now());
  if (Array.isArray(b.character_ids)) setCast(id, b.character_ids);
  res.status(201).json(projectFull(id));
});

projects.get('/:id', (req, res) => res.json(projectFull(req.params.id)));

projects.put('/:id', (req, res) => {
  const p = loadProject(req.params.id);
  if (activeJob(p.id)) return res.status(409).json({ error: 'No se puede editar mientras se genera el video.' });
  const b = req.body || {};
  const narration = { ...p.narration, ...(b.narration || {}) };
  const music = { ...p.music, ...(b.music || {}) };
  const options = { ...p.options, ...(b.options || {}) };
  const script = b.script ?? p.script;
  const style = b.style_id ?? p.style_id;
  tx(() => {
    // Un guion o estilo distinto invalida el storyboard/imágenes; una voz distinta invalida la narración.
    if (script !== p.script) run('DELETE FROM scenes WHERE project_id = ?', p.id);
    else if (style !== p.style_id) run('UPDATE scenes SET image_path = NULL WHERE project_id = ?', p.id);
    const voiceKeys = ['enabled', 'provider', 'voice_id', 'speed', 'stability', 'style', 'tone', 'language'];
    if (voiceKeys.some(k => JSON.stringify(narration[k]) !== JSON.stringify(p.narration[k]))) {
      run('UPDATE scenes SET audio_path = NULL, audio_duration = NULL WHERE project_id = ?', p.id);
      for (const s of loadScenes(p.id)) run('UPDATE scenes SET est_duration = ? WHERE id = ?', estimateSeconds(s.narration, narration.speed), s.id);
    }
    const changed = script !== p.script || style !== p.style_id || JSON.stringify(narration) !== JSON.stringify(p.narration) || JSON.stringify(music) !== JSON.stringify(p.music) || JSON.stringify(options) !== JSON.stringify(p.options);
    const status = changed && ['done', 'outdated'].includes(p.status) ? 'outdated' : p.status;
    run(`UPDATE projects SET title=?, script=?, style_id=?, narration_json=?, music_json=?, options_json=?, status=?, updated_at=? WHERE id=?`,
      (b.title ?? p.title).trim() || 'Video sin título', script, style, JSON.stringify(narration), JSON.stringify(music), JSON.stringify(options), status, now(), p.id);
    if (Array.isArray(b.character_ids)) setCast(p.id, b.character_ids);
  });
  res.json(projectFull(p.id));
});

projects.delete('/:id', (req, res) => {
  const p = loadProject(req.params.id);
  const j = activeJob(p.id);
  if (j) cancel(j.id);
  run('DELETE FROM projects WHERE id = ?', p.id);
  fs.rmSync(projectDir(p.id), { recursive: true, force: true });
  res.json({ ok: true });
});

projects.post('/:id/duplicate', (req, res) => {
  const p = loadProject(req.params.id);
  const id = uid('prj_');
  const srcDir = projectDir(p.id), dstDir = projectDir(id);
  const remap = f => (f && f.startsWith(srcDir) && fs.existsSync(f) ? path.join(dstDir, path.relative(srcDir, f)) : f);
  for (const sub of ['images', 'audio']) if (fs.existsSync(path.join(srcDir, sub))) fs.cpSync(path.join(srcDir, sub), path.join(dstDir, sub), { recursive: true });
  tx(() => {
    run(`INSERT INTO projects(id, title, script, style_id, narration_json, music_json, options_json, analysis_json, status, music_path, created_at, updated_at)
         VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`, id, `${p.title} (copia)`, p.script, p.style_id, p.narration_json, p.music_json, p.options_json, p.analysis_json,
      loadScenes(p.id).length ? 'storyboard' : 'draft', p.music_path, now(), now());
    for (const s of loadScenes(p.id)) {
      run(`INSERT INTO scenes(id, project_id, idx, narration, visual_description, characters_json, action, location, emotion, shot, camera, lighting, image_prompt, est_duration, image_path, audio_path, audio_duration, duration, updated_at)
           VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, uid('scn_'), id, s.idx, s.narration, s.visual_description, s.characters_json, s.action, s.location, s.emotion, s.shot, s.camera, s.lighting,
        s.image_prompt, s.est_duration, remap(s.image_path), remap(s.audio_path), s.audio_duration, s.duration, now());
    }
    for (const c of all('SELECT * FROM project_characters WHERE project_id = ?', p.id)) run('INSERT INTO project_characters(project_id, character_id, char_key) VALUES(?,?,?)', id, c.character_id, c.char_key);
  });
  res.status(201).json(projectFull(id));
});

// ---- Generación ----
projects.post('/:id/generate', (req, res) => {
  const p = loadProject(req.params.id);
  res.status(202).json(enqueue(p.id, 'produce', { reanalyze: !!req.body?.reanalyze }));
});
projects.post('/:id/storyboard', (req, res) => {
  const p = loadProject(req.params.id);
  res.status(202).json(enqueue(p.id, 'storyboard'));
});
projects.post('/:id/continue', (req, res) => {
  const p = loadProject(req.params.id);
  res.status(202).json(enqueue(p.id, 'produce', { approved: true }));
});
projects.post('/:id/extend', (req, res) => {
  const p = loadProject(req.params.id);
  if (!req.body?.text?.trim()) return res.status(400).json({ error: 'Escribe el texto de la continuación.' });
  res.status(202).json(enqueue(p.id, 'extend', { text: req.body.text }));
});
projects.post('/:id/cancel', (req, res) => {
  const j = activeJob(req.params.id);
  if (!j) return res.status(404).json({ error: 'No hay ninguna generación en curso.' });
  cancel(j.id);
  res.json({ ok: true });
});

// ---- Escenas ----
projects.put('/:id/scenes/:sid', (req, res) => {
  const p = loadProject(req.params.id);
  if (activeJob(p.id)) return res.status(409).json({ error: 'Espera a que termine la generación en curso.' });
  const s = get('SELECT * FROM scenes WHERE id = ? AND project_id = ?', req.params.sid, p.id);
  if (!s) return res.status(404).json({ error: 'Escena no encontrada' });
  const b = req.body || {};
  const fields = ['narration', 'visual_description', 'action', 'location', 'emotion', 'shot', 'camera', 'lighting', 'image_prompt'];
  const val = Object.fromEntries(fields.map(f => [f, b[f] ?? s[f]]));
  const chars = Array.isArray(b.characters) ? JSON.stringify(b.characters) : s.characters_json;
  const narrationChanged = val.narration !== s.narration;
  const imageChanged = val.image_prompt !== s.image_prompt || chars !== s.characters_json || val.shot !== s.shot || val.lighting !== s.lighting || val.emotion !== s.emotion;
  run(`UPDATE scenes SET narration=?, visual_description=?, action=?, location=?, emotion=?, shot=?, camera=?, lighting=?, image_prompt=?, characters_json=?,
       audio_path=CASE WHEN ? THEN NULL ELSE audio_path END, audio_duration=CASE WHEN ? THEN NULL ELSE audio_duration END,
       image_path=CASE WHEN ? THEN NULL ELSE image_path END, est_duration=?, updated_at=? WHERE id=?`,
    val.narration, val.visual_description, val.action, val.location, val.emotion, val.shot, val.camera, val.lighting, val.image_prompt, chars,
    narrationChanged ? 1 : 0, narrationChanged ? 1 : 0, imageChanged && b.clear_image ? 1 : 0, estimateSeconds(val.narration, p.narration.speed), now(), s.id);
  if (narrationChanged) {
    // El guion del proyecto se mantiene igual a la suma de las narraciones.
    const script = loadScenes(p.id).map(x => x.narration).join('\n\n');
    run('UPDATE projects SET script = ? WHERE id = ?', script, p.id);
  }
  if (['done', 'outdated'].includes(p.status)) run(`UPDATE projects SET status='outdated', updated_at=? WHERE id=?`, now(), p.id);
  res.json(projectFull(p.id));
});
projects.post('/:id/scenes/:sid/image', (req, res) => {
  const p = loadProject(req.params.id);
  res.status(202).json(enqueue(p.id, 'scene_image', { scene_id: req.params.sid }));
});
projects.post('/:id/scenes/:sid/audio', (req, res) => {
  const p = loadProject(req.params.id);
  res.status(202).json(enqueue(p.id, 'scene_audio', { scene_id: req.params.sid }));
});

projects.get('/:id/download', (req, res) => {
  const p = loadProject(req.params.id);
  if (!p.video_path || !fs.existsSync(p.video_path)) return res.status(404).json({ error: 'El video aún no está renderizado.' });
  const safe = p.title.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '_') || 'video';
  res.download(p.video_path, `${safe}.mp4`, { dotfiles: 'allow' });
});

projects.get('/:id/files', (req, res) => {
  const p = loadProject(req.params.id);
  const dir = projectDir(p.id);
  const files = [];
  const walk = d => {
    for (const f of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, f.name);
      if (f.isDirectory()) { if (f.name !== 'render') walk(full); }
      else files.push({ name: path.relative(dir, full), size: fs.statSync(full).size, url: mediaUrl(full) });
    }
  };
  if (fs.existsSync(dir)) walk(dir);
  res.json(files);
});

export const script = Router();
script.post('/generate', async (req, res) => {
  const b = req.body || {};
  const text = await writeScript({ title: b.title, idea: b.idea, minutes: Math.min(30, Math.max(0.5, Number(b.minutes) || 3)), tone: b.tone, language: b.language || 'es' });
  res.json({ script: text, words: countWords(text) });
});

script.post('/improve', async (req, res) => {
  const b = req.body || {};
  if (!b.script?.trim()) return res.status(400).json({ error: 'No hay guion que mejorar.' });
  const text = await improveScript({ script: b.script, instructions: b.instructions, language: b.language || 'es' });
  res.json({ script: text, words: countWords(text) });
});
script.post('/titles', async (req, res) => {
  const b = req.body || {};
  if (!b.title?.trim() && !b.script?.trim()) return res.status(400).json({ error: 'Escribe un título o un guion primero.' });
  res.json({ titles: await suggestTitles({ title: b.title, script: b.script, language: b.language || 'es' }) });
});

export { parseJSON };
