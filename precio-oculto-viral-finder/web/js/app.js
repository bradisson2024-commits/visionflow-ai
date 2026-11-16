// Aplicación de una sola página: enrutador por hash, cliente de la API y eventos en vivo.
import { inicio } from './views/inicio.js';
import { panel } from './views/panel.js';
import { buscar, resultadosBusqueda } from './views/buscar.js';
import { historial } from './views/historial.js';
import { proyectos } from './views/proyectos.js';
import { proyecto } from './views/proyecto.js';
import { configuracion } from './views/configuracion.js';

export const $ = (s, el = document) => el.querySelector(s);
export const $$ = (s, el = document) => [...el.querySelectorAll(s)];
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const num = (n) => (n == null ? '—' : Number(n).toLocaleString('es'));
export const mmss = (s) => (s == null ? '—' : `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`);
export const date = (d) => (d ? new Date(d.includes('T') ? d : `${d.replace(' ', 'T')}Z`).toLocaleString('es', { dateStyle: 'medium', timeStyle: 'short' }) : '—');

export async function api(path, { method = 'GET', body, raw } = {}) {
  const opts = { method, headers: {} };
  if (raw) opts.body = raw;
  else if (body !== undefined) { opts.body = JSON.stringify(body); opts.headers['content-type'] = 'application/json'; }
  const res = await fetch(path, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
  return data;
}

export function toast(msg, ms = 4500) {
  const t = $('#toast');
  t.textContent = msg;
  t.style.display = 'block';
  clearTimeout(toast.h);
  toast.h = setTimeout(() => { t.style.display = 'none'; }, ms);
}

export function busy(btn, label = 'Trabajando…') {
  const old = btn.innerHTML;
  btn.disabled = true;
  btn.textContent = label;
  return () => { btn.disabled = false; btn.innerHTML = old; };
}

const listeners = new Set();
export const onLive = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
const live = new EventSource('/api/eventos');
live.onmessage = (m) => {
  const e = JSON.parse(m.data);
  for (const fn of listeners) fn(e);
  if (e.type === 'job') {
    const el = $('#jobInfo');
    el.textContent = e.state === 'en_curso' ? `⏳ ${e.message || 'Trabajando…'}` : e.state === 'error' ? 'El último trabajo terminó con error' : '';
  }
};

const ROUTES = [
  [/^#?\/?$/, inicio, 'inicio'],
  [/^#\/panel$/, panel, 'panel'],
  [/^#\/buscar$/, buscar, 'buscar'],
  [/^#\/buscar\/(\d+)$/, resultadosBusqueda, 'buscar'],
  [/^#\/historial$/, historial, 'historial'],
  [/^#\/proyectos$/, proyectos, 'proyectos'],
  [/^#\/proyectos\/(\d+)(?:\/(\w+))?$/, proyecto, 'proyectos'],
  [/^#\/configuracion$/, configuracion, 'configuracion'],
];

let cleanup = null;
async function route() {
  const h = location.hash || '#/';
  const r = ROUTES.find(([re]) => re.test(h)) || ROUTES[0];
  const args = (h.match(r[0]) || []).slice(1);
  $$('#nav a').forEach((a) => a.classList.toggle('on', a.dataset.r === r[2]));
  if (typeof cleanup === 'function') cleanup();
  cleanup = null;
  const view = $('#view');
  view.innerHTML = '<p class="muted">Cargando…</p>';
  try { cleanup = await r[1](view, ...args); } catch (e) { view.innerHTML = `<div class="alert a-bad">${esc(e.message)}</div>`; }
}
window.addEventListener('hashchange', route);
route();
