import { api, esc, num, mmss, date, toast, busy, onLive } from '../app.js';
import { statusPill } from './common.js';

const TABS = [['produccion', 'Producción'], ['original', 'Video original'], ['propuesta', 'Versión mejorada'], ['guion', 'Guion'], ['editor', 'Editor de escenas'], ['resultado', 'Resultado']];
const ST = { pendiente: '', en_curso: 'p-run', hecho: 'p-ok', error: 'p-bad', accion: 'p-warn' };
const ST_TXT = { pendiente: 'pendiente', en_curso: 'en curso', hecho: 'hecho', error: 'error', accion: 'necesita acción' };
const FIELD = { tema: 'Tema principal', gancho: 'Gancho inicial', problema: 'Problema', promesa: 'Promesa', estructura: 'Estructura narrativa', desarrollo: 'Desarrollo', curiosidad: 'Momentos de curiosidad', datos: 'Datos utilizados', conclusion: 'Conclusión' };
const FSTATE = { verificado: ['cita comprobada', 'p-ok'], cita_no_encontrada: ['cita no encontrada: no verificado', 'p-warn'], sin_acceso: ['sin acceso a la narración', 'p-bad'], hipotesis: ['hipótesis', 'p-warn'], no_aparece: ['no aparece', ''] };
const file = (p, rel, v) => `/api/proyectos/${p.id}/archivo/${rel}${v ? `?v=${v}` : ''}`;
const list = (v) => (Array.isArray(v) ? `<ul>${v.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : esc(v ?? '—'));

function production(p) {
  const action = p.stages.find((s) => ['accion', 'error'].includes(s.state));
  return `
  ${action ? `<div class="alert ${action.state === 'error' ? 'a-bad' : 'a-warn'}"><b>${esc(action.label)}:</b> ${esc(action.message)}</div>` : ''}
  ${p.status === 'terminado' ? '<div class="alert a-ok"><b>Video terminado y verificado.</b> Descárgalo en la pestaña Resultado.</div>' : ''}
  <div class="card"><h2>Etapas</h2><div class="stages">${p.stages.map((s) => `<div class="stage"><b>${esc(s.label)}</b><span class="pill ${ST[s.state]}">${ST_TXT[s.state]}</span>
    <div class="muted">${esc(s.message || '')}</div>${s.state !== 'pendiente' && !p.job ? `<button class="small" data-from="${s.name}" style="margin-top:6px">Rehacer desde aquí</button>` : ''}</div>`).join('')}</div></div>
  <div class="card"><h2>Registro</h2><div class="log" id="log">${p.events.map((e) => `<div class="${e.level}">${date(e.created_at)} · ${esc(e.message)}</div>`).join('') || 'Sin actividad todavía.'}</div></div>`;
}

function original(p) {
  const v = p.video, a = p.analysis;
  return `<div class="cols">
  <div class="card"><h2>Datos reales de YouTube</h2>
    ${v.thumbnail ? `<img src="${esc(v.thumbnail)}" alt="" style="width:100%;border-radius:10px">` : ''}
    <div class="kv" style="margin-top:10px"><div>Título</div><div><a href="https://www.youtube.com/watch?v=${esc(v.id)}" target="_blank" rel="noopener">${esc(v.title)}</a></div>
    <div>Canal</div><div>${esc(v.channel_title)} (${num(v.subscribers)} suscriptores)</div><div>Publicado</div><div>${date(v.published_at)}</div>
    <div>Visualizaciones</div><div>${num(v.views)}</div><div>Me gusta / comentarios</div><div>${num(v.likes)} / ${num(v.comments)}</div><div>Duración</div><div>${mmss(v.duration_sec)}</div></div>
    <details><summary>Descripción</summary><p class="muted" style="white-space:pre-wrap">${esc(v.description)}</p></details>
    <h3>Transcripción</h3>
    ${p.transcript ? `<p><span class="pill p-ok">disponible</span> <span class="muted">${esc(p.transcript_source)} · ${p.transcript.split(/\s+/).length} palabras</span></p><details><summary>Leer</summary><p class="muted">${esc(p.transcript)}</p></details>`
      : '<div class="alert a-warn">Sin transcripción: la herramienta no ha escuchado el video. Con Gemini la obtiene sola; si no puede, pega aquí una transcripción autorizada (.txt, .srt o .vtt).</div>'}
    <textarea id="tr" placeholder="Pega la transcripción autorizada…"></textarea>
    <div class="row" style="margin-top:8px"><input type="file" id="trf" accept=".txt,.srt,.vtt"><button id="trSave">Guardar y volver a analizar</button></div>
  </div>
  <div class="card"><h2>Informe del video original</h2>
    ${!a ? '<p class="muted">Se genera en la etapa «Análisis del original».</p>' : `
    <p><span class="pill ${a.acceso === 'transcripcion' ? 'p-ok' : 'p-warn'}">${a.acceso === 'transcripcion' ? 'Con transcripción' : 'Sólo metadatos'}</span> <span class="muted">${esc(a.nota)}</span></p>
    <div class="kv">${Object.entries(FIELD).map(([k, label]) => { const f = a.campos[k] || {}; return `<div>${label}<br><span class="pill ${FSTATE[f.estado]?.[1] || ''}">${FSTATE[f.estado]?.[0] || ''}</span></div><div>${list(f.valor)}${f.cita ? `<div class="muted">«${esc(f.cita)}»</div>` : ''}</div>`; }).join('')}
    <div>Miniatura</div><div>${a.miniatura?.disponible ? `${esc(a.miniatura.composicion)}. Texto: ${esc(a.miniatura.texto || 'ninguno')}. Emoción: ${esc(a.miniatura.emocion)}. Gancho visual: ${esc(a.miniatura.gancho_visual)}.` : `<span class="muted">No analizada: ${esc(a.miniatura?.motivo)}</span>`}</div>
    ${a.hipotesis?.length ? `<div>Hipótesis (no verificadas)</div><div>${list(a.hipotesis)}</div>` : ''}
    <div>Qué se puede mejorar</div><div>${list(a.mejoras)}</div></div>`}
  </div></div>`;
}

function propuesta(p) {
  const x = p.proposal;
  if (!x) return '<div class="card"><p class="muted">Se genera en la etapa «Versión mejorada e investigación».</p></div>';
  return `<div class="card"><h2>${esc(x.titulo)}</h2><p><b>Qué aporta:</b> ${esc(x.angulo)}</p>
    <div class="kv"><div>Títulos alternativos</div><div>${list(x.titulos_alternativos)}</div><div>Texto de miniatura</div><div><b>${esc(x.texto_miniatura)}</b></div>
    <div>Ganchos propuestos</div><div><ol>${(x.ganchos || []).map((g, i) => `<li${i === x.gancho_elegido ? ' style="font-weight:700"' : ''}>${esc(g)}${i === x.gancho_elegido ? ' ← elegido' : ''}</li>`).join('')}</ol></div>
    <div>Estructura</div><div><ol>${x.partes.map((s) => `<li><b>${esc(s.nombre)}</b> — ${esc(s.objetivo)} <span class="muted">(${s.palabras} palabras)</span></li>`).join('')}</ol></div></div></div>
  <div class="card"><h2>Fuentes de la investigación (${x.research.sources.length})</h2><ol>${x.research.sources.map((s) => `<li><a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.title)}</a> <span class="muted">${esc(s.via)}${s.leido ? ' · texto leído' : ''}</span></li>`).join('')}</ol></div>`;
}

function guion(p) {
  const s = p.script;
  if (!s) return '<div class="card"><p class="muted">Se genera en la etapa «Guion».</p></div>';
  return `<div class="card"><h2>${esc(s.title)}</h2>
    <p class="muted">${s.words} palabras · ~${s.minutes} min · ${s.cited.length} fuentes citadas${s.copied != null ? ` · coincidencia literal con el original: ${(s.copied * 100).toFixed(1)} %` : ''}</p>
    ${s.removed?.length ? `<details class="alert a-warn"><summary>${s.removed.length} oraciones eliminadas por no tener fuente verificable</summary><ul>${s.removed.map((r) => `<li>${esc(r)}</li>`).join('')}</ul></details>` : ''}
    ${s.parts.map((part) => `<h3>${esc(part.name)}</h3>${part.paragraphs.map((x) => `<p>${esc(x)}</p>`).join('')}`).join('')}</div>`;
}

const REV = { aprobada: ['aprobada por Gemini', 'p-ok'], aprobada_manual: ['aprobada por ti', 'p-ok'], rechazada: ['no coincide', 'p-bad'] };
function editor(p) {
  if (!p.scenes.length) return '<div class="card"><p class="muted">Las escenas aparecen tras la etapa «Escenas y storyboard».</p></div>';
  const pending = p.scenes.filter((s) => s.pending_image).length;
  return `<div class="card"><h2>Motor de imágenes</h2>
    <div class="row"><label class="row"><input type="radio" name="eng" value="gemini" ${p.image_engine === 'gemini' ? 'checked' : ''}> Gemini (automático en el servidor)</label>
    <label class="row"><input type="radio" name="eng" value="flow" ${p.image_engine === 'flow' ? 'checked' : ''}> Google Flow (extensión de Chrome)</label></div>
    ${p.image_engine === 'flow' ? `<p class="muted">${pending ? `Faltan ${pending} imágenes.` : 'Todas las imágenes recibidas.'} En Chrome abre Google Flow, pulsa el icono <b>EPO · Conector Flow</b>, elige este proyecto y pulsa <b>ENVIAR A FLOW</b>. Cada imagen vuelve sola a su escena.</p>
      <div class="row"><a class="btn small" href="/api/proyectos/${p.id}/prompts-flow.txt">Descargar prompts (TXT)</a>
      <label class="muted">Importar imágenes escena_NNN: <input type="file" id="imp" multiple accept="image/*"></label><span id="impMsg" class="muted"></span></div>` : ''}
  </div>
  <div class="card"><h2>Escenas: lo que se escucha ↔ lo que se ve (${p.scenes.length})</h2>
  ${p.scenes.map((s) => `<div class="scene" data-n="${s.n}">
    <div class="n">${s.n}</div>
    <div>
      <div class="muted">${esc(s.part)}${s.sfx ? ` · efecto: ${esc(s.sfx)}` : ''} · ${s.audio_sec ? `${s.audio_sec.toFixed(1)} s de voz` : 'voz pendiente'}</div>
      <textarea class="nar">${esc(s.narration)}</textarea>
      <div class="muted"><b>Debe verse:</b> ${esc(s.visual)}</div>
      ${s.review ? `<div><span class="pill ${REV[s.review.state]?.[1] || ''}">${REV[s.review.state]?.[0] || esc(s.review.state)}</span> ${s.review.score != null ? `${s.review.score}/10` : ''} ${s.review.seen ? `<span class="muted">Se ve: ${esc(s.review.seen)}</span>` : ''}${s.review.problems?.length ? `<div class="muted" style="color:var(--bad)">${esc(s.review.problems.join('; '))}</div>` : ''}</div>` : ''}
      ${s.pending_image && s.image_version ? `<span class="pill p-warn">${esc(s.pending_image)}</span>` : ''}
      ${s.audio_file ? `<audio controls preload="none" src="${file(p, `audio/${s.audio_file}`, s.audio_text_hash)}"></audio>` : ''}
      <div class="row" style="margin-top:6px"><button class="small" data-a="narracion">Guardar narración</button>
        ${s.image_version ? '<button class="small" data-a="aprobar">✔ Aprobar imagen</button>' : ''}<button class="small" data-a="rehacer">↻ Rehacer imagen</button></div>
    </div>
    <div class="img">${s.image_version ? `<img src="${file(p, `imagenes/escena_${String(s.n).padStart(3, '0')}.png`, s.image_version)}" alt="Escena ${s.n}" loading="lazy">` : p.image_engine === 'flow' ? 'Esperando imagen de Google Flow' : 'Imagen pendiente'}</div>
  </div>`).join('')}</div>`;
}

function resultado(p) {
  const v = p.verification;
  return `${p.can_download ? `<div class="card"><h2>Video terminado</h2><video controls preload="metadata" src="${file(p, 'salida/video.mp4', p.render?.at)}"></video></div>` : '<div class="alert a-warn">El MP4 se habilita cuando el video está exportado y supera la verificación.</div>'}
  ${v ? `<div class="card"><h2>Verificación ${v.ok ? '<span class="pill p-ok">superada</span>' : '<span class="pill p-bad">con problemas</span>'}</h2><ul class="checks">${v.checks.map((c) => `<li>${c.ok ? '✔' : c.aviso ? '⚠' : '✘'} <b>${esc(c.nombre)}</b> — <span class="muted">${esc(c.detalle)}</span>${c.arreglo ? `<div style="color:var(--bad)">Cómo arreglarlo: ${esc(c.arreglo)}</div>` : ''}</li>`).join('')}</ul></div>` : ''}
  ${p.deliverables ? `<div class="card"><h2>Archivos</h2><div class="cols"><ul>${p.deliverables.map((f) => `<li><a href="${file(p, f)}?descargar">${esc(f.replace('salida/', ''))}</a></li>`).join('')}
    <li>Imágenes, audios y escenas: carpeta <code>data/proyectos/${esc(p.slug)}/</code></li></ul>
    <img src="${file(p, 'salida/miniatura.png', p.thumbnail_version)}" alt="Miniatura" style="width:100%;border-radius:10px"></div>
    ${p.render?.musica ? `<p class="muted">Música: ${esc(p.render.musica.origen === 'biblioteca' ? p.render.musica.archivo : p.render.musica.nota)}</p>` : ''}</div>` : ''}`;
}

export async function proyecto(view, id, tab = 'produccion') {
  let p;
  const render = async () => {
    p = await api(`/api/proyectos/${id}`);
    const y = window.scrollY;
    view.innerHTML = `
    <div class="row" style="justify-content:space-between"><div><h1>${esc(p.title)}</h1><p class="sub">Basado en «${esc(p.video.title)}» de ${esc(p.video.channel_title)}</p></div><div>${statusPill(p.status)} ${p.job ? '<span class="pill p-run">procesando…</span>' : ''}</div></div>
    <div class="row" style="margin-bottom:8px">
      <button class="dark big" id="go" ${p.job ? 'disabled' : ''}>${p.status === 'borrador' ? 'Producir video' : 'Producir video (continuar)'}</button>
      <a class="btn gold big ${p.can_download ? '' : 'off'}" ${p.can_download ? `href="/api/proyectos/${p.id}/mp4"` : 'aria-disabled="true"'}>Descargar MP4</a>
    </div>
    <div class="tabs">${TABS.map(([k, l]) => `<button data-tab="${k}" class="${k === tab ? 'on' : ''}">${l}</button>`).join('')}</div>
    <div id="tab">${{ produccion: production, original, propuesta, guion, editor, resultado }[tab]?.(p) ?? ''}</div>`;
    window.scrollTo(0, y);
    const log = view.querySelector('#log');
    if (log) log.scrollTop = log.scrollHeight;
  };
  await render();

  view.addEventListener('click', async (e) => {
    const t = e.target;
    if (t.dataset.tab) { tab = t.dataset.tab; history.replaceState(null, '', `#/proyectos/${id}/${tab}`); return render(); }
    if (t.id === 'go' || t.dataset.from) {
      if (t.dataset.from && !confirm('Se rehará esta etapa y todas las siguientes. ¿Continuar?')) return;
      try { await api(`/api/proyectos/${id}/producir`, { method: 'POST', body: { from: t.dataset.from } }); toast('Producción en marcha. Sigue el avance en el registro.'); await render(); } catch (err) { toast(err.message, 8000); }
      return;
    }
    if (t.id === 'trSave') {
      const done = busy(t);
      try { await api(`/api/proyectos/${id}/transcripcion`, { method: 'POST', body: { text: view.querySelector('#tr').value } }); await api(`/api/proyectos/${id}/producir`, { method: 'POST', body: { from: 'analisis' } }); toast('Transcripción guardada; se repite el análisis.'); await render(); } catch (err) { toast(err.message, 8000); done(); }
      return;
    }
    const a = t.dataset.a;
    if (a) {
      const row = t.closest('.scene');
      const body = {};
      if (a === 'narracion') body.texto = row.querySelector('.nar').value;
      if (a === 'rehacer') { const ins = prompt('¿Qué debe mostrar la nueva imagen? (opcional)'); if (ins === null) return; body.instruccion = ins; }
      const done = busy(t, '…');
      try { await api(`/api/proyectos/${id}/escenas/${row.dataset.n}/${a}`, { method: 'POST', body }); toast(a === 'rehacer' ? 'Escena marcada para rehacer. Pulsa «Producir video» para continuar.' : 'Escena actualizada.'); await render(); } catch (err) { toast(err.message, 8000); done(); }
    }
  });
  view.addEventListener('change', async (e) => {
    if (e.target.name === 'eng') { try { await api(`/api/proyectos/${id}/motor`, { method: 'POST', body: { engine: e.target.value } }); await render(); } catch (err) { toast(err.message); } }
    if (e.target.id === 'trf') { const f = e.target.files[0]; if (f) view.querySelector('#tr').value = await f.text(); }
    if (e.target.id === 'imp') {
      const msg = view.querySelector('#impMsg');
      let ok = 0; const errs = [];
      for (const f of e.target.files) {
        msg.textContent = `Importando ${f.name}…`;
        try { await api(`/api/proyectos/${id}/importar-imagen?nombre=${encodeURIComponent(f.name)}`, { method: 'POST', raw: f }); ok++; } catch (err) { errs.push(`${f.name}: ${err.message}`); }
      }
      toast(`${ok} imagen(es) importada(s).${errs.length ? ` Errores: ${errs.join(' · ')}` : ''}`, 9000);
      await render();
    }
  });
  let timer;
  return onLive((e) => {
    if (e.projectId != null && Number(e.projectId) !== Number(id)) return;
    if (e.type === 'log' && tab === 'produccion') {
      const log = view.querySelector('#log');
      if (log) { const d = document.createElement('div'); d.className = e.level; d.textContent = `${date(e.at)} · ${e.message}`; log.appendChild(d); log.scrollTop = log.scrollHeight; }
    }
    clearTimeout(timer);
    timer = setTimeout(render, e.type === 'log' ? 2500 : 600);
  });
}
