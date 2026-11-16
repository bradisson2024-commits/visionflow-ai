import { api, esc, toast, busy, date } from '../app.js';
import { videoCard, bindReplicate, empty } from './common.js';

const form = (q = '') => `
  <h1>Buscar videos virales</h1>
  <p class="sub">Consulta real a YouTube Data API v3. Cada búsqueda gasta unas 200 unidades de tu cuota diaria (10.000) si mides la competencia en español.</p>
  <form id="sf" class="card">
    <div class="row">
      <input class="grow" name="query" value="${esc(q)}" placeholder="Tema: negocio de los aeropuertos, por qué la insulina es cara…" required>
      <select name="days"><option value="7">Últimos 7 días</option><option value="30" selected>Últimos 30 días</option><option value="90">Últimos 90 días</option><option value="365">Último año</option></select>
      <select name="language"><option value="es">En español</option><option value="en">En inglés</option><option value="pt">En portugués</option></select>
      <select name="minMinutes"><option value="4" selected>4–20 min</option><option value="20">Más de 20 min</option><option value="0">Cualquier duración</option></select>
      <label class="row muted"><input type="checkbox" name="competition" checked> Medir competencia en español</label>
      <button class="gold">Buscar</button>
    </div>
  </form>
  <details class="card"><summary><b>¿Ya tienes el enlace del video?</b></summary>
    <form id="uf" class="row" style="margin-top:10px"><input class="grow" name="url" placeholder="https://www.youtube.com/watch?v=…" required><button class="gold">REPLICAR Y MEJORAR</button></form>
  </details>
  <div id="out"></div>`;

function results(s) {
  if (s.status !== 'ok') return `<div class="alert a-bad">La búsqueda falló: ${esc(s.error)}</div>`;
  return `<div class="row" style="justify-content:space-between;margin-bottom:10px"><h2 style="margin:0">«${esc(s.query)}» · ${s.results.length} videos</h2><span class="muted">${date(s.created_at)} · ${s.quota_used} unidades de cuota</span></div>
    ${s.results.length ? `<div class="grid">${s.results.map(videoCard).join('')}</div>` : empty('YouTube no devolvió videos para esta búsqueda.')}`;
}

export async function buscar(view) {
  const q = sessionStorage.getItem('epo.q') || '';
  sessionStorage.removeItem('epo.q');
  view.innerHTML = form(q);
  bindReplicate(view);
  view.querySelector('#sf').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const done = busy(e.target.querySelector('button'), 'Consultando YouTube…');
    view.querySelector('#out').innerHTML = '<p class="muted">Buscando videos, midiendo canales y competencia…</p>';
    try {
      const s = await api('/api/busquedas', { method: 'POST', body: { query: fd.get('query'), days: fd.get('days'), language: fd.get('language'), minMinutes: fd.get('minMinutes'), competition: fd.get('competition') === 'on' } });
      history.replaceState(null, '', `#/buscar/${s.id}`);
      view.querySelector('#out').innerHTML = results(s);
    } catch (err) { view.querySelector('#out').innerHTML = `<div class="alert a-bad">${esc(err.message)}</div>`; }
    done();
  });
  view.querySelector('#uf').addEventListener('submit', async (e) => {
    e.preventDefault();
    const done = busy(e.target.querySelector('button'), 'Creando proyecto…');
    try {
      const p = await api('/api/proyectos', { method: 'POST', body: { url: new FormData(e.target).get('url') } });
      location.hash = `#/proyectos/${p.id}`;
    } catch (err) { toast(err.message, 8000); done(); }
  });
  if (q) view.querySelector('#sf').requestSubmit();
}

export async function resultadosBusqueda(view, id) {
  const s = await api(`/api/busquedas/${id}`);
  view.innerHTML = form(s.query);
  bindReplicate(view);
  view.querySelector('#out').innerHTML = results(s);
  view.querySelector('#sf').addEventListener('submit', (e) => { e.preventDefault(); sessionStorage.setItem('epo.q', new FormData(e.target).get('query')); location.hash = '#/buscar'; });
  view.querySelector('#uf').addEventListener('submit', async (e) => {
    e.preventDefault();
    try { const p = await api('/api/proyectos', { method: 'POST', body: { url: new FormData(e.target).get('url') } }); location.hash = `#/proyectos/${p.id}`; } catch (err) { toast(err.message, 8000); }
  });
}
