import { api, esc, date, onLive } from '../app.js';
import { statusPill, LEVEL, empty } from './common.js';

export async function panel(view) {
  const render = async () => {
    const d = await api('/api/panel');
    const q = d.quota;
    const s = d.services;
    const pct = Math.min(100, (q.used / q.limit) * 100);
    view.innerHTML = `
    <h1>Panel de control</h1>
    <p class="sub">Estado real de tu herramienta: cuota de YouTube, servicios, proyectos y trabajos.</p>
    <div class="kpis">
      <div class="kpi"><span class="muted">Cuota de YouTube hoy</span><b>${q.used.toLocaleString('es')} / ${q.limit.toLocaleString('es')}</b><div class="meter"><i style="width:${pct}%"></i></div></div>
      <div class="kpi"><span class="muted">En producción</span><b>${d.counts.en_produccion || 0}</b></div>
      <div class="kpi"><span class="muted">Necesitan tu acción</span><b>${d.counts.necesita_accion || 0}</b></div>
      <div class="kpi"><span class="muted">Videos terminados</span><b>${d.counts.terminado || 0}</b></div>
    </div>
    <div class="card"><h2>Servicios</h2><div class="row">
      ${[['YouTube', s.youtube], ['Gemini', s.gemini], ['Mascota de referencia', s.mascot]].map(([n, ok]) => `<span class="pill ${ok ? 'p-ok' : 'p-bad'}">${n}: ${ok ? 'listo' : 'falta'}</span>`).join('')}
      <span class="pill">Voz: ${esc(s.voice)}</span><span class="pill">Imágenes: ${s.images === 'flow' ? 'Google Flow' : 'Gemini'}</span><span class="pill">Música: ${s.music} pista(s)</span>
      <a href="#/configuracion">Configurar</a></div></div>
    <div class="cols">
      <div class="card"><h2>Proyectos recientes</h2>${d.projects.length ? `<table>${d.projects.map((p) => `<tr><td><a href="#/proyectos/${p.id}">${esc(p.title)}</a></td><td>${statusPill(p.status)}</td></tr>`).join('')}</table>` : empty('Todavía no hay proyectos.')}</div>
      <div class="card"><h2>Mejores oportunidades recientes</h2>${d.top.length ? `<table>${d.top.map((v) => `<tr><td><b>${v.score}</b></td><td><a href="#/buscar/${v.search_id}">${esc(v.title)}</a><div class="muted">${esc(v.channel_title)}</div></td><td><span class="pill ${LEVEL[v.level]}">${v.level}</span></td></tr>`).join('')}</table>` : empty('Haz una búsqueda para detectar oportunidades.')}</div>
    </div>
    <div class="cols">
      <div class="card"><h2>Últimas búsquedas</h2>${d.searches.length ? `<table>${d.searches.map((x) => `<tr><td><a href="#/buscar/${x.id}">${esc(x.query)}</a></td><td class="muted">${x.status === 'ok' ? `${x.result_count} videos` : 'error'}</td><td class="muted">${date(x.created_at)}</td></tr>`).join('')}</table>` : empty('Sin búsquedas.')}</div>
      <div class="card"><h2>Trabajos</h2>${d.jobs.length ? `<table>${d.jobs.map((j) => `<tr><td>#${j.id}</td><td><span class="pill ${j.state === 'hecho' ? 'p-ok' : j.state === 'error' ? 'p-bad' : 'p-run'}">${j.state}</span></td><td class="muted">${esc(j.message || '')}</td></tr>`).join('')}</table>` : empty('Sin trabajos.')}</div>
    </div>`;
  };
  await render();
  let t;
  return onLive((e) => { if (['job', 'project', 'stage'].includes(e.type)) { clearTimeout(t); t = setTimeout(render, 800); } });
}
