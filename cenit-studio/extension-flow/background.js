// Motor de «Cenit · Flow». Recibe prompts de Cenit Studio y, para cada uno, en la pestaña de Google Flow:
//   1) hace clic en el cuadro «¿Qué quieres crear?», 2) borra y escribe el prompt, 3) pulsa generar,
//   4) espera la imagen nueva, 5) la sube a su escena o personaje en Cenit.
// Escribe y pulsa con teclado y ratón reales mediante chrome.debugger (Chrome muestra un aviso mientras trabaja):
// así funciona con cualquier editor, porque Flow recibe eventos idénticos a los de una persona.
const FLOW_URL = 'https://flow.google.com/';
const FLOW_TABS = ['https://flow.google.com/*', 'https://labs.google/fx/*'];
// Registro breve de lo último que hizo la extensión (para diagnóstico).
self.__log = []; const L = (...a) => { self.__log.push(a.map(String).join(' ')); if (self.__log.length > 50) self.__log.shift(); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let queue = [];
let running = false;
let ctx = null; // { base, token, tabId }

chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg?.type !== 'flow:run' || !sender.tab) return;
  ctx = { base: msg.base, token: msg.token, tabId: sender.tab.id };
  for (const it of msg.items || []) if (!queue.some((q) => q.upload === it.upload)) queue.push(it);
  badge();
  run();
});

// Pulsar el icono de la extensión estando en Flow: olvida lo aprendido y vuelve a pedir los clics.
chrome.action.onClicked.addListener(async (tab) => {
  if (!/^https:\/\/(flow\.google\.com|labs\.google\/fx)/.test(tab.url || '')) { chrome.tabs.create({ url: FLOW_URL }); return; }
  await ensureScript(tab.id);
  await send(tab.id, { cmd: 'forget' });
});

function badge() { chrome.action.setBadgeText({ text: queue.length ? String(queue.length) : '' }); chrome.action.setBadgeBackgroundColor({ color: '#059669' }); }
function notify(d) { badge(); if (ctx) chrome.tabs.sendMessage(ctx.tabId, { type: 'flow:progress', ...d }).catch(() => {}); }
const send = (tabId, m) => chrome.tabs.sendMessage(tabId, m).catch(() => null);
const say = (tabId, text, kind) => send(tabId, { cmd: 'status', text, kind });

async function ensureScript(tabId) {
  let r = await send(tabId, { cmd: 'ping' });
  if (!r) { try { await chrome.scripting.executeScript({ target: { tabId }, files: ['flow-page.js'] }); } catch { return null; } r = await send(tabId, { cmd: 'ping' }); }
  return r;
}

/** Espera a que la pestaña de Flow haya cargado y su script responda (hasta 60 s). */
async function waitReady(tabId) {
  for (let i = 0; i < 60; i++) {
    const t = await chrome.tabs.get(tabId).catch(() => null);
    if (!t) return null;
    if (t.status === 'complete' && /^https:\/\/(flow\.google\.com|labs\.google)/.test(t.url || '')) { const r = await ensureScript(tabId); if (r) return r; }
    await sleep(1000);
  }
  return null;
}

async function flowTab() {
  const tabs = (await chrome.tabs.query({ url: FLOW_TABS })).sort((a, b) => (b.active - a.active) || ((b.lastAccessed || 0) - (a.lastAccessed || 0)));
  for (const t of tabs) { const r = await ensureScript(t.id); if (r?.prompt) return t; }
  if (tabs[0]) return tabs[0];
  const t = await chrome.tabs.create({ url: FLOW_URL, active: true });
  await sleep(1500);
  await waitReady(t.id);
  return chrome.tabs.get(t.id);
}

// ------------------------------------------------------------ teclado y ratón reales (Chrome DevTools Protocol)
let attached = null;
async function attach(tabId) {
  if (attached === tabId) return;
  if (attached !== null) await detach();
  await chrome.debugger.attach({ tabId }, '1.3');
  attached = tabId;
}
async function detach() {
  if (attached === null) return;
  try { await chrome.debugger.detach({ tabId: attached }); } catch { /* ya estaba separado */ }
  attached = null;
}
chrome.debugger.onDetach.addListener(() => { attached = null; });
const cdp = (method, params) => chrome.debugger.sendCommand({ tabId: attached }, method, params);

async function click(r) {
  const x = r.x + r.w / 2, y = r.y + r.h / 2;
  await cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
  await cdp('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
  await cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
}
async function key(k, code, vk, modifiers = 0, extra = {}) {
  await cdp('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, modifiers, ...extra });
  await cdp('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, modifiers });
}
async function clearAndType(text) {
  await key('a', 'KeyA', 65, 2, { commands: ['selectAll'] }); // Ctrl + A
  await key('Backspace', 'Backspace', 8);
  await cdp('Input.insertText', { text });
}

/** Imagen resultante: la que la página pudo leer, o la descarga la extensión, o se captura en alta resolución. */
async function imageBlob(r) {
  if (r.dataUrl) return (await fetch(r.dataUrl)).blob();
  try {
    const res = await fetch(r.src, { credentials: 'include' });
    if (res.ok) { const b = await res.blob(); if (b.size > 2000) return b; }
  } catch { /* se captura de la pantalla */ }
  const scale = Math.max(1, Math.min(4, (r.natural?.w || r.rect.w) / r.rect.w));
  const shot = await cdp('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { x: r.rect.x, y: r.rect.y, width: r.rect.w, height: r.rect.h, scale } });
  return (await fetch(`data:image/png;base64,${shot.data}`)).blob();
}

// ------------------------------------------------------------ una imagen
async function generateOne(tab, it) {
  const id = tab.id;
  if (!(await waitReady(id))) return { ok: false, error: 'La pestaña de Google Flow no responde: recárgala (F5) y vuelve a pulsar el botón en Cenit.', stop: true };
  let loc = await send(id, { cmd: 'locate' });
  if (loc?.blocker) return { ok: false, error: loc.blocker, stop: true };
  if (!loc?.prompt && loc?.hint) { await click(loc.hint); await sleep(600); loc = await send(id, { cmd: 'locate' }); }
  if (!loc?.prompt) {
    notify({ status: 'aviso', message: 'Ve a la pestaña de Google Flow: si no hay un proyecto abierto, ábrelo; después haz clic UNA vez en el cuadro «¿Qué quieres crear?» (sólo la primera vez).' });
    await detach(); // el usuario hace el clic con el ratón de verdad
    if (!(await send(id, { cmd: 'calibrate', what: 'prompt' }))?.ok) return { ok: false, error: 'No se pudo localizar el cuadro de texto de Google Flow.', stop: true };
    await attach(id);
    loc = await send(id, { cmd: 'locate' });
    if (!loc?.prompt) return { ok: false, error: 'No se pudo localizar el cuadro de texto de Google Flow.', stop: true };
  }
  await say(id, `escribiendo el prompt de ${it.label}…`);
  await click(loc.prompt);
  await sleep(300);
  await clearAndType(it.prompt);
  await sleep(500);
  loc = await send(id, { cmd: 'locate' });
  if (!loc?.text || loc.text.length < Math.min(20, it.prompt.length)) return { ok: false, error: 'Google Flow no aceptó el texto en el cuadro. Pulsa el icono de la extensión en Flow y vuelve a enseñarle el cuadro.', stop: true };

  const snap0 = await send(id, { cmd: 'snapshot' }) || {};
  const before = snap0.keys || [];
  const started = async () => {
    for (let k = 0; k < 8; k++) {
      await sleep(1000);
      const [l, sn] = [await send(id, { cmd: 'locate' }), await send(id, { cmd: 'snapshot' })];
      if (!l?.text || l.text.length < Math.min(20, it.prompt.length)) return true; // Flow vació el cuadro
      if ((sn?.busy || 0) > (snap0.busy || 0) || sn?.keys?.some((k2) => !before.includes(k2))) return true; // progreso o imagen nueva
    }
    return false;
  };
  await say(id, `generando ${it.label}…`);
  if (loc.button) await click(loc.button); else await key('Enter', 'Enter', 13, 0, { text: '\r', unmodifiedText: '\r' });
  if (!(await started())) {
    if (!loc.button) {
      notify({ status: 'aviso', message: 'Ve a la pestaña de Google Flow y haz clic UNA vez en la flecha → de generar (sólo la primera vez).' });
      await detach();
      const ok = (await send(id, { cmd: 'calibrate', what: 'button' }))?.ok; // ese clic del usuario ya envía este prompt
      await attach(id);
      if (!ok) return { ok: false, error: 'No se pudo localizar el botón de generar de Google Flow.', stop: true };
    } else {
      await key('Enter', 'Enter', 13, 0, { text: '\r', unmodifiedText: '\r' });
      if (!(await started())) return { ok: false, error: 'Google Flow no empezó a generar. Pulsa el icono de la extensión en Flow para volver a enseñarle el cuadro y la flecha.', stop: true };
    }
  }
  await say(id, `esperando la imagen de ${it.label}…`);
  const r = await send(id, { cmd: 'waitImage', before, timeout: 240000 });
  if (!r?.ok) return { ok: false, error: r?.error || 'la pestaña de Flow no responde', stop: !!r?.blocker };
  const blob = await imageBlob(r);
  const fd = new FormData();
  fd.append('file', blob, 'flow.png');
  const res = await fetch(`${ctx.base}${it.upload}`, { method: 'POST', headers: { authorization: `Bearer ${ctx.token}` }, body: fd });
  if (!res.ok) return { ok: false, error: (await res.json().catch(() => ({}))).error || `Cenit respondió ${res.status}` };
  return { ok: true, kb: Math.round(blob.size / 1024) };
}

// ------------------------------------------------------------ cola
async function run() {
  if (running) return;
  running = true;
  const keepAlive = setInterval(() => chrome.runtime.getPlatformInfo(() => {}), 20000);
  let tab = null;
  try {
    L('run'); tab = await flowTab(); L('tab', tab.id, tab.url);
    await chrome.tabs.update(tab.id, { active: true });
    await chrome.windows.update(tab.windowId, { focused: true }).catch(() => {});
    await attach(tab.id); L('attached');
    let done = 0;
    while (queue.length) {
      const it = queue[0];
      notify({ status: 'generando', id: it.id, message: `Google Flow: creando ${it.label}… (${queue.length} en cola)` });
      let r;
      try { r = await generateOne(tab, it); } catch (e) { r = { ok: false, error: e.message }; } L('item', JSON.stringify(r));
      if (r.ok) { done++; notify({ status: 'lista', id: it.id, message: `${it.label}: imagen de Flow guardada ✔` }); await say(tab.id, `${it.label} guardada en Cenit ✔ (${queue.length - 1} pendientes)`); }
      else { notify({ status: 'error', id: it.id, message: `${it.label}: ${r.error}` }); await say(tab.id, `${it.label}: ${r.error}`, 'bad'); if (r.stop) { queue = []; break; } }
      queue.shift();
      badge();
      if (queue.length) await sleep(2000);
    }
    if (done) await say(tab.id, `terminado: ${done} imagen(es) enviadas a Cenit.`);
  } catch (e) {
    L('ERR', e.message, e.stack);
    notify({ status: 'error', message: `Cenit · Flow: ${e.message}` });
    if (tab) await say(tab.id, e.message, 'bad');
    queue = [];
  } finally {
    await detach();
    clearInterval(keepAlive);
    running = false;
    badge();
  }
}
