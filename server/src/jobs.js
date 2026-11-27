// Gestor de tareas largas. Cada generación es un "job" persistido en la base de datos
// con su etapa, contador real (hechos/total) y registro. Los clientes reciben los
// cambios por Server-Sent Events. Se ejecuta un job a la vez (los pasos internos
// pueden paralelizar llamadas a la API).
import { EventEmitter } from 'node:events';
import { get, run, now, uid } from './db.js';

export const bus = new EventEmitter();
bus.setMaxListeners(200);

export const STAGES = {
  queued: 'En cola',
  analyzing: 'Analizando guion',
  scenes: 'Creando escenas',
  characters: 'Preparando personajes',
  storyboard: 'Storyboard listo para revisar',
  images: 'Generando imágenes',
  voice: 'Preparando narración',
  music: 'Creando música',
  montage: 'Montando video',
  render: 'Renderizando',
  done: 'Finalizado',
};

const queue = [];
const controllers = new Map();
let running = null;
const handlers = {};

export function registerHandler(kind, fn) { handlers[kind] = fn; }

export function jobRow(id) { return get('SELECT * FROM jobs WHERE id = ?', id); }
export function activeJob(projectId) {
  return get(`SELECT * FROM jobs WHERE project_id = ? AND status IN ('queued','running') ORDER BY created_at DESC LIMIT 1`, projectId);
}
export function lastJob(projectId) {
  return get('SELECT * FROM jobs WHERE project_id = ? ORDER BY created_at DESC LIMIT 1', projectId);
}

function emit(id) {
  const j = jobRow(id);
  if (j) bus.emit('job', publicJob(j));
}

export function publicJob(j) {
  if (!j) return null;
  return {
    id: j.id, project_id: j.project_id, kind: j.kind, status: j.status, stage: j.stage,
    stage_label: j.stage_label || STAGES[j.stage] || j.stage, done: j.done, total: j.total,
    progress: j.progress, message: j.message, error: j.error, created_at: j.created_at, updated_at: j.updated_at,
    log: j.log.split('\n').filter(Boolean).slice(-40),
  };
}

export function enqueue(projectId, kind, payload = {}) {
  const existing = activeJob(projectId);
  if (existing) throw Object.assign(new Error('Este proyecto ya tiene una generación en curso.'), { status: 409 });
  const id = uid('job_');
  run(`INSERT INTO jobs(id, project_id, kind, status, stage, created_at, updated_at) VALUES(?,?,?,?,?,?,?)`, id, projectId, kind, 'queued', 'queued', now(), now());
  queue.push({ id, projectId, kind, payload });
  emit(id);
  setImmediate(pump);
  return publicJob(jobRow(id));
}

export function cancel(jobId) {
  const qi = queue.findIndex(q => q.id === jobId);
  if (qi >= 0) {
    queue.splice(qi, 1);
    run(`UPDATE jobs SET status='canceled', message='Cancelado', updated_at=? WHERE id=?`, now(), jobId);
    emit(jobId);
    return true;
  }
  const c = controllers.get(jobId);
  if (c) { c.abort(new Error('Cancelado por el usuario')); return true; }
  return false;
}

/** Contexto que recibe cada etapa para informar del progreso REAL. */
function makeCtx(id, signal) {
  return {
    signal,
    stage(stage, total = 0, label) {
      run(`UPDATE jobs SET stage=?, stage_label=?, done=0, total=?, progress=0, message=NULL, updated_at=? WHERE id=?`, stage, label || STAGES[stage] || stage, total, now(), id);
      this.log(`▶ ${label || STAGES[stage] || stage}${total ? ` (${total})` : ''}`);
    },
    tick(done, total, message) {
      const p = total ? Math.min(1, done / total) : 0;
      run(`UPDATE jobs SET done=?, total=?, progress=?, message=COALESCE(?, message), updated_at=? WHERE id=?`, done, total, p, message ?? null, now(), id);
      emit(id);
    },
    fraction(f, message) {
      run(`UPDATE jobs SET progress=?, message=COALESCE(?, message), updated_at=? WHERE id=?`, Math.max(0, Math.min(1, f)), message ?? null, now(), id);
      emit(id);
    },
    log(line) {
      const t = new Date().toLocaleTimeString('es-ES', { hour12: false });
      run(`UPDATE jobs SET log = log || ?, updated_at=? WHERE id=?`, `[${t}] ${line}\n`, now(), id);
      emit(id);
    },
    throwIfAborted() { if (signal.aborted) throw signal.reason || new Error('Cancelado'); },
  };
}

async function pump() {
  if (running || !queue.length) return;
  const job = queue.shift();
  running = job;
  const ctrl = new AbortController();
  controllers.set(job.id, ctrl);
  run(`UPDATE jobs SET status='running', updated_at=? WHERE id=?`, now(), job.id);
  emit(job.id);
  const ctx = makeCtx(job.id, ctrl.signal);
  try {
    const handler = handlers[job.kind];
    if (!handler) throw new Error('Tipo de tarea desconocido: ' + job.kind);
    const final = await handler(job.projectId, job.payload, ctx);
    const stage = final?.stage || 'done';
    run(`UPDATE jobs SET status='completed', stage=?, stage_label=?, progress=1, updated_at=? WHERE id=?`, stage, STAGES[stage] || stage, now(), job.id);
    ctx.log('✔ ' + (STAGES[stage] || stage));
  } catch (e) {
    const canceled = ctrl.signal.aborted;
    console.error(`[job ${job.id}]`, e);
    run(`UPDATE jobs SET status=?, error=?, updated_at=? WHERE id=?`, canceled ? 'canceled' : 'failed', e.message, now(), job.id);
    run(`UPDATE projects SET status=?, error=?, updated_at=? WHERE id=?`, canceled ? 'canceled' : 'failed', canceled ? null : e.message, now(), job.projectId);
    ctx.log((canceled ? '■ Cancelado: ' : '✖ Error: ') + e.message);
  } finally {
    controllers.delete(job.id);
    running = null;
    emit(job.id);
    bus.emit('project', job.projectId);
    setImmediate(pump);
  }
}

/** Al arrancar, los trabajos que quedaron a medias se marcan como interrumpidos (se pueden reanudar). */
export function recoverInterrupted() {
  run(`UPDATE projects SET status='failed', error='La generación se interrumpió al reiniciar el servidor. Pulsa «Reanudar».', updated_at=?
       WHERE id IN (SELECT project_id FROM jobs WHERE status IN ('queued','running'))`, now());
  run(`UPDATE jobs SET status='failed', error='Interrumpido por reinicio del servidor', updated_at=? WHERE status IN ('queued','running')`, now());
}
