'use strict';
// Almacenamiento propio de YOUTUBE AUTOMATIZADO: proyectos en disco.
// Estructura:  <DATA_DIR>/proyectos/<id>/{project.json, imagenes/, audio/, texto/, flow/, exportaciones/}
const fs = require('fs');
const path = require('path');
const os = require('os');

const DATA_DIR = path.resolve(process.env.YA_DATA_DIR || path.join(os.homedir(), 'YOUTUBE_AUTOMATIZADO'));
const PROJECTS_DIR = path.join(DATA_DIR, 'proyectos');
const KINDS = ['imagenes', 'audio', 'texto', 'flow', 'exportaciones'];

fs.mkdirSync(PROJECTS_DIR, { recursive: true });

function slugify(name) {
  const s = String(name || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9_-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60);
  return s || 'proyecto';
}

function safeName(name) {
  const base = path.basename(String(name || '')).replace(/[^\w.\-() ]+/g, '_').trim();
  if (!base || base === '.' || base === '..') throw new Error('Nombre de archivo no válido');
  return base;
}

function projectDir(id) {
  const clean = slugify(id);
  if (clean !== id) throw new Error('Identificador de proyecto no válido');
  const dir = path.join(PROJECTS_DIR, id);
  if (!fs.existsSync(path.join(dir, 'project.json'))) throw Object.assign(new Error('Proyecto no encontrado'), { status: 404 });
  return dir;
}

function listProjects() {
  return fs.readdirSync(PROJECTS_DIR, { withFileTypes: true })
    .filter(d => d.isDirectory() && fs.existsSync(path.join(PROJECTS_DIR, d.name, 'project.json')))
    .map(d => readProject(d.name))
    .sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
}

function createProject(name) {
  let id = slugify(name);
  let n = 2;
  while (fs.existsSync(path.join(PROJECTS_DIR, id))) id = `${slugify(name)}_${n++}`;
  const dir = path.join(PROJECTS_DIR, id);
  fs.mkdirSync(dir, { recursive: true });
  for (const k of KINDS) fs.mkdirSync(path.join(dir, k), { recursive: true });
  const now = new Date().toISOString();
  const project = { id, name: String(name || id).slice(0, 80), createdAt: now, updatedAt: now, editor: null };
  fs.writeFileSync(path.join(dir, 'project.json'), JSON.stringify(project, null, 2));
  return project;
}

// Busca un proyecto por id; si no existe lo crea (lo usa la extensión al enviar resultados).
function ensureProject(nameOrId) {
  const id = slugify(nameOrId);
  if (fs.existsSync(path.join(PROJECTS_DIR, id, 'project.json'))) return readProject(id);
  const p = createProject(nameOrId);
  return p;
}

function readProject(id) {
  const dir = projectDir(id);
  return JSON.parse(fs.readFileSync(path.join(dir, 'project.json'), 'utf8'));
}

function saveEditorState(id, editor) {
  const dir = projectDir(id);
  const p = readProject(id);
  p.editor = editor;
  p.updatedAt = new Date().toISOString();
  const tmp = path.join(dir, 'project.json.tmp');
  fs.writeFileSync(tmp, JSON.stringify(p, null, 2));
  fs.renameSync(tmp, path.join(dir, 'project.json'));
  return p;
}

function kindDir(id, kind) {
  if (!KINDS.includes(kind)) throw new Error('Tipo de archivo no válido');
  const d = path.join(projectDir(id), kind);
  fs.mkdirSync(d, { recursive: true });
  return d;
}

// Nunca sobrescribe: si el nombre existe añade " (2)", " (3)"...
function uniquePath(dir, name) {
  const ext = path.extname(name);
  const stem = name.slice(0, name.length - ext.length);
  let candidate = path.join(dir, name);
  let n = 2;
  while (fs.existsSync(candidate)) candidate = path.join(dir, `${stem} (${n++})${ext}`);
  return candidate;
}

function saveFile(id, kind, name, buffer) {
  const dir = kindDir(id, kind);
  const target = uniquePath(dir, safeName(name));
  fs.writeFileSync(target, buffer, { flag: 'wx' });
  touch(id);
  return { name: path.basename(target), path: target, size: buffer.length };
}

function listFiles(id, kind) {
  const dir = kindDir(id, kind);
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter(d => d.isFile() && !d.name.startsWith('.'))
    .map(d => {
      const st = fs.statSync(path.join(dir, d.name));
      return { name: d.name, size: st.size, mtime: st.mtime.toISOString(), path: path.join(dir, d.name) };
    })
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
}

function filePath(id, kind, name) {
  const p = path.join(kindDir(id, kind), safeName(name));
  if (!fs.existsSync(p)) throw Object.assign(new Error('Archivo no encontrado'), { status: 404 });
  return p;
}

function touch(id) {
  try {
    const dir = projectDir(id);
    const p = readProject(id);
    p.updatedAt = new Date().toISOString();
    fs.writeFileSync(path.join(dir, 'project.json'), JSON.stringify(p, null, 2));
  } catch { /* ignore */ }
}

module.exports = {
  DATA_DIR, PROJECTS_DIR, KINDS, slugify, safeName, listProjects, createProject, ensureProject,
  readProject, saveEditorState, saveFile, listFiles, filePath, kindDir, projectDir, uniquePath,
};
