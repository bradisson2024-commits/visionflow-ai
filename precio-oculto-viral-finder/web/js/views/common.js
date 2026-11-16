import { esc, num, mmss, date, api, toast, busy } from '../app.js';

export const LEVEL = { alta: 'p-ok', media: 'p-warn', baja: 'p-bad' };
export const STATUS = { borrador: ['Borrador', ''], en_produccion: ['En producción', 'p-run'], necesita_accion: ['Necesita tu acción', 'p-warn'], error: ['Error', 'p-bad'], terminado: ['Terminado', 'p-ok'] };
export const statusPill = (s) => `<span class="pill ${STATUS[s]?.[1] || ''}">${STATUS[s]?.[0] || esc(s)}</span>`;

export function videoCard(v) {
  const m = v.metrics || {};
  return `<article class="video">
    <a class="th" href="https://www.youtube.com/watch?v=${esc(v.id)}" target="_blank" rel="noopener">
      ${v.thumbnail ? `<img src="${esc(v.thumbnail)}" alt="" loading="lazy">` : ''}
      ${v.score != null ? `<span class="score" title="Puntuación de oportunidad (0–100)">${v.score}</span>` : ''}
    </a>
    <div class="bd">
      <div class="t">${esc(v.title)}</div>
      <div class="muted">${esc(v.channel_title)} · ${date(v.published_at)}</div>
      <div class="facts"><span>👁 ${num(v.views)}</span><span>${num(m.viewsPerDay)}/día</span><span>⏱ ${mmss(v.duration_sec)}</span>${v.subscribers != null ? `<span>${num(v.subscribers)} subs</span>` : ''}${m.outlier != null ? `<span>${m.outlier}× subs</span>` : ''}</div>
      ${v.level ? `<div><span class="pill ${LEVEL[v.level]}">Oportunidad ${v.level}</span></div>` : ''}
      ${v.reasons ? `<ul>${v.reasons.map((r) => `<li>${esc(r)}</li>`).join('')}</ul>` : ''}
      ${v.project_slug ? '<span class="muted">Ya existe un proyecto con este video.</span>' : ''}
      <button class="gold" data-replicar="${esc(v.id)}">REPLICAR Y MEJORAR</button>
    </div>
  </article>`;
}

/** Botones «REPLICAR Y MEJORAR»: crean el proyecto y arrancan la producción. */
export function bindReplicate(root) {
  root.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-replicar]');
    if (!b) return;
    const done = busy(b, 'Creando proyecto…');
    try {
      const p = await api('/api/proyectos', { method: 'POST', body: { videoId: b.dataset.replicar } });
      location.hash = `#/proyectos/${p.id}`;
    } catch (err) { toast(err.message, 8000); done(); }
  });
}

export const empty = (msg) => `<div class="empty"><img src="/img/detective.svg" alt=""><p>${msg}</p></div>`;
