// Panel lateral del Conector Flow. Coordina: app (lista de escenas pendientes) → pestaña de Google Flow (genera)
// → app (recibe cada imagen en su escena). El panel debe permanecer abierto mientras trabaja.
const $ = (id) => document.getElementById(id);
const FLOW_URLS = ['https://flow.google.com/*', 'https://labs.google/fx/*'];
const state = { running: false, stop: false, items: [], project: null };

const log = (m) => { const t = new Date().toLocaleTimeString(); $('log').textContent += `[${t}] ${m}\n`; };
const hint = (m) => { $('hint').hidden = !m; $('hint').textContent = m || ''; };
const appUrl = () => $('appUrl').value.replace(/\/+$/, '');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function app(path, opts = {}) {
  const res = await fetch(`${appUrl()}${path}`, opts);
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(j.error || `HTTP ${res.status}`);
  return j;
}

async function flowTab() {
  const tabs = await chrome.tabs.query({ url: FLOW_URLS });
  return tabs.find((t) => t.active) || tabs[0] || null;
}

async function toPage(tabId, msg) {
  try { return await chrome.tabs.sendMessage(tabId, msg); } catch (e) { return { ok: false, error: 'La pestaña de Flow no responde: recárgala.', noScript: true }; }
}

async function checkConnections() {
  try { await app('/api/flow/proyectos'); $('sApp').className = 'dot ok'; } catch { $('sApp').className = 'dot bad'; }
  const tab = await flowTab();
  if (!tab) { $('sFlow').className = 'dot bad'; if (!state.running) hint('Abre Google Flow (flow.google.com) en una pestaña e inicia sesión.'); return null; }
  const r = await toPage(tab.id, { cmd: 'ping' });
  $('sFlow').className = `dot ${r?.ok ? (r.blocker ? 'warn' : 'ok') : 'warn'}`;
  if (!state.running) hint(r?.ok ? r.blocker || '' : 'Recarga la pestaña de Google Flow para conectar.');
  return r?.ok ? tab : null;
}

async function loadProjects() {
  const sel = $('project');
  try {
    const { items } = await app('/api/flow/proyectos');
    const prev = sel.value || localStorage.getItem('epo.project');
    sel.innerHTML = items.length ? items.map((p) => `<option value="${p.id}">${p.title.replace(/</g, '&lt;')} — ${p.pending} pendientes de ${p.total}</option>`).join('') : '<option value="">No hay proyectos con imágenes de Flow pendientes</option>';
    if (items.some((p) => String(p.id) === prev)) sel.value = prev;
    await loadItems();
  } catch (e) { sel.innerHTML = '<option value="">La app no responde</option>'; hint(`No se pudo conectar con la app en ${appUrl()} (${e.message}). ¿Está en marcha?`); }
}

async function loadItems() {
  const id = $('project').value;
  if (!id) { state.items = []; renderItems(); return; }
  localStorage.setItem('epo.project', id);
  state.project = await app(`/api/flow/proyectos/${id}`);
  state.items = state.project.items.map((it) => ({ ...it, status: 'pendiente' }));
  renderItems();
}

function renderItems() {
  const done = state.items.filter((i) => i.status === 'lista').length;
  $('items').innerHTML = state.items.map((i) => `<li class="${i.status === 'lista' ? 'ok' : i.status === 'error' ? 'err' : i.status === 'generando' ? 'run' : ''}">
    <b>${i.n === 0 ? 'Miniatura' : `Escena ${String(i.n).padStart(3, '0')}`}</b> · <span class="st">${i.status}</span>${i.error ? ` — ${i.error.replace(/</g, '&lt;')}` : ''}
    <span class="p" title="${i.narration.replace(/"/g, '&quot;')}">${i.narration.replace(/</g, '&lt;')}</span></li>`).join('');
  $('bar').style.width = state.items.length ? `${(100 * done) / state.items.length}%` : '0';
  $('summary').textContent = state.items.length ? `${done} de ${state.items.length} imágenes enviadas a la app.` : 'No hay imágenes pendientes en este proyecto.';
  $('start').disabled = state.running || !state.items.some((i) => i.status !== 'lista');
  $('stop').disabled = !state.running;
}

async function referenceDataUrl() {
  if (!$('useRef').checked) return null;
  if (!state.project?.mascot) { log('Aviso: la app no tiene guardada la referencia de la mascota (Configuración → Mascota oficial). Se envía sin referencia.'); return null; }
  const blob = await (await fetch(`${appUrl()}${state.project.mascot}`)).blob();
  return new Promise((r) => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(blob); });
}

/** Descarga la imagen generada (blob/data los resuelve la propia página; las URL las pide el panel, que tiene permiso de host). */
async function imageBlob(result) {
  if (result.dataUrl) return (await fetch(result.dataUrl)).blob();
  const res = await fetch(result.src, { credentials: 'include' });
  if (!res.ok) throw new Error(`No se pudo descargar la imagen de Flow (HTTP ${res.status}).`);
  return res.blob();
}

async function run() {
  const tab = await checkConnections();
  if (!tab) return;
  state.running = true; state.stop = false; renderItems();
  const ref = await referenceDataUrl();
  const gap = Number($('gap').value) * 1000, timeout = Number($('timeout').value) * 60000;
  let first = true;
  for (const it of state.items) {
    if (state.stop) break;
    if (it.status === 'lista') continue;
    it.status = 'generando'; it.error = null; renderItems();
    log(`Enviando ${it.n === 0 ? 'miniatura' : `escena ${it.n}`} a Flow…`);
    const r = await toPage(tab.id, { cmd: 'generate', prompt: it.prompt, reference: first ? ref : null, timeout });
    first = false;
    if (!r?.ok) {
      it.status = 'error'; it.error = r?.error || 'sin respuesta'; renderItems(); log(`✘ ${it.error}`);
      if (r?.blocker) { hint(r.blocker); break; } // CAPTCHA, inicio de sesión o límite: se detiene y avisa
      continue;
    }
    try {
      const blob = await imageBlob(r);
      await app(`/api/flow/proyectos/${state.project.id}/imagen/${it.n}`, { method: 'POST', body: blob });
      it.status = 'lista'; log(`✔ ${it.n === 0 ? 'Miniatura' : `Escena ${it.n}`} guardada en la app (${Math.round(blob.size / 1024)} KB).`);
    } catch (e) { it.status = 'error'; it.error = e.message; log(`✘ ${e.message}`); }
    renderItems();
    if (!state.stop) await sleep(gap);
  }
  state.running = false; renderItems();
  const pend = state.items.filter((i) => i.status !== 'lista').length;
  hint(pend ? `Quedan ${pend} imágenes sin terminar. Puedes volver a pulsar ENVIAR A FLOW.` : 'Listo: vuelve a la app y pulsa «Producir video».');
  await loadProjects();
}

$('start').onclick = () => run().catch((e) => { state.running = false; renderItems(); hint(e.message); });
$('stop').onclick = () => { state.stop = true; log('Se detendrá al terminar la imagen en curso.'); };
$('reload').onclick = () => { hint(''); loadProjects(); checkConnections(); };
$('project').onchange = () => loadItems().catch((e) => hint(e.message));
$('appUrl').onchange = () => { localStorage.setItem('epo.app', $('appUrl').value); loadProjects(); };
$('gap').oninput = () => { $('gapTxt').textContent = $('gap').value; };
$('timeout').oninput = () => { $('toTxt').textContent = $('timeout').value; };
$('appUrl').value = localStorage.getItem('epo.app') || $('appUrl').value;
setInterval(() => { if (!state.running) checkConnections(); }, 5000);
loadProjects();
checkConnections();
