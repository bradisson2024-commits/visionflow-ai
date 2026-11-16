// Cola de trabajos persistente en SQLite. Un solo trabajador procesa los trabajos en orden
// (respeta los límites de las APIs). Los trabajos interrumpidos por un reinicio vuelven a la cola.
import { one, run, all } from '../db/index.js';
import { signal } from './bus.js';

const handlers = new Map();
let busy = false;
let started = false;

export function registerJob(kind, fn) { handlers.set(kind, fn); }

export function enqueue(kind, payload = {}, projectId = null) {
  const active = projectId != null && one(`SELECT id FROM jobs WHERE project_id = ? AND state IN ('en_cola','en_curso')`, projectId);
  if (active) throw Object.assign(new Error('Este proyecto ya tiene un trabajo en marcha.'), { http: 409 });
  const r = run('INSERT INTO jobs(project_id, kind, payload) VALUES(?,?,?)', projectId, kind, JSON.stringify(payload));
  const id = Number(r.lastInsertRowid);
  signal('job', { jobId: id, projectId, state: 'en_cola' });
  setImmediate(tick);
  return id;
}

export function jobProgress(id, progress, message) {
  run('UPDATE jobs SET progress = ?, message = ? WHERE id = ?', progress, message ?? null, id);
  const j = one('SELECT project_id FROM jobs WHERE id = ?', id);
  signal('job', { jobId: id, projectId: j?.project_id, state: 'en_curso', progress, message });
}

export const activeJob = (projectId) => one(`SELECT * FROM jobs WHERE project_id = ? AND state IN ('en_cola','en_curso') ORDER BY id DESC`, projectId);
export const recentJobs = (limit = 20) => all('SELECT * FROM jobs ORDER BY id DESC LIMIT ?', limit);

async function tick() {
  if (busy) return;
  const job = one(`SELECT * FROM jobs WHERE state = 'en_cola' ORDER BY id LIMIT 1`);
  if (!job) return;
  busy = true;
  run(`UPDATE jobs SET state = 'en_curso', started_at = datetime('now') WHERE id = ?`, job.id);
  signal('job', { jobId: job.id, projectId: job.project_id, state: 'en_curso' });
  let state = 'hecho', message = null;
  try {
    const fn = handlers.get(job.kind);
    if (!fn) throw new Error(`Tipo de trabajo desconocido: ${job.kind}`);
    message = (await fn(JSON.parse(job.payload || '{}'), { jobId: job.id, progress: (p, m) => jobProgress(job.id, p, m) })) || null;
  } catch (e) {
    state = 'error';
    message = e.message;
  }
  run(`UPDATE jobs SET state = ?, message = ?, progress = CASE WHEN ? = 'hecho' THEN 1 ELSE progress END, finished_at = datetime('now') WHERE id = ?`, state, message, state, job.id);
  signal('job', { jobId: job.id, projectId: job.project_id, state, message });
  busy = false;
  setImmediate(tick);
}

export function startWorker() {
  if (started) return;
  started = true;
  const n = run(`UPDATE jobs SET state = 'en_cola', message = 'Reanudado tras reiniciar la aplicación' WHERE state = 'en_curso'`).changes;
  if (n) console.log(`  ${n} trabajo(s) interrumpido(s) vuelven a la cola.`);
  setInterval(tick, 2000).unref();
  setImmediate(tick);
}

/** Espera a que la cola quede vacía (pruebas). */
export async function drain(timeoutMs = 600000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (!busy && !one(`SELECT id FROM jobs WHERE state IN ('en_cola','en_curso')`)) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error('La cola no terminó a tiempo');
}
