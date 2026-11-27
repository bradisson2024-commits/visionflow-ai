// Base de datos SQLite (módulo nativo node:sqlite, Node >= 22.13).
// Todo lo que el usuario crea (proyectos, escenas, personajes, avatares,
// música, trabajos y ajustes) se guarda aquí, no en el navegador.
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const DATA_DIR = path.resolve(process.env.VIMO_DATA_DIR || path.join(process.cwd(), 'data'));
export const MEDIA_DIR = path.join(DATA_DIR, 'media');
fs.mkdirSync(MEDIA_DIR, { recursive: true });

export const db = new DatabaseSync(path.join(DATA_DIR, 'vimo.sqlite'));
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

db.exec(`
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  script TEXT NOT NULL DEFAULT '',
  style_id TEXT,
  narration_json TEXT NOT NULL DEFAULT '{}',
  music_json TEXT NOT NULL DEFAULT '{}',
  options_json TEXT NOT NULL DEFAULT '{}',
  analysis_json TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  error TEXT,
  duration REAL,
  video_path TEXT,
  narration_path TEXT,
  music_path TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS scenes (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  idx INTEGER NOT NULL,
  narration TEXT NOT NULL,
  visual_description TEXT,
  characters_json TEXT NOT NULL DEFAULT '[]',
  action TEXT,
  location TEXT,
  emotion TEXT,
  shot TEXT,
  camera TEXT,
  lighting TEXT,
  image_prompt TEXT,
  est_duration REAL,
  image_path TEXT,
  image_error TEXT,
  audio_path TEXT,
  audio_duration REAL,
  duration REAL,
  updated_at TEXT
);
CREATE INDEX IF NOT EXISTS scenes_project ON scenes(project_id, idx);
CREATE TABLE IF NOT EXISTS characters (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'principal',
  origin_project_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
-- Imagen de referencia de cada personaje para cada estilo visual.
CREATE TABLE IF NOT EXISTS character_refs (
  character_id TEXT NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  style_id TEXT NOT NULL,
  image_path TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (character_id, style_id)
);
CREATE TABLE IF NOT EXISTS project_characters (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  character_id TEXT NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  char_key TEXT NOT NULL,
  PRIMARY KEY (project_id, character_id)
);
CREATE TABLE IF NOT EXISTS avatars (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  style_id TEXT,
  image_path TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS music_tracks (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  mood TEXT,
  prompt TEXT,
  source TEXT NOT NULL,
  path TEXT NOT NULL,
  duration REAL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS voice_samples (
  provider TEXT NOT NULL,
  voice_id TEXT NOT NULL,
  settings_hash TEXT NOT NULL,
  path TEXT NOT NULL,
  PRIMARY KEY (provider, voice_id, settings_hash)
);
-- Personalización de estilos: nombre/prompt de las ranuras pendientes y vistas previas generadas.
CREATE TABLE IF NOT EXISTS style_overrides (
  style_id TEXT PRIMARY KEY,
  name TEXT,
  description TEXT,
  prompt TEXT,
  palette TEXT,
  lighting TEXT,
  character_design TEXT,
  environment TEXT,
  preview_path TEXT,
  updated_at TEXT
);
CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  status TEXT NOT NULL,
  stage TEXT,
  stage_label TEXT,
  done INTEGER NOT NULL DEFAULT 0,
  total INTEGER NOT NULL DEFAULT 0,
  progress REAL NOT NULL DEFAULT 0,
  message TEXT,
  error TEXT,
  log TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
`);

export const now = () => new Date().toISOString();
export const uid = (p = '') => p + crypto.randomUUID().replace(/-/g, '').slice(0, 16);

export function get(sql, ...params) { return db.prepare(sql).get(...params); }
export function all(sql, ...params) { return db.prepare(sql).all(...params); }
export function run(sql, ...params) { return db.prepare(sql).run(...params); }

export function tx(fn) {
  db.exec('BEGIN');
  try { const r = fn(); db.exec('COMMIT'); return r; }
  catch (e) { db.exec('ROLLBACK'); throw e; }
}

export function parseJSON(s, fallback) {
  if (s == null || s === '') return fallback;
  try { return JSON.parse(s); } catch { return fallback; }
}

/** Directorio de medios de un proyecto. */
export function projectDir(projectId) {
  const d = path.join(MEDIA_DIR, 'projects', projectId);
  fs.mkdirSync(d, { recursive: true });
  return d;
}
export function mediaSubdir(name) {
  const d = path.join(MEDIA_DIR, name);
  fs.mkdirSync(d, { recursive: true });
  return d;
}
/** Convierte una ruta absoluta dentro de MEDIA_DIR en URL pública /media/... */
export function mediaUrl(abs) {
  if (!abs) return null;
  const rel = path.relative(MEDIA_DIR, abs);
  if (rel.startsWith('..')) return null;
  let v = '';
  try { v = '?v=' + Math.floor(fs.statSync(abs).mtimeMs); } catch { /* archivo ausente */ }
  return '/media/' + rel.split(path.sep).map(encodeURIComponent).join('/') + v;
}
