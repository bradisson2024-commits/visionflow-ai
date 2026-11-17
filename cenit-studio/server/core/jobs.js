// Cola de trabajos en segundo plano sobre PostgreSQL (FOR UPDATE SKIP LOCKED): varios procesos trabajadores
// pueden compartirla; un trabajo bloqueado más de 30 min (proceso caído) vuelve a la cola.
import { sql } from '../db/index.js';
import { emit } from './events.js';

const handlers = new Map();
let running = 0, timer = null;

export const defineJob = (kind, fn, { concurrency = 1 } = {}) => handlers.set(kind, { fn, concurrency });

export async function enqueue(kind, payload, { ownerId = null, projectId = null, runAt = null } = {}) {
  const [j] = await sql`insert into jobs(owner_id, project_id, kind, payload, run_at) values (${ownerId}, ${projectId}, ${kind}, ${sql.json(payload)}, ${runAt || sql`now()`}) returning *`;
  emit(ownerId, 'job', { job: j });
  setImmediate(tick);
  return j;
}

export async function progress(job, value, message) {
  await sql`update jobs set progress = ${value}, message = ${message ?? null} where id = ${job.id}`;
  emit(job.owner_id, 'job', { job: { ...job, status: 'en_curso', progress: value, message } });
}

async function claim(kinds) {
  const [j] = await sql`
    update jobs set status = 'en_curso', locked_at = now(), attempts = attempts + 1
    where id = (select id from jobs where status = 'en_cola' and run_at <= now() and kind = any(${kinds})
                order by run_at, id for update skip locked limit 1)
    returning *`;
  return j;
}

async function runOne(j) {
  const h = handlers.get(j.kind);
  emit(j.owner_id, 'job', { job: j });
  try {
    const msg = await h.fn(j, { progress: (v, m) => progress(j, v, m) });
    const [done] = await sql`update jobs set status = 'hecho', progress = 1, message = ${msg ?? null}, finished_at = now() where id = ${j.id} returning *`;
    emit(j.owner_id, 'job', { job: done });
  } catch (e) {
    const [fail] = await sql`update jobs set status = 'error', message = ${e.message}, finished_at = now() where id = ${j.id} returning *`;
    emit(j.owner_id, 'job', { job: fail });
  }
}

export async function tick() {
  const max = [...handlers.values()].reduce((a, h) => a + h.concurrency, 0);
  while (running < max) {
    const free = [...handlers.entries()].filter(([k, h]) => (runningByKind.get(k) || 0) < h.concurrency).map(([k]) => k);
    if (!free.length) return;
    const j = await claim(free);
    if (!j) return;
    running++; runningByKind.set(j.kind, (runningByKind.get(j.kind) || 0) + 1);
    runOne(j).finally(() => { running--; runningByKind.set(j.kind, runningByKind.get(j.kind) - 1); setImmediate(tick); });
  }
}
const runningByKind = new Map();

export async function startWorker() {
  await sql`update jobs set status = 'en_cola', locked_at = null, message = 'Reanudado tras reinicio' where status = 'en_curso' and locked_at < now() - interval '30 minutes'`;
  timer = setInterval(() => tick().catch(() => {}), 1500);
  timer.unref?.();
  await tick();
}
export const stopWorker = () => clearInterval(timer);

/** Espera a que no queden trabajos pendientes (pruebas). */
export async function idle(timeoutMs = 600000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const [{ n }] = await sql`select count(*)::int as n from jobs where status in ('en_cola','en_curso') and run_at <= now()`;
    if (!n && !running) return;
    await tick();
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('La cola no terminó a tiempo');
}

/** Ejecuta el manejador de otro tipo de trabajo dentro del trabajo actual (procesos encadenados). */
export async function runInline(kind, payload, parent, onProgress) {
  const h = handlers.get(kind);
  if (!h) throw new Error(`Trabajo desconocido: ${kind}`);
  return h.fn({ id: parent.id, kind, payload, owner_id: parent.owner_id, project_id: parent.project_id }, { progress: async (v, m) => onProgress?.(v, m) });
}
