// Utilidades HTTP para los proveedores de IA: reintentos con espera exponencial
// en errores transitorios (429/5xx/red) y mensajes de error legibles.

export class ProviderError extends Error {
  constructor(provider, status, message) {
    super(`${provider}: ${message}`);
    this.provider = provider;
    this.status = status;
  }
}

const sleep = (ms, signal) => new Promise((res, rej) => {
  const t = setTimeout(res, ms);
  signal?.addEventListener('abort', () => { clearTimeout(t); rej(signal.reason || new Error('Cancelado')); }, { once: true });
});

export async function request(provider, url, init = {}, { retries = 3, signal, timeoutMs = 300_000 } = {}) {
  let attempt = 0;
  for (;;) {
    const ctrl = new AbortController();
    const onAbort = () => ctrl.abort(signal.reason);
    signal?.addEventListener('abort', onAbort, { once: true });
    const timer = setTimeout(() => ctrl.abort(new Error('Tiempo de espera agotado')), timeoutMs);
    try {
      const res = await fetch(url, { ...init, signal: ctrl.signal });
      if (res.ok) return res;
      const body = await res.text().catch(() => '');
      const retryable = res.status === 429 || res.status >= 500;
      if (retryable && attempt < retries) {
        const ra = Number(res.headers.get('retry-after'));
        await sleep(ra > 0 ? ra * 1000 : 1500 * 2 ** attempt, signal);
        attempt++;
        continue;
      }
      let msg = body;
      try {
        const j = JSON.parse(body);
        msg = j.error?.message || j.detail?.message || (typeof j.detail === 'string' ? j.detail : null) || j.message || j.error || body;
        if (typeof msg !== 'string') msg = JSON.stringify(msg);
      } catch { /* cuerpo no JSON */ }
      throw new ProviderError(provider, res.status, `HTTP ${res.status} — ${String(msg).slice(0, 400)}`);
    } catch (e) {
      if (e instanceof ProviderError) throw e;
      if (signal?.aborted) throw signal.reason || e;
      if (attempt < retries) { await sleep(1500 * 2 ** attempt, signal); attempt++; continue; }
      throw new ProviderError(provider, 0, `error de red: ${e.message}`);
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    }
  }
}

export async function json(provider, url, init, opts) {
  const res = await request(provider, url, init, opts);
  return res.json();
}

export async function buffer(provider, url, init, opts) {
  const res = await request(provider, url, init, opts);
  return Buffer.from(await res.arrayBuffer());
}
