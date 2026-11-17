// Llamadas a servicios externos con reintentos, tiempo límite y registro (tabla api_calls).
import { sql } from '../db/index.js';
import { ServiceError } from './errors.js';

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function record(service, operation, ok, units, detail) {
  try { await sql`insert into api_calls(service, operation, units, ok, detail) values (${service}, ${operation}, ${units}, ${ok}, ${detail ? String(detail).slice(0, 500) : null})`; } catch { /* nunca rompe la llamada */ }
}

export async function call(service, operation, url, init = {}, { attempts = 3, timeout = 120000, units = 0, raw = false } = {}) {
  let last;
  for (let i = 1; i <= attempts; i++) {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), timeout);
    try {
      const res = await fetch(url, { ...init, signal: ctl.signal });
      clearTimeout(t);
      if (res.ok) { await record(service, operation, true, units); return raw ? res : await parse(service, res); }
      const text = await res.text().catch(() => '');
      let msg = text.slice(0, 500);
      try { const j = JSON.parse(text); msg = j.error?.message || j.detail?.message || j.message || msg; } catch { /* texto */ }
      const retryable = res.status === 429 || res.status >= 500;
      last = new ServiceError(service, `HTTP ${res.status}: ${msg}`, { retryable, status: res.status === 401 || res.status === 403 ? 502 : 502 });
      last.httpStatus = res.status;
      await record(service, operation, false, units, last.message);
      if (!retryable || i === attempts) throw last;
      const after = Number(res.headers.get('retry-after'));
      await sleep(after > 0 ? after * 1000 : 2500 * i * i);
    } catch (e) {
      clearTimeout(t);
      if (e instanceof ServiceError && !e.retryable) throw e;
      if (!(e instanceof ServiceError)) {
        last = new ServiceError(service, e.name === 'AbortError' ? 'tiempo de espera agotado' : `sin conexión (${e.cause?.code || e.message})`, { retryable: true });
        await record(service, operation, false, units, last.message);
      }
      if (i === attempts) throw last;
      await sleep(2500 * i);
    }
  }
  throw last;
}

async function parse(service, res) {
  const text = await res.text();
  try { return JSON.parse(text); } catch { throw new ServiceError(service, `respuesta no válida: ${text.slice(0, 160)}`); }
}
