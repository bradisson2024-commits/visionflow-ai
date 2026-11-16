import { api, esc, date, toast } from '../app.js';
import { statusPill, empty } from './common.js';

export async function proyectos(view) {
  const render = async () => {
    const { items } = await api('/api/proyectos');
    view.innerHTML = `<h1>Biblioteca de proyectos</h1><p class="sub">Todos tus videos en producción y terminados.</p>
    ${items.length ? `<div class="grid">${items.map((p) => `<article class="video">
      <a class="th" href="#/proyectos/${p.id}">${p.thumbnail ? `<img src="${esc(p.thumbnail)}" alt="">` : ''}</a>
      <div class="bd"><a class="t" href="#/proyectos/${p.id}">${esc(p.title)}</a>
        <div class="muted">Basado en: ${esc(p.source_title)}</div>
        <div class="row">${statusPill(p.status)}<span class="pill">${p.scene_count} escenas</span><span class="pill">${p.image_engine === 'flow' ? 'Google Flow' : 'Gemini'}</span></div>
        <div class="muted">Creado ${date(p.created_at)}</div>
        <div class="row"><a class="btn small" href="#/proyectos/${p.id}">Abrir</a><button class="small" data-del="${p.id}">Eliminar</button></div>
      </div></article>`).join('')}</div>` : `<div class="card">${empty('Aún no hay proyectos. Busca un video viral y pulsa «REPLICAR Y MEJORAR».')}</div>`}`;
  };
  await render();
  view.addEventListener('click', async (e) => {
    const id = e.target.dataset?.del;
    if (!id || !confirm('¿Eliminar el proyecto y todos sus archivos?')) return;
    try { await api(`/api/proyectos/${id}`, { method: 'DELETE' }); await render(); } catch (err) { toast(err.message); }
  });
}
