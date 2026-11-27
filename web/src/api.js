// Cliente de la API del backend de Vimo.
import { useEffect, useRef, useState, useCallback } from 'react';

async function call(method, url, body, isForm) {
  const res = await fetch('/api' + url, {
    method,
    headers: body && !isForm ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? (isForm ? body : JSON.stringify(body)) : undefined,
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { error: text }; }
  if (!res.ok) throw Object.assign(new Error(data?.error || `Error ${res.status}`), { status: res.status, code: data?.code });
  return data;
}

export const api = {
  get: url => call('GET', url),
  post: (url, body) => call('POST', url, body || {}),
  put: (url, body) => call('PUT', url, body || {}),
  del: url => call('DELETE', url),
  upload: (url, fields) => {
    const fd = new FormData();
    for (const [k, v] of Object.entries(fields)) if (v != null) fd.append(k, v);
    return call('POST', url, fd, true);
  },
};

/** Carga datos de la API con estado de carga/error y función de recarga. */
export function useApi(url, deps = []) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const reload = useCallback(async () => {
    if (!url) return;
    setLoading(true);
    try { setData(await api.get(url)); setError(null); }
    catch (e) { setError(e); }
    finally { setLoading(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, ...deps]);
  useEffect(() => { reload(); }, [reload]);
  return { data, setData, error, loading, reload };
}

// Un único EventSource compartido para el progreso en tiempo real.
let source = null;
const listeners = new Set();
function ensureSource() {
  if (source) return;
  source = new EventSource('/api/events');
  source.addEventListener('job', e => { const j = JSON.parse(e.data); listeners.forEach(l => l('job', j)); });
  source.addEventListener('project', e => { const j = JSON.parse(e.data); listeners.forEach(l => l('project', j)); });
}
export function useEvents(handler) {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    ensureSource();
    const l = (type, data) => ref.current(type, data);
    listeners.add(l);
    return () => listeners.delete(l);
  }, []);
}

export function fmtDuration(sec) {
  if (sec == null || !Number.isFinite(sec)) return '—';
  const s = Math.round(sec);
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}
export function fmtDate(iso) {
  try { return new Date(iso).toLocaleString('es-ES', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }); }
  catch { return iso; }
}
export function countWords(t) { return (t.trim().match(/\S+/g) || []).length; }
