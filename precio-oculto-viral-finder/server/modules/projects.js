// Biblioteca de proyectos: creación, lectura, etapas y escenas.
import fs from 'node:fs';
import { run, one, all, json, parseJson } from '../db/index.js';
import { paths } from '../core/paths.js';
import { getSetting } from '../core/settings.js';
import { signal } from '../core/bus.js';

export const STAGES = [
  ['analisis', 'Análisis del original'],
  ['propuesta', 'Versión mejorada e investigación'],
  ['guion', 'Guion'],
  ['escenas', 'Escenas y storyboard'],
  ['imagenes', 'Imágenes Stickman'],
  ['revision', 'Revisión imagen ↔ narración'],
  ['voz', 'Voz'],
  ['montaje', 'Montaje y exportación MP4'],
  ['verificacion', 'Verificación final'],
];
export const STAGE_NAMES = STAGES.map((s) => s[0]);

const slugify = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48) || 'proyecto';

export function createProject(videoId) {
  const v = one('SELECT * FROM videos WHERE id = ?', videoId);
  if (!v) throw Object.assign(new Error('Video no encontrado en la base de datos. Búscalo primero.'), { http: 404 });
  let slug = slugify(v.title);
  for (let i = 2; one('SELECT 1 FROM projects WHERE slug = ?', slug); i++) slug = `${slugify(v.title)}-${i}`;
  const r = run('INSERT INTO projects(slug, source_video, title, image_engine) VALUES(?,?,?,?)', slug, v.id, v.title, getSetting('IMAGE_ENGINE'));
  const id = Number(r.lastInsertRowid);
  for (const [name] of STAGES) run('INSERT INTO stages(project_id, name) VALUES(?,?)', id, name);
  for (const d of ['imagenes', 'audio', 'salida', 'flow']) fs.mkdirSync(paths.project(slug, d), { recursive: true });
  return getProject(id);
}

export function getProject(id) {
  const p = parseJson(one('SELECT * FROM projects WHERE id = ?', id), 'analysis', 'proposal', 'script', 'render', 'verification', 'deliverables');
  if (!p) return null;
  p.video = parseJson(one('SELECT * FROM videos WHERE id = ?', p.source_video), 'tags');
  p.stages = all('SELECT name, state, message, updated_at FROM stages WHERE project_id = ?', id)
    .sort((a, b) => STAGE_NAMES.indexOf(a.name) - STAGE_NAMES.indexOf(b.name))
    .map((s) => ({ ...s, label: STAGES.find((x) => x[0] === s.name)[1] }));
  p.scenes = getScenes(id);
  return p;
}

export const getScenes = (id) => all('SELECT * FROM scenes WHERE project_id = ? ORDER BY n', id).map((s) => parseJson(s, 'sources', 'review'));

export function listProjects() {
  return all(`SELECT p.id, p.slug, p.title, p.status, p.stage, p.image_engine, p.created_at, p.updated_at, v.title AS source_title, v.thumbnail,
      (SELECT COUNT(*) FROM scenes s WHERE s.project_id = p.id) AS scene_count
    FROM projects p LEFT JOIN videos v ON v.id = p.source_video ORDER BY p.id DESC`);
}

export function update(id, fields) {
  const keys = Object.keys(fields);
  if (!keys.length) return;
  const vals = keys.map((k) => (fields[k] !== null && typeof fields[k] === 'object' ? json(fields[k]) : fields[k]));
  run(`UPDATE projects SET ${keys.map((k) => `${k} = ?`).join(', ')}, updated_at = datetime('now') WHERE id = ?`, ...vals, id);
  signal('project', { projectId: id });
}

export function setStage(id, name, state, message = null) {
  run(`UPDATE stages SET state = ?, message = ?, updated_at = datetime('now') WHERE project_id = ? AND name = ?`, state, message, id, name);
  if (state === 'en_curso') update(id, { stage: name });
  signal('stage', { projectId: id, name, state, message });
}

/** Al rehacer una etapa, las siguientes dejan de ser válidas. */
export function resetFrom(id, name) {
  for (const s of STAGE_NAMES.slice(STAGE_NAMES.indexOf(name))) run(`UPDATE stages SET state = 'pendiente', message = NULL WHERE project_id = ? AND name = ? AND state != 'pendiente'`, id, s);
  if (STAGE_NAMES.indexOf(name) <= STAGE_NAMES.indexOf('montaje')) update(id, { verification: null, deliverables: null, status: 'en_produccion' });
}

export function updateScene(projectId, n, fields) {
  const keys = Object.keys(fields);
  const vals = keys.map((k) => (fields[k] !== null && typeof fields[k] === 'object' ? json(fields[k]) : fields[k]));
  run(`UPDATE scenes SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE project_id = ? AND n = ?`, ...vals, projectId, n);
}

export function deleteProject(id) {
  const p = one('SELECT slug FROM projects WHERE id = ?', id);
  if (!p) return false;
  run('DELETE FROM projects WHERE id = ?', id);
  fs.rmSync(paths.project(p.slug), { recursive: true, force: true });
  return true;
}
