/* RaulitoShow IA — panel lateral */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const SET_KEY = 'ya_settings', REF_KEY = 'ya_refImage', RUN_KEY = 'ya_run';
  const STATUS_TXT = { pending: 'Pendiente', processing: 'En proceso', done: 'Completada', error: 'Error', paused: 'En pausa' };
  const DEFAULTS = { aspect: '16:9', outputs: 'x1', prompts: '', prefix: '', startAt: 1, delay: 5, saveAsScene: true, autoConfirm: false, project: 'mi_proyecto' };
  let settings = { ...DEFAULTS };
  let run = null;
  let flowTab = null;      // {id, ready, info}
  let hasRef = false;

  const parsePrompts = txt => String(txt || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  async function saveSettings() { await chrome.storage.local.set({ [SET_KEY]: settings }); }

  // ---------- 1. Personaje ----------
  async function renderRef() {
    const ref = (await chrome.storage.local.get(REF_KEY))[REF_KEY];
    hasRef = !!(ref && ref.dataUrl);
    $('refThumb').innerHTML = hasRef ? `<img src="${ref.dataUrl}" alt="Personaje">` : '<span class="muted">Sin imagen</span>';
    $('refName').textContent = hasRef ? ref.name : 'Ninguna imagen cargada';
    $('refRemove').hidden = !hasRef;
  }
  $('refAdd').onclick = () => $('refInput').click();
  $('refInput').onchange = async e => {
    const f = e.target.files[0]; e.target.value = '';
    if (!f) return;
    if (!/^image\/(png|jpeg|webp)$/.test(f.type)) { showMsg('Formato no admitido. Usa PNG, JPG o WEBP.'); return; }
    const dataUrl = await new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = rej; fr.readAsDataURL(f); });
    await chrome.storage.local.set({ [REF_KEY]: { name: f.name, type: f.type, dataUrl } });
    renderRef();
  };
  $('refRemove').onclick = async () => { await chrome.storage.local.remove(REF_KEY); renderRef(); };

  // ---------- 2. Formato ----------
  function setupSeg(id, key) {
    const seg = $(id);
    seg.querySelectorAll('button').forEach(b => b.onclick = () => { settings[key] = b.dataset.v; renderSeg(id, key); saveSettings(); });
  }
  function renderSeg(id, key) { $(id).querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.v === settings[key])); }
  setupSeg('aspectSeg', 'aspect'); setupSeg('outputsSeg', 'outputs');

  // ---------- 3. Prompts ----------
  function renderCount() {
    const n = parsePrompts(settings.prompts).length;
    $('promptCount').textContent = `${n} ${n === 1 ? 'prompt' : 'prompts'}`;
    $('startAt').max = String(Math.max(1, n));
  }
  $('prompts').addEventListener('input', e => { settings.prompts = e.target.value; renderCount(); saveSettings(); });
  $('txtBtn').onclick = () => $('txtInput').click();
  $('txtInput').onchange = async e => {
    const f = e.target.files[0]; e.target.value = '';
    if (!f) return;
    const txt = (await f.text()).replace(/^﻿/, '');
    $('prompts').value = txt; settings.prompts = txt; renderCount(); saveSettings();
  };
  $('prefix').addEventListener('input', e => { settings.prefix = e.target.value; saveSettings(); });
  $('startAt').addEventListener('input', e => { settings.startAt = Math.max(1, parseInt(e.target.value, 10) || 1); saveSettings(); });

  // ---------- 4. Ritmo seguro ----------
  $('delay').addEventListener('input', e => { settings.delay = Number(e.target.value); $('delayText').textContent = `Pausa entre prompts: ${settings.delay} s`; saveSettings(); });
  $('saveAsScene').onchange = e => { settings.saveAsScene = e.target.checked; saveSettings(); };
  $('autoConfirm').onchange = e => { settings.autoConfirm = e.target.checked; saveSettings(); };
  $('project').addEventListener('input', e => { settings.project = e.target.value; saveSettings(); });

  // ---------- Conexión con Flow y con la app ----------
  async function findFlowTab() {
    const tabs = await chrome.tabs.query({ url: YA_CONFIG.FLOW_MATCHES });
    if (!tabs.length) return null;
    if (run && run.tabId && tabs.some(t => t.id === run.tabId)) return tabs.find(t => t.id === run.tabId);
    return tabs.find(t => t.active) || tabs[0];
  }
  async function send(tabId, msg) {
    try { return await chrome.tabs.sendMessage(tabId, msg); } catch (e) { return { ok: false, error: e.message, noScript: true }; }
  }
  async function refreshConnections() {
    const tab = await findFlowTab();
    const pill = $('flowPill').querySelector('.dot');
    const hint = $('flowHint');
    if (!tab) {
      flowTab = null; pill.className = 'dot bad';
      hint.hidden = false; hint.innerHTML = `Abre <a href="#" id="openFlow">Google Flow</a> e inicia sesión para usar RaulitoShow IA.`;
      const a = $('openFlow'); if (a) a.onclick = ev => { ev.preventDefault(); chrome.tabs.create({ url: YA_CONFIG.FLOW_URL }); };
    } else {
      const r = await send(tab.id, { type: 'ya:ping' });
      if (!r || !r.ok) {
        flowTab = { id: tab.id, ready: false }; pill.className = 'dot warn';
        hint.hidden = false; hint.textContent = 'Recarga la pestaña de Google Flow para conectar RaulitoShow IA.';
      } else {
        flowTab = { id: tab.id, ready: true, info: r };
        pill.className = r.human ? 'dot warn' : 'dot ok';
        hint.hidden = !r.human || (run && run.status === 'running');
        if (r.human) hint.textContent = r.human;
      }
    }
    const app = await chrome.runtime.sendMessage({ type: 'ya:appStatus' }).catch(() => ({ ok: false }));
    $('appPill').querySelector('.dot').className = 'dot ' + (app && app.ok ? 'ok' : 'warn');
    $('appPill').title = app && app.ok ? `App conectada: los resultados se guardan en ${app.projectsDir}` : 'App no conectada: los resultados se guardarán en Descargas/YOUTUBE_AUTOMATIZADO/';
    renderButtons();
  }

  // ---------- Ejecución ----------
  function showMsg(t) { const m = $('msg'); m.hidden = !t; m.textContent = t || ''; m.classList.remove('ok'); }

  $('startBtn').onclick = async () => {
    const prompts = parsePrompts(settings.prompts);
    if (!prompts.length) return showMsg('Escribe al menos un prompt (uno por línea) o sube un archivo .txt.');
    const startAt = Math.max(1, parseInt($('startAt').value, 10) || 1);
    if (startAt > prompts.length) return showMsg(`La escena inicial (${startAt}) es mayor que el número de prompts (${prompts.length}).`);
    if (settings.saveAsScene && !settings.project.trim()) return showMsg('Escribe el nombre del proyecto donde guardar las escenas.');
    await refreshConnections();
    if (!flowTab || !flowTab.ready) return showMsg('No hay una pestaña de Google Flow conectada. Abre Flow (o recárgalo) y vuelve a intentarlo.');
    if (run && (run.status === 'running' || run.status === 'paused')) {
      if (!confirm('Hay una ejecución sin terminar. ¿Descartarla y empezar de nuevo?')) return;
    }
    const newRun = {
      id: Date.now(), status: 'running', tabId: flowTab.id, startedAt: Date.now(), message: '', log: [],
      settingsApplied: false, refManual: false, pauseRequested: false,
      config: { aspect: settings.aspect, outputs: settings.outputs, prefix: settings.prefix, delay: settings.delay,
        saveAsScene: settings.saveAsScene, autoConfirm: settings.autoConfirm, project: settings.project.trim(), useRef: hasRef },
      scenes: prompts.slice(startAt - 1).map((p, i) => ({ n: startAt + i, prompt: p, status: 'pending', files: [] })),
    };
    const r = await send(flowTab.id, { type: 'ya:start', run: newRun });
    if (!r || !r.ok) showMsg('No se pudo iniciar en Flow: ' + (r && r.error));
  };

  $('pauseBtn').onclick = async () => {
    if (!run) return;
    const tabId = run.tabId || (flowTab && flowTab.id);
    const type = run.status === 'running' ? 'ya:pause' : 'ya:resume';
    const r = await send(tabId, { type });
    if (!r || !r.ok) showMsg('La pestaña de Flow de esta ejecución no responde. Recárgala (o vuelve a abrirla) y pulsa Reanudar.');
  };

  function renderButtons() {
    const st = run && run.status;
    $('startBtn').disabled = st === 'running';
    $('pauseBtn').disabled = !(st === 'running' || st === 'paused');
    $('pauseBtn').textContent = st === 'paused' ? '▶' : '⏸';
    $('pauseBtn').title = st === 'paused' ? 'Reanudar' : 'Pausar';
  }

  function fmtDur(ms) {
    const s = Math.max(0, Math.round(ms / 1000));
    const m = Math.floor(s / 60);
    return m ? `${m} min ${s % 60} s` : `${s} s`;
  }

  function renderRun() {
    renderButtons();
    const list = $('scenes');
    if (!run) { list.innerHTML = ''; $('doneText').textContent = '0 / 0 escenas completadas'; $('etaText').textContent = 'Tiempo restante: —'; $('bar').style.width = '0'; showMsg(''); $('log').textContent = ''; return; }
    const total = run.scenes.length;
    const done = run.scenes.filter(s => s.status === 'done');
    const errors = run.scenes.filter(s => s.status === 'error').length;
    const finished = done.length + errors;
    $('bar').style.width = total ? (100 * finished / total) + '%' : '0';
    $('doneText').textContent = `${done.length} / ${total} escenas completadas${errors ? ` · ${errors} con error` : ''}`;

    // Estimación basada SOLO en escenas reales ya completadas.
    let eta = 'Tiempo restante: —';
    const remaining = total - finished;
    if (run.status === 'done') eta = 'Terminado';
    else if (done.length && remaining) {
      const avg = done.reduce((a, s) => a + (s.t1 - s.t0), 0) / done.length;
      const cur = run.scenes.find(s => s.status === 'processing');
      const curElapsed = cur && cur.t0 ? Math.min(avg, Date.now() - cur.t0) : 0;
      const ms = avg * remaining - curElapsed + run.config.delay * 1000 * Math.max(0, remaining - (cur ? 1 : 0));
      eta = `Tiempo restante estimado: ${fmtDur(ms)}`;
    } else if (remaining) eta = 'Tiempo restante: se calcula al completar la primera escena';
    $('etaText').textContent = eta;

    let msg = run.message || '';
    if (run.status === 'running' && run.waitingUntil && run.waitingUntil > Date.now()) msg = `Ritmo seguro: siguiente prompt en ${Math.ceil((run.waitingUntil - Date.now()) / 1000)} s` + (msg ? ` · ${msg}` : '');
    showMsg(msg);
    $('msg').classList.toggle('ok', run.status === 'done');

    list.innerHTML = run.scenes.map(s => `<li>
      <b>${String(s.n).padStart(3, '0')}</b><span class="p" title="${esc(s.prompt)}">${esc(s.prompt)}</span><span class="st ${s.status}">${STATUS_TXT[s.status]}</span>
      ${s.error ? `<span class="e">${esc(s.error)}</span>` : ''}
      ${s.files && s.files.length ? `<span class="f">${s.files.map(f => esc(f.where || f.name)).join('<br>')}</span>` : (s.status === 'done' && !run.config.saveAsScene ? '<span class="f">Resultado en Flow (guardado desactivado)</span>' : '')}
    </li>`).join('');
    $('log').textContent = (run.log || []).join('\n');
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes[RUN_KEY]) { run = changes[RUN_KEY].newValue || null; renderRun(); }
    if (changes[REF_KEY]) renderRef();
  });
  setInterval(() => { if (run && (run.status === 'running')) renderRun(); }, 1000);
  setInterval(refreshConnections, 4000);
  chrome.tabs.onUpdated.addListener((id, info) => { if (info.status === 'complete') refreshConnections(); });
  chrome.tabs.onActivated.addListener(refreshConnections);

  // ---------- inicio ----------
  (async () => {
    const st = await chrome.storage.local.get([SET_KEY, RUN_KEY]);
    settings = { ...DEFAULTS, ...(st[SET_KEY] || {}) };
    run = st[RUN_KEY] || null;
    $('prompts').value = settings.prompts; $('prefix').value = settings.prefix; $('startAt').value = settings.startAt;
    $('delay').value = settings.delay; $('delayText').textContent = `Pausa entre prompts: ${settings.delay} s`;
    $('saveAsScene').checked = settings.saveAsScene; $('autoConfirm').checked = settings.autoConfirm; $('project').value = settings.project;
    renderSeg('aspectSeg', 'aspect'); renderSeg('outputsSeg', 'outputs'); renderCount();
    await renderRef(); renderRun(); refreshConnections();
  })();
})();
