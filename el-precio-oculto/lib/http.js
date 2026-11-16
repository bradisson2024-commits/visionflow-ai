// Ayudantes HTTP con reintentos y mensajes de error claros (nunca se inventa una respuesta).
export class ServiceError extends Error {
  constructor(service, message, { status, retriable = false } = {}) {
    super(`[${service}] ${message}`);
    this.service = service;
    this.status = status;
    this.retriable = retriable;
  }
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function fetchRetry(service, url, opts = {}, { retries = 3, timeoutMs = 120000, backoffMs = 4000 } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, { ...opts, signal: ctrl.signal });
      clearTimeout(t);
      if (res.ok) return res;
      const body = await res.text().catch(() => '');
      // 402 FREE_LIMIT = límite del plan gratuito de Pollinations: se espera y se reintenta.
      const freeLimit = res.status === 402 && /FREE_LIMIT|limit/i.test(body);
      const retriable = res.status === 429 || res.status >= 500 || freeLimit;
      lastErr = new ServiceError(service, `HTTP ${res.status}: ${body.slice(0, 400)}`, { status: res.status, retriable });
      if (!retriable || attempt === retries) throw lastErr;
      const ra = Number(res.headers.get('retry-after')) || Number(body.match(/retry after (\d+)\s*s/i)?.[1]);
      await sleep(Number.isFinite(ra) && ra > 0 ? (ra + 2) * 1000 : backoffMs * (attempt + 1));
    } catch (e) {
      clearTimeout(t);
      if (e instanceof ServiceError && !e.retriable) throw e;
      lastErr = e instanceof ServiceError ? e : new ServiceError(service, e.name === 'AbortError' ? 'tiempo de espera agotado' : `no se pudo conectar (${e.cause?.code || e.message})`, { retriable: true });
      if (attempt < retries) await sleep(backoffMs * (attempt + 1));
    }
  }
  throw lastErr;
}

export async function fetchJson(service, url, opts, retry) {
  const res = await fetchRetry(service, url, opts, retry);
  const text = await res.text();
  try { return JSON.parse(text); } catch { throw new ServiceError(service, `respuesta no JSON: ${text.slice(0, 200)}`); }
}
