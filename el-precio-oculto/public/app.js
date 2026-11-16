// Interfaz de El Precio Oculto · Viral Finder (vanilla JS).
const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (n) => (n == null ? 'no disponible' : Number(n).toLocaleString('es'));
const dur = (s) => (s == null ? 'no disponible' : `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`);

async function api(path, opts = {}) {
  const res = await fetch(path, { ...opts, headers: { 'content-type': 'application/json', ...(opts.headers || {}) } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
  return data;
}

function toast(msg, ms = 4000) {
  const t = $('#toast'); t.textContent = msg; t.style.display = 'block';
  clearTimeout(toast.t); toast.t = setTimeout(() => (t.style.display = 'none'), ms);
}

function showTab(name) {
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.id === `tab-${name}`));
  document.querySelectorAll('nav button').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
  if (name === 'proyectos') loadProjects();
  if (name === 'config') loadStatus();
}
document.querySelectorAll('nav button').forEach((b) => b.addEventListener('click', () => { location.hash = ''; showTab(b.dataset.tab); }));

// ------------------------------------------------------------------ buscador
$('#searchForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('#searchMsg').innerHTML = '<p class="muted">Buscando en YouTube…</p>';
  $('#results').innerHTML = '';
  try {
    const { results } = await api(`/api/search?q=${encodeURIComponent($('#q').value)}&days=${$('#days').value}&lang=${$('#lang').value}`);
    $('#searchMsg').innerHTML = results.length ? '' : '<p class="muted">Sin resultados.</p>';
    $('#results').innerHTML = results.map((v) => `
      <div class="vcard">
        <a href="${esc(v.url)}" target="_blank" rel="noopener"><img src="${esc(v.thumbnail)}" alt="" loading="lazy"></a>
        <div class="b">
          <div class="t">${esc(v.title)}</div>
          <div class="muted">${esc(v.channelTitle)} · ${new Date(v.publishedAt).toLocaleDateString('es')}</div>
          <div class="stats"><span>👁 ${fmt(v.views)}</span><span>${fmt(v.viewsPerDay)}/día</span><span>⏱ ${dur(v.durationSec)}</span>${v.subscribers ? `<span>${fmt(v.subscribers)} subs</span>` : ''}${v.viewsPerSub ? `<span>${v.viewsPerSub}× subs</span>` : ''}</div>
          <button class="primary" data-replicate="${esc(v.url)}">REPLICAR Y MEJORAR</button>
        </div>
      </div>`).join('');
  } catch (err) {
    $('#searchMsg').innerHTML = `<div class="error-box">${esc(err.message)}</div>`;
  }
});
$('#results').addEventListener('click', (e) => { const u = e.target.dataset?.replicate; if (u) replicate(u, e.target); });
$('#urlForm').addEventListener('submit', (e) => { e.preventDefault(); replicate($('#url').value, e.submitter); });

async function replicate(url, btn) {
  if (btn) { btn.disabled = true; btn.textContent = 'Creando proyecto…'; }
  try {
    const { id } = await api('/api/replicate', { method: 'POST', body: JSON.stringify({ url }) });
    location.hash = `#/p/${id}`;
  } catch (err) { toast(err.message, 7000); if (btn) { btn.disabled = false; btn.textContent = 'REPLICAR Y MEJORAR'; } }
}

// ------------------------------------------------------------------ configuración
async function loadStatus() {
  const { services } = await api('/api/status');
  $('#services').innerHTML = services.map((s) => `
    <div class="card" style="margin-bottom:8px">
      <span class="badge ${s.ok ? 'b-ok' : s.ok === false ? 'b-err' : 'b-warn'}">${s.ok ? 'Configurado' : s.ok === false ? 'No disponible' : 'Sin clave · se comprueba al usarlo'}</span>
      <b>${esc(s.name)}</b><div class="muted">${esc(s.role)}</div>
      ${s.missing ? `<div class="missing">${esc(s.missing)}</div>` : ''}
      ${s.test === 'tts' ? '<div class="actions"><button id="btnTts">Probar voz (síntesis real)</button><span id="ttsOut" class="muted"></span></div>' : ''}
    </div>`).join('');
  $('#btnTts')?.addEventListener('click', async (e) => {
    e.target.disabled = true; $('#ttsOut').textContent = 'Generando…';
    try {
      const r = await api('/api/tts-test', { method: 'POST', body: '{}' });
      $('#ttsOut').innerHTML = `${esc(r.provider)} · ${esc(r.voice)} · ${r.durationSec.toFixed(2)} s <audio controls autoplay src="${r.url}"></audio>`;
    } catch (err) { $('#ttsOut').innerHTML = `<span style="color:var(--red)">${esc(err.message)}</span>`; }
    e.target.disabled = false;
  });
}

// ------------------------------------------------------------------ proyectos
const STATUS = { nuevo: ['Nuevo', ''], en_proceso: ['En proceso', 'b-run'], requiere_revision: ['Requiere revisión', 'b-warn'], error: ['Error', 'b-err'], terminado: ['Terminado ✔', 'b-ok'] };
const badge = (st) => `<span class="badge ${STATUS[st]?.[1] || ''}">${STATUS[st]?.[0] || esc(st)}</span>`;

async function loadProjects() {
  const { projects } = await api('/api/projects');
  $('#projects').innerHTML = projects.length ? `<table style="width:100%">${projects.map((p) => `
    <tr><td><a href="#/p/${p.id}">${esc(p.title)}</a><div class="muted">Original: ${esc(p.originalTitle)}</div></td><td>${badge(p.status)}</td><td class="muted">${p.scenes} escenas</td><td class="muted">${new Date(p.createdAt).toLocaleString('es')}</td></tr>`).join('')}</table>` : '<p class="muted">Aún no hay proyectos. Busca un video y pulsa «REPLICAR Y MEJORAR».</p>';
}

let current = null, sse = null, logEl = null;
const STEP_LABEL = { datos: 'Datos del video', analisis: 'Análisis del original', investigacion: 'Investigación', guion: 'Guion nuevo', escenas: 'Escenas', imagenes: 'Imágenes Stickman', coherencia: 'Coherencia voz–imagen', voz: 'Voz real', montaje: 'Montaje FFmpeg', verificacion: 'Verificación' };
const STEP_CLASS = { completado: 'b-ok', error: 'b-err', requiere_revision: 'b-warn', en_curso: 'b-run' };
const REVIEW = { aprobada_ia: ['Aprobada (IA)', 'b-ok'], aprobada_manual: ['Aprobada a mano', 'b-ok'], corregir: ['Corregir', 'b-err'], revision_manual: ['Revisión manual', 'b-warn'] };
const fileUrl = (rel, bust) => `/api/projects/${current.id}/file/${rel}${bust ? `?v=${encodeURIComponent(bust)}` : ''}`;

async function openProject(id) {
  showTab('proyecto');
  current = await api(`/api/projects/${id}`);
  renderProject();
  if (sse) sse.close();
  sse = new EventSource(`/api/projects/${id}/events`);
  let pending = null;
  sse.onmessage = (m) => {
    const e = JSON.parse(m.data);
    if (e.type === 'log' && logEl) appendLog(e.data);
    clearTimeout(pending);
    pending = setTimeout(async () => { current = await api(`/api/projects/${id}`); renderProject(true); }, e.type === 'log' ? 1500 : 200);
  };
}

function appendLog(l) {
  const d = document.createElement('div');
  d.className = l.level;
  d.textContent = `${new Date(l.at).toLocaleTimeString('es')}  ${l.msg}`;
  logEl.appendChild(d);
  logEl.scrollTop = logEl.scrollHeight;
}

function analysisHtml(a) {
  if (!a) return '<p class="muted">Pendiente.</p>';
  const lab = { tema: 'Tema principal', gancho: 'Gancho inicial', problema: 'Problema', promesa: 'Promesa', estructura: 'Estructura narrativa', desarrollo: 'Desarrollo', momentos_curiosidad: 'Momentos de curiosidad', datos_usados: 'Datos utilizados', conclusion: 'Conclusión' };
  const st = { verificado_en_transcripcion: ['citado en la transcripción', 'b-ok'], evidencia_no_encontrada: ['cita no encontrada: no verificado', 'b-warn'], sin_acceso: ['sin acceso', 'b-err'], no_encontrado: ['no aparece', ''], inferido_de_metadatos: ['inferido del título', 'b-warn'] };
  const val = (v) => (Array.isArray(v) ? `<ul>${v.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : esc(v ?? '—'));
  const th = a.thumbnail || {};
  return `<p><span class="badge ${a.access.nivel === 'transcripcion' ? 'b-ok' : 'b-warn'}">${a.access.nivel === 'transcripcion' ? 'Con transcripción' : 'Sólo metadatos'}</span> <span class="muted">${esc(a.access.detalle)}</span></p>
  <div class="kv">${Object.entries(a.fields).map(([k, f]) => `<div>${lab[k]} <span class="badge ${st[f.estado]?.[1] || ''}">${st[f.estado]?.[0] || f.estado}</span></div><div>${val(f.valor)}${f.evidencia ? `<div class="muted">«${esc(f.evidencia)}»</div>` : ''}${f.motivo ? `<div class="muted">${esc(f.motivo)}</div>` : ''}</div>`).join('')}
  <div>Miniatura</div><div>${th.estado === 'analizada' ? `${esc(th.composicion)}. Texto: ${esc(th.texto_visible || 'ninguno')}. Emoción: ${esc(th.emocion)}. Por qué funciona: ${esc(th.por_que_genera_clic)}` : `<span class="badge b-warn">no analizada</span> ${esc(th.motivo || '')}`}</div>
  ${a.hipotesis_atractivo?.length ? `<div>Hipótesis (no verificadas)</div><div>${val(a.hipotesis_atractivo)}</div>` : ''}
  <div>Qué mejorar en la versión propia</div><div>${val(a.oportunidades_mejora)}</div>
  <div>Enfoque para El Precio Oculto</div><div><b>${esc(a.enfoque)}</b></div></div>
  ${a.nota_datos ? `<p class="muted">${esc(a.nota_datos)}</p>` : ''}`;
}

function sceneHtml(s) {
  const img = s.image ? `<img src="${fileUrl(`imagenes/${s.id}.png`, s.image.fileHash)}" alt="Escena ${s.n}" loading="lazy">` : '<div class="noimg">Imagen pendiente</div>';
  const r = REVIEW[s.review?.state];
  return `<div class="scene" data-n="${s.n}">
    <div class="n">${s.n}</div>
    <div>
      <div class="muted">${esc(s.section)} ${s.sfx ? `· efecto: ${esc(s.sfx)}` : ''} · ${s.audioDuration ? `${s.audioDuration.toFixed(2)} s de voz` : 'voz pendiente'}</div>
      <textarea data-field="narration">${esc(s.narrationWithRefs)}</textarea>
      <div class="muted"><b>Imagen:</b> ${esc(s.visual?.description || '—')}</div>
      ${s.review ? `<div><span class="badge ${r?.[1] || ''}">${r?.[0] || esc(s.review.state)}</span> ${s.review.score != null ? `${s.review.score}/10` : ''} ${s.review.seen ? `<span class="muted">Se ve: ${esc(s.review.seen)}</span>` : ''} ${(s.review.problems || []).length ? `<div class="muted" style="color:var(--red)">${esc(s.review.problems.join('; '))}</div>` : ''} ${s.review.reason ? `<div class="muted">${esc(s.review.reason)}</div>` : ''}</div>` : ''}
      ${s.audio ? `<audio controls preload="none" src="${fileUrl(`audio/${s.id}.wav`, s.audio.textHash)}"></audio>` : ''}
      <div class="actions">
        <button data-act="narration">Guardar narración</button>
        ${s.image ? `<button data-act="approve">✔ Aprobar imagen</button><button data-act="reject">✘ Marcar para corregir</button>` : ''}
        <button data-act="regen">↻ Regenerar imagen</button>
      </div>
    </div>
    <div>${img}</div>
  </div>`;
}

function renderProject(keepLog) {
  const p = current;
  const scrollY = window.scrollY;
  const o = p.original;
  const running = p.running;
  const stepErr = Object.entries(p.steps).find(([, v]) => ['error', 'requiere_revision'].includes(v.state));
  const v = p.verification;
  const oldLog = keepLog && logEl ? logEl.innerHTML : null;
  $('#project').innerHTML = `
  <div class="card">
    <div class="actions" style="justify-content:space-between">
      <div><h2 style="margin:0">${esc(p.script?.title || o.title)}</h2><div class="muted">Basado en: <a href="${esc(o.url)}" target="_blank" rel="noopener">${esc(o.title)}</a> — ${esc(o.channelTitle)}</div></div>
      <div>${badge(p.status)} ${running ? '<span class="badge b-run">procesando…</span>' : ''}</div>
    </div>
    <div class="actions">
      <button class="primary big" id="btnGenerate" ${running ? 'disabled' : ''}>GENERAR VIDEO COMPLETO</button>
      <a ${p.canDownloadMp4 ? `href="/api/projects/${p.id}/download/mp4"` : ''}><button class="yellow big" ${p.canDownloadMp4 ? '' : 'disabled title="Disponible cuando el MP4 esté exportado y verificado"'}>DESCARGAR MP4</button></a>
      <a href="/api/projects/${p.id}/download/zip"><button>Descargar proyecto completo (ZIP)</button></a>
    </div>
    ${stepErr ? `<div class="error-box"><b>${STEP_LABEL[stepErr[0]]}:</b> ${esc(stepErr[1].message)}</div>` : ''}
    <div class="steps" style="margin-top:10px">${Object.entries(p.steps).map(([k, s]) => `<div class="step"><b>${STEP_LABEL[k]}</b><span class="badge ${STEP_CLASS[s.state] || ''}">${esc(s.state)}</span><div class="muted">${esc(s.message || '')}</div>${s.state !== 'pendiente' && !running ? `<button data-rerun="${k}" style="margin-top:4px;font-size:12px;padding:3px 8px">Repetir desde aquí</button>` : ''}</div>`).join('')}</div>
  </div>

  ${p.canDownloadMp4 ? `<div class="card"><h2>Video terminado</h2><video controls preload="metadata" src="${fileUrl('salida/video.mp4', p.render?.at)}"></video></div>` : ''}

  <div class="cols">
    <div class="card"><h2>Video original</h2>
      <img src="${esc(o.thumbnail)}" alt="" style="width:100%;border-radius:8px">
      <div class="kv" style="margin-top:8px">
        <div>Título</div><div>${esc(o.title)}</div><div>Canal</div><div>${esc(o.channelTitle)}</div>
        <div>Publicado</div><div>${o.publishedAt ? new Date(o.publishedAt).toLocaleDateString('es') : 'no disponible'}</div>
        <div>Visualizaciones</div><div>${fmt(o.views)}</div><div>Duración</div><div>${dur(o.durationSec)}</div><div>Fuente de datos</div><div>${esc(o.dataSource)}</div>
      </div>
      ${o.unavailable?.length ? `<div class="missing">No disponible sin YOUTUBE_API_KEY: ${esc(o.unavailable.join(', '))}.</div>` : ''}
      ${o.description ? `<details><summary>Descripción</summary><p class="muted" style="white-space:pre-wrap">${esc(o.description)}</p></details>` : ''}
      <h3 style="margin-top:12px">Transcripción</h3>
      ${p.transcript ? `<p><span class="badge b-ok">Disponible</span> <span class="muted">${esc(p.transcript.source)} · ${p.transcript.text.split(/\s+/).length} palabras</span></p>` : '<p class="missing">Sin transcripción. La herramienta no ha visto ni escuchado el video. Pega o sube una transcripción autorizada (.txt, .srt, .vtt) para analizar la narración.</p>'}
      <textarea id="transcript" placeholder="Pega aquí la transcripción autorizada…"></textarea>
      <div class="actions"><input type="file" id="transcriptFile" accept=".txt,.srt,.vtt"><button id="btnTranscript" ${running ? 'disabled' : ''}>Guardar transcripción</button></div>
    </div>
    <div class="card"><h2>Informe del video original</h2>${analysisHtml(p.analysis)}</div>
  </div>

  ${p.script ? `<div class="card"><h2>Guion nuevo</h2>
    <p class="muted">${p.script.words} palabras · ~${p.script.estimatedMinutes} min · ${p.script.usedSources.length} fuentes citadas${p.script.originalOverlap != null ? ` · coincidencia literal con el original: ${(p.script.originalOverlap * 100).toFixed(1)} %` : ''}</p>
    <p><b>Enfoque:</b> ${esc(p.script.angle)}</p>
    ${p.script.factCheck?.removedSentences?.length ? `<details><summary>${p.script.factCheck.removedSentences.length} oraciones eliminadas por datos no verificables</summary><ul>${p.script.factCheck.removedSentences.map((s) => `<li class="muted">${esc(s)}</li>`).join('')}</ul></details>` : ''}
    <details><summary>Leer guion completo</summary>${p.script.sections.map((s) => `<h3>${esc(s.name)}</h3>${s.paragraphs.map((x) => `<p>${esc(x)}</p>`).join('')}`).join('')}</details>
  </div>` : ''}

  ${p.research ? `<div class="card"><h2>Fuentes (${p.research.sources.length})</h2><ol>${p.research.sources.map((s) => `<li><b>[${s.id}]</b> <a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.title)}</a> <span class="muted">${esc(s.origin)}</span></li>`).join('')}</ol></div>` : ''}

  ${p.scenes.length ? `<div class="card"><h2>Escenas: narración ↔ imagen (${p.scenes.length})</h2>
    <p class="muted">Cada fragmento de narración tiene una única imagen. Lo que se escucha a la izquierda es lo que se ve a la derecha. ${p.characters ? `Personajes fijos: ${p.characters.map((c) => esc(c.name)).join(', ')}.` : ''}</p>
    ${p.steps.imagenes.state !== 'pendiente' ? `<p><img src="${fileUrl('imagenes/personajes.png')}" alt="Hoja de personajes" style="max-width:420px;width:100%;border-radius:6px" onerror="this.remove()"></p>` : ''}
    <div id="scenes">${p.scenes.map(sceneHtml).join('')}</div></div>` : ''}

  ${v ? `<div class="card"><h2>Verificación antes de exportar ${v.passed ? '<span class="badge b-ok">superada</span>' : '<span class="badge b-err">con errores</span>'}</h2>
    <ul class="checks">${v.checks.map((c) => `<li>${c.ok ? '✔' : c.warning ? '⚠' : '✘'} <b>${esc(c.label)}</b> — <span class="muted">${esc(c.detail)}</span>${c.fix ? `<div style="color:var(--red)">Cómo corregir: ${esc(c.fix)}</div>` : ''}</li>`).join('')}</ul></div>` : ''}

  ${p.deliverables ? `<div class="card"><h2>Resultado final</h2><ul>
    ${[['video', 'Video MP4'], ['guion', 'Guion completo con fuentes'], ['guionEscenas', 'Guion por escenas'], ['narracion', 'Audio de narración (MP3)'], ['miniatura', 'Miniatura'], ['titulo', 'Título'], ['descripcion', 'Descripción'], ['fuentes', 'Fuentes utilizadas']].map(([k, l]) => p.deliverables[k]?.exists ? `<li><a href="${fileUrl(p.deliverables[k].rel)}?dl" download>${l}</a></li>` : `<li class="muted">${l}: no generado</li>`).join('')}
    <li>${p.deliverables.imagenes.length} imágenes y ${p.deliverables.escenas.length} fichas de escena: incluidas en el ZIP del proyecto.</li></ul>
    ${p.render?.music ? `<p class="muted">Música: ${esc(p.render.music.type === 'archivo' ? p.render.music.file : p.render.music.note)}</p>` : ''}
    <img src="${fileUrl('salida/miniatura.png', p.render?.at)}" alt="Miniatura" style="max-width:480px;width:100%;border-radius:8px"></div>` : ''}

  <div class="card"><h2>Registro</h2><div class="log" id="log"></div></div>`;
  logEl = $('#log');
  if (oldLog) logEl.innerHTML = oldLog; else p.log.slice(-300).forEach(appendLog);
  logEl.scrollTop = logEl.scrollHeight;
  if (keepLog) window.scrollTo(0, scrollY);
  bindProject();
}

function bindProject() {
  const id = current.id;
  $('#btnGenerate')?.addEventListener('click', async () => {
    try { await api(`/api/projects/${id}/run`, { method: 'POST', body: '{}' }); toast('Generación iniciada. Puedes seguir el progreso en el registro.'); current.running = true; renderProject(true); } catch (e) { toast(e.message, 7000); }
  });
  document.querySelectorAll('[data-rerun]').forEach((b) => b.addEventListener('click', async () => {
    if (!confirm(`Se repetirá «${STEP_LABEL[b.dataset.rerun]}» y todos los pasos siguientes. ¿Continuar?`)) return;
    try { await api(`/api/projects/${id}/run`, { method: 'POST', body: JSON.stringify({ from: b.dataset.rerun, force: true }) }); } catch (e) { toast(e.message, 7000); }
  }));
  $('#transcriptFile')?.addEventListener('change', async (e) => { const f = e.target.files[0]; if (f) $('#transcript').value = await f.text(); });
  $('#btnTranscript')?.addEventListener('click', async () => {
    try { current = await api(`/api/projects/${id}/transcript`, { method: 'POST', body: JSON.stringify({ text: $('#transcript').value }) }); toast('Transcripción guardada. Pulsa «GENERAR VIDEO COMPLETO» para analizarla.'); renderProject(true); } catch (e) { toast(e.message, 7000); }
  });
  $('#scenes')?.addEventListener('click', async (e) => {
    const act = e.target.dataset?.act;
    if (!act) return;
    const el = e.target.closest('.scene');
    const n = el.dataset.n;
    const body = {};
    let action = act;
    if (act === 'narration') body.text = $('textarea', el).value;
    if (act === 'reject') body.note = prompt('¿Qué está mal en la imagen?') || 'Marcada a mano para corregir';
    if (act === 'regen') {
      action = 'regenerate-image';
      const d = prompt('Describe qué debe verse en la imagen (en español). Déjalo vacío para mantener la descripción actual.');
      if (d === null) return;
      if (d.trim()) { body.description = d.trim(); body.fix = `the image must show: ${d.trim()}`; }
    }
    e.target.disabled = true; e.target.textContent = 'Procesando…';
    try { current = await api(`/api/projects/${id}/scenes/${n}/${action}`, { method: 'POST', body: JSON.stringify(body) }); renderProject(true); toast('Escena actualizada.'); }
    catch (err) { toast(err.message, 7000); e.target.disabled = false; }
  });
}

// ------------------------------------------------------------------ router
function route() {
  const m = location.hash.match(/^#\/p\/([a-z0-9-]+)/);
  if (m) openProject(m[1]).catch((e) => toast(e.message));
  else { if (sse) sse.close(); if (!document.querySelector('.tab.active') || $('#tab-proyecto').classList.contains('active')) showTab('buscar'); }
}
window.addEventListener('hashchange', route);
route();
