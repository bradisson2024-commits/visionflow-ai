// Cliente HTTP para servicios externos: reintentos con espera, tiempo límite y registro en api_log.
import { run } from '../db/index.js';

export class ExternalError extends Error {
  constructor(service, message, { status = null, retry = false } = {}) {
    super(`${service}: ${message}`);
    this.service = service;
    this.status = status;
    this.retry = retry;
    this.external = true;
  }
}

export const wait = (ms) => new Promise((r) => setTimeout(r, ms));

export function logApi(service, operation, ok, { units = 0, detail = null } = {}) {
  try { run('INSERT INTO api_log(service, operation, units, ok, detail) VALUES(?,?,?,?,?)', service, operation, units, ok ? 1 : 0, detail ? String(detail).slice(0, 500) : null); } catch { /* el registro nunca rompe una llamada */ }
}

/**
 * @returns {Promise<Response>}
 */
export async function request(service, operation, url, init = {}, { attempts = 3, timeout = 120000, units = 0 } = {}) {
  let last;
  for (let i = 1; i <= attempts; i++) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeout);
    try {
      const res = await fetch(url, { ...init, signal: ctl.signal });
      clearTimeout(timer);
      if (res.ok) { logApi(service, operation, true, { units }); return res; }
      const text = await res.text().catch(() => '');
      let msg = text.slice(0, 600);
      try { const j = JSON.parse(text); msg = j.error?.message || j.detail?.message || j.message || msg; } catch { /* texto */ }
      const retry = res.status === 429 || res.status >= 500;
      last = new ExternalError(service, `HTTP ${res.status} — ${msg}`, { status: res.status, retry });
      logApi(service, operation, false, { units, detail: last.message });
      if (!retry || i === attempts) throw last;
      const after = Number(res.headers.get('retry-after'));
      await wait(after > 0 ? after * 1000 : 3000 * i * i);
    } catch (e) {
      clearTimeout(timer);
      if (e instanceof ExternalError && !e.retry) throw e;
      if (!(e instanceof ExternalError)) {
        last = new ExternalError(service, e.name === 'AbortError' ? 'la petición superó el tiempo límite' : `sin conexión (${e.cause?.code || e.message})`, { retry: true });
        logApi(service, operation, false, { units, detail: last.message });
      }
      if (i === attempts) throw last;
      await wait(3000 * i);
    }
  }
  throw last;
}

export async function requestJson(service, operation, url, init, opts) {
  const res = await request(service, operation, url, init, opts);
  const text = await res.text();
  try { return JSON.parse(text); } catch { throw new ExternalError(service, `respuesta no válida: ${text.slice(0, 200)}`); }
}
