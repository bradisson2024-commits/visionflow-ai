// Cola de la extensión «Cenit · Flow»: recibe prompts de Cenit Studio, los genera uno a uno en la pestaña de
// Google Flow y sube cada imagen a su escena o personaje en Cenit.
const FLOW_URL = 'https://flow.google.com/';
const FLOW_TABS = ['https://flow.google.com/*', 'https://labs.google/fx/*'];
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

function badge() { chrome.action.setBadgeText({ text: queue.length ? String(queue.length) : '' }); chrome.action.setBadgeBackgroundColor({ color: '#059669' }); }
function notify(d) { badge(); if (ctx) chrome.tabs.sendMessage(ctx.tabId, { type: 'flow:progress', ...d }).catch(() => {}); }
const send = (tabId, m) => chrome.tabs.sendMessage(tabId, m).catch(() => null);

/** Pestaña de Google Flow lista: prefiere la que responde con el cuadro de prompt; si una pestaña se abrió antes de
 *  instalar o actualizar la extensión, le inyecta el script. Si no hay ninguna, abre Flow. */
async function ensureScript(tabId) {
  let r = await send(tabId, { cmd: 'ping' });
  if (!r) { try { await chrome.scripting.executeScript({ target: { tabId }, files: ['flow-page.js'] }); } catch { return null; } r = await send(tabId, { cmd: 'ping' }); }
  return r;
}
async function flowTab() {
  const tabs = (await chrome.tabs.query({ url: FLOW_TABS })).sort((a, b) => (b.active - a.active) || ((b.lastAccessed || 0) - (a.lastAccessed || 0)));
  for (const t of tabs) { const r = await ensureScript(t.id); if (r?.prompt) return t; }
  if (tabs[0]) return tabs[0];
  const t = await chrome.tabs.create({ url: FLOW_URL, active: true });
  for (let i = 0; i < 60; i++) { await sleep(1000); const c = await chrome.tabs.get(t.id); if (c.status === 'complete') break; }
  return chrome.tabs.get(t.id);
}

/** Espera (hasta 3 min) a que Flow tenga el cuadro de prompt listo: el usuario puede tener que abrir un proyecto. */
async function ready(tabId) {
  let last = null;
  for (let i = 0; i < 90; i++) {
    last = await ensureScript(tabId);
    if (last?.blocker) return last;
    if (last?.prompt) return last;
    if (i === 3) notify({ status: 'aviso', message: 'En la pestaña de Google Flow abre un proyecto («Nuevo proyecto») y elige crear imágenes. La extensión empezará sola.' });
    await sleep(2000);
  }
  return last;
}

async function imageBlob(r) {
  if (r.dataUrl) return (await fetch(r.dataUrl)).blob();
  const res = await fetch(r.src, { credentials: 'include' });
  if (!res.ok) throw new Error(`no se pudo descargar la imagen de Flow (HTTP ${res.status})`);
  return res.blob();
}

async function run() {
  if (running) return;
  running = true;
  const keepAlive = setInterval(() => chrome.runtime.getPlatformInfo(() => {}), 20000);
  try {
    while (queue.length) {
      const it = queue[0];
      const tab = await flowTab();
      send(tab.id, { cmd: 'status', text: `recibido de Cenit: ${it.label} (${queue.length} en cola)` });
      const st = await ready(tab.id);
      if (!st?.prompt || st.blocker) {
        notify({ status: 'error', message: st?.blocker || 'Google Flow no está listo: abre un proyecto en Flow, elige imágenes y vuelve a pulsar «Flow».' });
        queue = []; break;
      }
      await chrome.tabs.update(tab.id, { active: true }).catch(() => {});
      notify({ status: 'generando', id: it.id, message: `Google Flow: creando ${it.label}…` });
      const r = await send(tab.id, { cmd: 'generate', prompt: it.prompt, timeout: 240000 });
      if (!r?.ok) {
        notify({ status: 'error', id: it.id, message: `${it.label}: ${r?.error || 'la pestaña de Flow no responde (recárgala).'}` });
        if (!r || r.blocker) { queue = []; break; }
        queue.shift(); continue;
      }
      try {
        const fd = new FormData();
        fd.append('file', await imageBlob(r), 'flow.png');
        const res = await fetch(`${ctx.base}${it.upload}`, { method: 'POST', headers: { authorization: `Bearer ${ctx.token}` }, body: fd });
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `Cenit respondió ${res.status}`);
        notify({ status: 'lista', id: it.id, message: `${it.label}: imagen de Flow guardada.` });
        send(tab.id, { cmd: 'status', text: `${it.label} guardada en Cenit ✔` });
      } catch (e) {
        notify({ status: 'error', id: it.id, message: `${it.label}: ${e.message}` });
      }
      queue.shift();
      if (queue.length) await sleep(4000);
    }
  } finally {
    clearInterval(keepAlive);
    running = false;
    badge();
  }
}
