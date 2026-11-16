// Proyectos en disco: projects/<id>/{project.json, escenas/, imagenes/, audio/, salida/}
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { config } from './config.js';

export const STEPS = ['datos', 'analisis', 'investigacion', 'guion', 'escenas', 'imagenes', 'coherencia', 'voz', 'montaje', 'verificacion'];

export function slug(s) {
  return String(s || 'video').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'video';
}

export const projectDir = (id) => {
  if (!/^[a-z0-9-]+$/.test(id)) throw new Error('id de proyecto no válido');
  return path.join(config.projectsDir, id);
};
export const projectPath = (id, ...p) => path.join(projectDir(id), ...p);

export function createProject(video) {
  const id = `${new Date().toISOString().slice(0, 10)}-${slug(video.title)}-${crypto.randomBytes(3).toString('hex')}`;
  for (const d of ['imagenes', 'audio', 'salida', 'escenas']) fs.mkdirSync(projectPath(id, d), { recursive: true });
  const p = {
    id, createdAt: new Date().toISOString(), updatedAt: null,
    status: 'nuevo', // nuevo | en_proceso | requiere_revision | error | terminado
    original: video,
    steps: Object.fromEntries(STEPS.map((s) => [s, { state: 'pendiente', message: '' }])),
    transcript: null, analysis: null, research: null, script: null, scenes: [], characters: null,
    voice: null, render: null, verification: null, deliverables: null, log: [],
  };
  saveProject(p);
  return p;
}

export function loadProject(id) {
  const f = projectPath(id, 'project.json');
  if (!fs.existsSync(f)) return null;
  return JSON.parse(fs.readFileSync(f, 'utf8'));
}

export function saveProject(p) {
  p.updatedAt = new Date().toISOString();
  const f = projectPath(p.id, 'project.json');
  fs.writeFileSync(`${f}.tmp`, JSON.stringify(p, null, 2));
  fs.renameSync(`${f}.tmp`, f);
}

export function listProjects() {
  if (!fs.existsSync(config.projectsDir)) return [];
  return fs.readdirSync(config.projectsDir)
    .filter((d) => fs.existsSync(path.join(config.projectsDir, d, 'project.json')))
    .map((d) => {
      const p = loadProject(d);
      return { id: p.id, title: p.script?.title || p.original?.title, originalTitle: p.original?.title, status: p.status, createdAt: p.createdAt, updatedAt: p.updatedAt, scenes: p.scenes.length };
    })
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}
