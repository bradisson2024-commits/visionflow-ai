import { api, esc, date, toast } from '../app.js';
import { empty } from './common.js';

export async function historial(view) {
  const render = async () => {
    const { items } = await api('/api/busquedas');
    view.innerHTML = `<h1>Historial de búsquedas</h1><p class="sub">Cada búsqueda queda guardada con sus resultados y la cuota que gastó.</p>
    <div class="card">${items.length ? `<table><tr><th>Tema</th><th>Idioma</th><th>Periodo</th><th>Resultados</th><th>Cuota</th><th>Fecha</th><th></th></tr>
      ${items.map((s) => `<tr><td>${s.status === 'ok' ? `<a href="#/buscar/${s.id}">${esc(s.query)}</a>` : `${esc(s.query)}<div class="muted" style="color:var(--bad)">${esc(s.error)}</div>`}</td>
        <td>${esc(s.language)}</td><td>${s.period_days} días</td><td>${s.result_count}</td><td>${s.quota_used}</td><td class="muted">${date(s.created_at)}</td>
        <td><button class="small" data-del="${s.id}">Borrar</button></td></tr>`).join('')}</table>` : empty('Aún no has hecho ninguna búsqueda.')}</div>`;
  };
  await render();
  view.addEventListener('click', async (e) => {
    const id = e.target.dataset?.del;
    if (!id || !confirm('¿Borrar esta búsqueda del historial?')) return;
    try { await api(`/api/busquedas/${id}`, { method: 'DELETE' }); await render(); } catch (err) { toast(err.message); }
  });
}
