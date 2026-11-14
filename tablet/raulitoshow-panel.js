/* RaulitoShow IA para tablet — panel flotante que se abre DENTRO de la página real de Google Flow
 * al pulsar el marcador "RaulitoShow" (bookmarklet). Usa el mismo motor que la extensión
 * (extension/engine.js, que el script de construcción antepone a este archivo).
 *
 * - Interfaz en Shadow DOM, creada sin innerHTML (compatible con Trusted Types de Google).
 * - Estado en localStorage de la página de Flow; personaje de referencia en IndexedDB.
 * - Resultados: descarga del navegador como escena_001.png… (carpeta Descargas). Nunca sobrescribe:
 *   Chrome añade (1), (2)… si el nombre ya existe.
 */
(() => {
  'use strict';
  const HOST_ID = 'raulitoshow-ia-panel';
  const existing = document.getElementById(HOST_ID);
  if (existing) { existing.__toggle && existing.__toggle(); return; }

  const RUN_KEY = 'ya_run', SET_KEY = 'ya_settings';
  const STATUS_TXT = { pending: 'Pendiente', processing: 'En proceso', done: 'Completada', error: 'Error', paused: 'En pausa' };
  const DEFAULTS = { aspect: '16:9', outputs: 'x1', prompts: '', prefix: '', startAt: 1, delay: 5, saveAsScene: true, autoConfirm: false };
  const lsGet = (k, d) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } };
  const parsePrompts = t => RaulitoTxt.prompts(t);

  // ---------- IndexedDB: personaje de referencia ----------
  function idb() {
    return new Promise((res, rej) => {
      const r = indexedDB.open('raulitoshow_ia', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('kv');
      r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
    });
  }
  async function idbGet(key) { const db = await idb(); return new Promise((res, rej) => { const q = db.transaction('kv').objectStore('kv').get(key); q.onsuccess = () => res(q.result || null); q.onerror = () => rej(q.error); }); }
  async function idbSet(key, val) { const db = await idb(); return new Promise((res, rej) => { const tx = db.transaction('kv', 'readwrite'); val == null ? tx.objectStore('kv').delete(key) : tx.objectStore('kv').put(val, key); tx.oncomplete = res; tx.onerror = () => rej(tx.error); }); }

  // ---------- Guardado de resultados (descarga del navegador) ----------
  const EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif', 'video/mp4': 'mp4', 'video/webm': 'webm' };
  async function saveMedia(src, project, baseName) {
    let blob;
    try {
      const r = await fetch(src, { credentials: 'include' });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      blob = await r.blob();
    } catch (e) {
      return { ok: false, error: `No se pudo descargar el resultado automáticamente (${e.message}). Descárgalo desde Flow.` };
    }
    if (!blob.size) return { ok: false, error: 'El resultado descargado está vacío.' };
    const type = (blob.type || '').split(';')[0];
    const name = `${baseName}.${EXT[type] || (type.startsWith('video/') ? 'mp4' : 'png')}`;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = name; a.style.display = 'none';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    return { ok: true, name, where: `Descargas/${name}`, via: 'download' };
  }

  // ---------- Motor ----------
  let run = lsGet(RUN_KEY, null);
  const engine = createRaulitoEngine({
    getRun: async () => lsGet(RUN_KEY, null),
    setRun: async r => { if (!lsSet(RUN_KEY, r)) throw new Error('No se pudo guardar el progreso en el navegador.'); run = r; scheduleRender(); },
    getRefFile: async () => { const ref = await idbGet('ref').catch(() => null); return ref ? new File([ref.blob], ref.name, { type: ref.blob.type }) : null; },
    saveMedia,
    timeoutMs: 10 * 60 * 1000,
  });

  // ---------- UI (Shadow DOM, sin innerHTML) ----------
  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (k === 'class') el.className = v;
      else if (k in el && typeof v !== 'string') el[k] = v;
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid.nodeType ? kid : String(kid));
    return el;
  }
  const CSS = `
  :host { all: initial; }
  * { box-sizing: border-box; }
  .wrap { position: fixed; top: 0; right: 0; bottom: 0; width: min(360px, 92vw); z-index: 2147483646; background: #0d0e12; color: #e9eaf0;
    font: 14px/1.4 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; border-left: 1px solid #2a2d38; box-shadow: -8px 0 24px rgba(0,0,0,.45);
    overflow-y: auto; padding: 0 12px 16px; padding-right: max(12px, env(safe-area-inset-right, 0px)); padding-bottom: max(16px, env(safe-area-inset-bottom, 0px)); }
  .wrap[hidden], .fab[hidden], [hidden] { display: none !important; }
  .fab { position: fixed; right: max(14px, env(safe-area-inset-right, 0px)); bottom: max(14px, env(safe-area-inset-bottom, 0px)); z-index: 2147483646;
    width: 56px; height: 56px; border-radius: 50%; border: 0; background: #e53935; color: #fff; font-size: 20px; box-shadow: 0 6px 18px rgba(0,0,0,.4); cursor: pointer; }
  button, input, textarea { font: inherit; color: inherit; }
  button { background: #1e2029; border: 1px solid #2a2d38; border-radius: 8px; padding: 8px 12px; cursor: pointer; min-height: 40px; }
  button:disabled { opacity: .45; }
  button:focus-visible, input:focus-visible, textarea:focus-visible { outline: 2px solid #4c9dff; outline-offset: 2px; }
  .head { position: sticky; top: 0; z-index: 2; display: flex; align-items: center; gap: 8px; padding: 10px 0; background: #0d0e12; border-bottom: 1px solid #2a2d38; margin-bottom: 8px; }
  .logo { width: 28px; height: 28px; border-radius: 7px; background: #e53935; display: grid; place-items: center; font-size: 12px; color: #fff; }
  .name { font-weight: 800; font-size: 16px; } .name b { color: #e53935; }
  .pill { margin-left: auto; display: inline-flex; align-items: center; gap: 5px; padding: 3px 9px; border-radius: 99px; background: #1e2029; border: 1px solid #2a2d38; font-size: 12px; }
  .dot { width: 8px; height: 8px; border-radius: 50%; background: #9a9db0; } .dot.ok { background: #35c46a; } .dot.bad { background: #e53935; } .dot.warn { background: #f2b33d; }
  .min { min-height: 34px; padding: 4px 10px; }
  .txtbtn { width: 100%; font-weight: 800; border-style: dashed; border-color: #4a4f60; }
  .txtmsg { border-radius: 8px; padding: 6px 9px; font-size: 12px; background: #0f2418; border: 1px solid #1f5a37; color: #9fe8bb; }
  .txtmsg.err { background: #26100f; border-color: #6b2522; color: #ffb3ad; }
  .sec { background: #16181f; border: 1px solid #2a2d38; border-radius: 10px; padding: 10px; margin-bottom: 8px; display: flex; flex-direction: column; gap: 8px; }
  h2 { margin: 0; font-size: 14px; display: flex; align-items: center; gap: 7px; }
  .n { width: 22px; height: 22px; border-radius: 50%; background: #e53935; color: #fff; display: inline-grid; place-items: center; font-size: 11px; font-weight: 800; }
  .ref { display: flex; align-items: center; gap: 8px; }
  .thumb { width: 64px; height: 64px; border-radius: 8px; background: #0f1016; border: 1px solid #2a2d38; display: grid; place-items: center; overflow: hidden; font-size: 10px; color: #9a9db0; text-align: center; flex: none; }
  .thumb img { width: 100%; height: 100%; object-fit: cover; }
  .plus { width: 44px; height: 44px; font-size: 22px; padding: 0; flex: none; }
  .refinfo { min-width: 0; display: grid; gap: 2px; } .refinfo span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .link { background: none; border: 0; color: #4c9dff; padding: 0; min-height: 0; text-align: left; }
  .seg { display: grid; grid-template-columns: repeat(4, 1fr); gap: 4px; }
  .seg button { padding: 8px 0; font-weight: 600; }
  .seg button.on { background: #e53935; border-color: #e53935; color: #fff; }
  textarea, input[type=text], input[type=number] { background: #0f1016; border: 1px solid #2a2d38; border-radius: 7px; padding: 7px 9px; width: 100%; }
  textarea { min-height: 110px; resize: vertical; }
  .row { display: flex; gap: 6px; align-items: center; justify-content: space-between; }
  .muted { color: #9a9db0; } .small { font-size: 12px; } .count { font-weight: 700; }
  .field { display: flex; flex-direction: column; gap: 3px; font-size: 13px; color: #9a9db0; }
  .inline { flex-direction: row; align-items: center; justify-content: space-between; } .inline input { width: 80px; }
  .check { display: flex; gap: 8px; align-items: center; } .check input { width: 20px; height: 20px; accent-color: #e53935; }
  input[type=range] { width: 100%; accent-color: #e53935; }
  .btns { display: flex; gap: 6px; }
  .start { flex: 1; background: #e53935; border-color: #e53935; color: #fff; font-weight: 800; font-size: 16px; letter-spacing: 1px; padding: 12px; }
  .pause { width: 56px; font-size: 16px; }
  .bar { height: 9px; border-radius: 99px; background: #0f1016; border: 1px solid #2a2d38; overflow: hidden; margin: 8px 0 4px; }
  .bar div { height: 100%; width: 0; background: #e53935; transition: width .3s; }
  .msg { background: #231d10; border: 1px solid #6b5420; color: #f5d08a; border-radius: 8px; padding: 7px 9px; font-size: 13px; margin-top: 6px; }
  .msg.ok { background: #0f2418; border-color: #1f5a37; color: #9fe8bb; }
  ol { list-style: none; padding: 0; margin: 8px 0 0; display: flex; flex-direction: column; gap: 3px; }
  li { display: grid; grid-template-columns: 34px minmax(0, 1fr) auto; gap: 6px; align-items: start; background: #16181f; border: 1px solid #2a2d38; border-radius: 7px; padding: 5px 7px; font-size: 12px; }
  li .p { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  li .e { grid-column: 2 / 4; color: #ff5248; font-size: 11px; } li .f { grid-column: 2 / 4; color: #9a9db0; font-size: 11px; overflow-wrap: anywhere; }
  .st { font-size: 11px; padding: 1px 6px; border-radius: 99px; white-space: nowrap; }
  .st.pending { background: #2a2d38; color: #9a9db0; } .st.processing { background: #3a2e10; color: #f2b33d; } .st.done { background: #10301d; color: #35c46a; }
  .st.error { background: #3a1513; color: #ff5248; } .st.paused { background: #16263d; color: #4c9dff; }
  details { margin-top: 8px; } summary { cursor: pointer; color: #9a9db0; font-size: 12px; }
  pre { white-space: pre-wrap; font-size: 11px; color: #9a9db0; max-height: 160px; overflow-y: auto; margin: 4px 0 0; }
  @media (prefers-reduced-motion: reduce) { .bar div { transition: none; } }`;

  const host = h('div', { id: HOST_ID });
  const shadow = host.attachShadow({ mode: 'open' });
  try { const sheet = new CSSStyleSheet(); sheet.replaceSync(CSS); shadow.adoptedStyleSheets = [sheet]; }
  catch { shadow.append(h('style', {}, CSS)); }

  let settings = { ...DEFAULTS, ...lsGet(SET_KEY, {}) };
  const saveSettings = () => lsSet(SET_KEY, settings);
  const el = {};

  const segBtns = (key, values) => h('div', { class: 'seg' }, values.map(v => h('button', { type: 'button', 'data-v': v, onclick: () => { settings[key] = v; saveSettings(); renderSegs(); } }, v)));
  el.aspectSeg = segBtns('aspect', ['16:9', '9:16', '1:1', '4:3']);
  el.outputsSeg = segBtns('outputs', ['x1', 'x2', 'x3', 'x4']);
  el.outputsSeg.title = 'Número de resultados que Flow genera por cada prompt';
  el.refInput = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp', hidden: true, onchange: onRefPicked });
  el.refThumb = h('div', { class: 'thumb' }, 'Sin imagen');
  el.refName = h('span', { class: 'small' }, 'Ninguna imagen cargada');
  el.refRemove = h('button', { type: 'button', class: 'link small', hidden: true, onclick: async () => { await idbSet('ref', null); renderRef(); } }, 'Quitar');
  el.prompts = h('textarea', { placeholder: 'Un prompt por línea. Cada línea es una escena.', oninput: e => { settings.prompts = e.target.value; saveSettings(); renderCount(); } });
  el.count = h('span', { class: 'count' }, '0 prompts');
  el.txtMsg = h('div', { class: 'txtmsg', hidden: true });
  async function loadTxt(file) {
    try {
      const { text, encoding } = await RaulitoTxt.read(file);
      el.prompts.value = text; settings.prompts = text; saveSettings(); renderCount();
      const n = RaulitoTxt.prompts(text).length;
      el.txtMsg.hidden = false; el.txtMsg.classList.toggle('err', !n);
      el.txtMsg.textContent = RaulitoTxt.message(file.name, n) + (encoding.startsWith('UTF-8') ? '' : ` (codificación ${encoding})`);
    } catch (err) { el.txtMsg.hidden = false; el.txtMsg.classList.add('err'); el.txtMsg.textContent = err.message; }
  }
  el.txtInput = h('input', { type: 'file', accept: '.txt,text/plain', hidden: true, onchange: e => { const f = e.target.files[0]; e.target.value = ''; if (f) loadTxt(f); } });
  el.prompts.addEventListener('dragover', e => { if ([...e.dataTransfer.types].includes('Files')) e.preventDefault(); });
  el.prompts.addEventListener('drop', e => { const f = e.dataTransfer.files && e.dataTransfer.files[0]; if (f) { e.preventDefault(); loadTxt(f); } });
  el.prefix = h('input', { type: 'text', placeholder: 'Ej.: Estilo cinematográfico, luz cálida,', oninput: e => { settings.prefix = e.target.value; saveSettings(); } });
  el.startAt = h('input', { type: 'number', min: '1', value: '1', oninput: e => { settings.startAt = Math.max(1, parseInt(e.target.value, 10) || 1); saveSettings(); } });
  el.delay = h('input', { type: 'range', min: '0', max: '14', step: '1', oninput: e => { settings.delay = Number(e.target.value); saveSettings(); el.delayText.textContent = `Pausa entre prompts: ${settings.delay} s`; } });
  el.delayText = h('div', { class: 'small' });
  el.saveAsScene = h('input', { type: 'checkbox', onchange: e => { settings.saveAsScene = e.target.checked; saveSettings(); } });
  el.autoConfirm = h('input', { type: 'checkbox', onchange: e => { settings.autoConfirm = e.target.checked; saveSettings(); } });
  el.start = h('button', { type: 'button', class: 'start', onclick: onStart }, 'INICIAR');
  el.pause = h('button', { type: 'button', class: 'pause', disabled: true, onclick: onPause, title: 'Pausar / Reanudar', 'aria-label': 'Pausar o reanudar' }, '❚❚');
  el.barFill = h('div');
  el.doneText = h('span', {}, '0 / 0 escenas completadas');
  el.etaText = h('span', {}, 'Tiempo restante: —');
  el.msg = h('div', { class: 'msg', hidden: true });
  el.list = h('ol');
  el.log = h('pre');
  el.flowDot = h('span', { class: 'dot' });

  const panel = h('div', { class: 'wrap', role: 'complementary', 'aria-label': 'RaulitoShow IA' },
    h('div', { class: 'head' },
      h('div', { class: 'logo' }, '▶'), h('div', { class: 'name' }, 'RaulitoShow ', h('b', {}, 'IA')),
      h('span', { class: 'pill', title: 'Cuadro de prompts de Flow' }, el.flowDot, 'Flow'),
      h('button', { type: 'button', class: 'min', title: 'Minimizar', 'aria-label': 'Minimizar panel', onclick: () => setOpen(false) }, '—')),
    h('section', { class: 'sec' }, h('h2', {}, h('span', { class: 'n' }, '1'), 'Personaje de referencia'),
      h('div', { class: 'ref' }, el.refThumb, h('button', { type: 'button', class: 'plus', title: 'Añadir o reemplazar imagen', onclick: () => el.refInput.click() }, '+'),
        h('div', { class: 'refinfo' }, el.refName, el.refRemove)), el.refInput),
    h('section', { class: 'sec' }, h('h2', {}, h('span', { class: 'n' }, '2'), 'Formato'), el.aspectSeg, el.outputsSeg,
      h('div', { class: 'small muted' }, 'Modelo: el que tengas elegido en Flow')),
    h('section', { class: 'sec' }, h('h2', {}, h('span', { class: 'n' }, '3'), 'Prompts'),
      h('button', { type: 'button', class: 'txtbtn', onclick: () => el.txtInput.click() }, '📄 CARGAR ARCHIVO TXT'), el.txtInput, el.prompts,
      h('div', { class: 'row' }, el.count, el.range = h('span', { class: 'small muted' })), el.txtMsg,
      h('label', { class: 'field' }, 'Prefijo de estilo', el.prefix),
      h('label', { class: 'field inline' }, 'Empezar en la escena', el.startAt)),
    h('section', { class: 'sec' }, h('h2', {}, h('span', { class: 'n' }, '4'), 'Ritmo seguro'), el.delay, el.delayText,
      h('label', { class: 'check' }, el.saveAsScene, 'Guardar como escena_001, escena_002...'),
      h('label', { class: 'check' }, el.autoConfirm, 'Confirmar automáticamente al agente de Flow')),
    h('div', { class: 'btns' }, el.start, el.pause),
    h('div', { class: 'bar' }, el.barFill),
    h('div', { class: 'row small' }, el.doneText, el.etaText),
    el.msg, el.list,
    h('details', {}, h('summary', {}, 'Registro'), el.log),
    h('div', { class: 'small muted', style: 'margin-top:10px' }, 'Mantén esta pestaña de Flow abierta y en primer plano mientras trabaja. Los resultados se guardan en Descargas.'));
  const fab = h('button', { type: 'button', class: 'fab', hidden: true, title: 'Abrir RaulitoShow IA', 'aria-label': 'Abrir RaulitoShow IA', onclick: () => setOpen(true) }, '▶');
  shadow.append(panel, fab);
  function setOpen(open) { panel.hidden = !open; fab.hidden = open; }
  host.__toggle = () => setOpen(panel.hidden);
  document.documentElement.appendChild(host);

  // ---------- Lógica del panel ----------
  async function onRefPicked(e) {
    const f = e.target.files[0]; e.target.value = '';
    if (!f) return;
    if (!/^image\/(png|jpeg|webp)$/.test(f.type)) return showMsg('Formato no admitido. Usa PNG, JPG o WEBP.');
    try { await idbSet('ref', { name: f.name, blob: f }); } catch { return showMsg('No se pudo guardar la imagen en el navegador.'); }
    renderRef();
  }
  async function renderRef() {
    const ref = await idbGet('ref').catch(() => null);
    el.refThumb.textContent = '';
    if (ref) { const u = URL.createObjectURL(ref.blob); el.refThumb.append(h('img', { src: u, alt: 'Personaje' })); }
    else el.refThumb.append('Sin imagen');
    el.refName.textContent = ref ? ref.name : 'Ninguna imagen cargada';
    el.refRemove.hidden = !ref;
    return !!ref;
  }
  function renderSegs() {
    for (const [seg, key] of [[el.aspectSeg, 'aspect'], [el.outputsSeg, 'outputs']]) seg.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.v === settings[key]));
  }
  function renderCount() {
    const n = parsePrompts(settings.prompts).length;
    el.count.textContent = `${n} ${n === 1 ? 'prompt' : 'prompts'}`;
    if (el.range) el.range.textContent = n ? `Escenas ${RaulitoTxt.pad(1)}–${RaulitoTxt.pad(n)}` : '';
  }
  function showMsg(t, ok) { el.msg.hidden = !t; el.msg.textContent = t || ''; el.msg.classList.toggle('ok', !!ok); }

  async function onStart() {
    const prompts = parsePrompts(settings.prompts);
    if (!prompts.length) return showMsg('Escribe al menos un prompt (uno por línea) o sube un archivo .txt.');
    const startAt = Math.max(1, parseInt(el.startAt.value, 10) || 1);
    if (startAt > prompts.length) return showMsg(`La escena inicial (${startAt}) es mayor que el número de prompts (${prompts.length}).`);
    const human = engine.detectHumanCheck();
    if (human) return showMsg(human);
    if (run && (run.status === 'running' || run.status === 'paused') && !confirmRestart) {
      confirmRestart = true; showMsg('Hay una ejecución sin terminar. Pulsa INICIAR otra vez para descartarla y empezar de nuevo.');
      return;
    }
    confirmRestart = false;
    const hasRef = !!(await idbGet('ref').catch(() => null));
    await engine.command('start', {
      id: Date.now(), status: 'running', startedAt: Date.now(), message: '', log: [], settingsApplied: false, refManual: false, pauseRequested: false,
      config: { aspect: settings.aspect, outputs: settings.outputs, prefix: settings.prefix, delay: settings.delay, saveAsScene: settings.saveAsScene,
        autoConfirm: settings.autoConfirm, project: 'tablet', useRef: hasRef },
      scenes: prompts.slice(startAt - 1).map((p, i) => ({ n: startAt + i, prompt: p, status: 'pending', files: [] })),
    });
  }
  let confirmRestart = false;
  async function onPause() { if (!run) return; await engine.command(run.status === 'running' ? 'pause' : 'resume'); }

  const fmtDur = ms => { const s = Math.max(0, Math.round(ms / 1000)); const m = Math.floor(s / 60); return m ? `${m} min ${s % 60} s` : `${s} s`; };
  let renderQueued = false;
  function scheduleRender() { if (!renderQueued) { renderQueued = true; requestAnimationFrame(() => { renderQueued = false; renderRun(); }); } }
  function renderRun() {
    const st = run && run.status;
    el.start.disabled = st === 'running';
    el.pause.disabled = !(st === 'running' || st === 'paused');
    el.pause.textContent = st === 'paused' ? '▶' : '❚❚';
    el.flowDot.className = 'dot ' + (engine.findPromptBox() ? 'ok' : 'warn');
    el.list.textContent = '';
    if (!run) { el.barFill.style.width = '0'; el.doneText.textContent = '0 / 0 escenas completadas'; el.etaText.textContent = 'Tiempo restante: —'; el.log.textContent = ''; return; }
    const total = run.scenes.length;
    const done = run.scenes.filter(s => s.status === 'done');
    const errors = run.scenes.filter(s => s.status === 'error').length;
    const finished = done.length + errors;
    el.barFill.style.width = total ? (100 * finished / total) + '%' : '0';
    el.doneText.textContent = `${done.length} / ${total} escenas completadas${errors ? ` · ${errors} con error` : ''}`;
    let eta = 'Tiempo restante: —'; const remaining = total - finished;
    if (st === 'done') eta = 'Terminado';
    else if (done.length && remaining) {
      const avg = done.reduce((a, s) => a + (s.t1 - s.t0), 0) / done.length;
      const cur = run.scenes.find(s => s.status === 'processing');
      const curElapsed = cur && cur.t0 ? Math.min(avg, Date.now() - cur.t0) : 0;
      eta = `Tiempo restante estimado: ${fmtDur(avg * remaining - curElapsed + run.config.delay * 1000 * Math.max(0, remaining - (cur ? 1 : 0)))}`;
    } else if (remaining) eta = 'Tiempo restante: se calcula al completar la primera escena';
    el.etaText.textContent = eta;
    let msg = run.message || '';
    if (st === 'running' && run.waitingUntil && run.waitingUntil > Date.now()) msg = `Ritmo seguro: siguiente prompt en ${Math.ceil((run.waitingUntil - Date.now()) / 1000)} s` + (msg ? ` · ${msg}` : '');
    if (!confirmRestart) showMsg(msg, st === 'done');
    for (const s of run.scenes) {
      el.list.append(h('li', {}, h('b', {}, String(s.n).padStart(3, '0')), h('span', { class: 'p', title: s.prompt }, s.prompt), h('span', { class: 'st ' + s.status }, STATUS_TXT[s.status]),
        s.error ? h('span', { class: 'e' }, s.error) : null,
        s.files && s.files.length ? h('span', { class: 'f' }, s.files.map(f => f.where || f.name).join(' · ')) : (s.status === 'done' && !run.config.saveAsScene ? h('span', { class: 'f' }, 'Resultado en Flow (guardado desactivado)') : null)));
    }
    el.log.textContent = (run.log || []).join('\n');
  }
  setInterval(() => { if (run && run.status === 'running') renderRun(); else el.flowDot.className = 'dot ' + (engine.findPromptBox() ? 'ok' : 'warn'); }, 1000);

  // ---------- inicio ----------
  el.prompts.value = settings.prompts; el.prefix.value = settings.prefix; el.startAt.value = String(settings.startAt);
  el.delay.value = String(settings.delay); el.delayText.textContent = `Pausa entre prompts: ${settings.delay} s`;
  el.saveAsScene.checked = settings.saveAsScene; el.autoConfirm.checked = settings.autoConfirm;
  renderSegs(); renderCount(); renderRef();
  // Si la página se recargó a mitad de una ejecución, queda en pausa (el motor no sabe si la escena llegó a enviarse).
  engine.recoverAfterReload().then(() => { run = lsGet(RUN_KEY, null); renderRun(); });
})();
