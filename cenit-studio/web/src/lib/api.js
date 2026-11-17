// Cliente de la API: sesión (Supabase Auth o cuentas locales), peticiones JSON, archivos y eventos en vivo.
import { createClient } from '@supabase/supabase-js';
import { useEffect, useRef, useState, useCallback } from 'react';

let supabase = null;
let authConfig = null;
let localToken = localStorage.getItem('cenit.token') || null;

export async function loadAuthConfig() {
  authConfig = await (await fetch('/api/auth/config')).json();
  if (authConfig.mode === 'supabase') supabase = createClient(authConfig.supabaseUrl, authConfig.supabaseAnonKey);
  return authConfig;
}

export async function token() {
  if (supabase) { const { data } = await supabase.auth.getSession(); return data.session?.access_token || null; }
  return localToken;
}

export async function signIn(email, password, register = false) {
  if (supabase) {
    const r = register ? await supabase.auth.signUp({ email, password }) : await supabase.auth.signInWithPassword({ email, password });
    if (r.error) throw new Error(r.error.message);
    if (register && !r.data.session) return { needsConfirm: true };
    return {};
  }
  const res = await fetch(`/api/auth/${register ? 'register' : 'login'}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password }) });
  const j = await res.json();
  if (!res.ok) throw new Error(j.error);
  localToken = j.token;
  localStorage.setItem('cenit.token', j.token);
  return {};
}

export async function signOut() {
  if (supabase) await supabase.auth.signOut();
  localToken = null;
  localStorage.removeItem('cenit.token');
}

export async function api(path, { method = 'GET', body, form } = {}) {
  const t = await token();
  const res = await fetch(path, { method, headers: { ...(t ? { authorization: `Bearer ${t}` } : {}), ...(body !== undefined ? { 'content-type': 'application/json' } : {}) }, body: form || (body !== undefined ? JSON.stringify(body) : undefined) });
  const j = await res.json().catch(() => ({}));
  if (res.status === 401) window.dispatchEvent(new Event('cenit:logout'));
  if (!res.ok) throw Object.assign(new Error(j.error || `Error ${res.status}`), { status: res.status });
  return j;
}

let cachedToken = null;
export async function refreshFileToken() { cachedToken = await token(); }
export const fileUrl = (key, download) => (key ? `/api/archivo?key=${encodeURIComponent(key)}&token=${encodeURIComponent(cachedToken || localToken || '')}${download ? '&descargar=1' : ''}` : null);

// ------------------------------------------------------------------ eventos en vivo
const listeners = new Set();
let es = null;
export async function connectEvents() {
  if (es) es.close();
  const t = await token();
  if (!t) return;
  es = new EventSource(`/api/eventos?token=${encodeURIComponent(t)}`);
  es.onmessage = (m) => { const e = JSON.parse(m.data); for (const fn of listeners) fn(e); };
}
export function useLive(fn, deps = []) {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => { const h = (e) => ref.current(e); listeners.add(h); return () => listeners.delete(h); }, deps);
}

/** Carga de datos con recarga manual y automática por eventos. */
export function useData(path, { liveFilter } = {}) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const load = useCallback(async () => { if (!path) return; try { setData(await api(path)); setError(null); } catch (e) { setError(e.message); } }, [path]);
  useEffect(() => { load(); }, [load]);
  const timer = useRef();
  useLive((e) => { if (liveFilter && liveFilter(e)) { clearTimeout(timer.current); timer.current = setTimeout(load, 400); } });
  return { data, error, reload: load, setData };
}

export const fmt = (n) => (n == null ? '—' : Number(n).toLocaleString('es'));
export const mmss = (s) => (s == null ? '—' : `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`);
export const date = (d) => (d ? new Date(d).toLocaleDateString('es', { day: '2-digit', month: 'short', year: 'numeric' }) : '—');
export const ago = (d) => { const h = (Date.now() - new Date(d)) / 3600e3; return h < 48 ? `hace ${Math.round(h)} h` : `hace ${Math.round(h / 24)} días`; };
