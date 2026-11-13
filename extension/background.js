/* YOUTUBE AUTOMATIZADO — service worker de la extensión.
 * - Abre el panel lateral RaulitoShow IA al pulsar el icono.
 * - Guarda cada resultado de Flow: en la app local (proyecto/flow/) si está en marcha,
 *   o en Descargas/YOUTUBE_AUTOMATIZADO/<proyecto>/ si no lo está. Nunca sobrescribe.
 */
importScripts('config.js');

// Icono de la barra dibujado en tiempo de ejecución (cuadro rojo con triángulo blanco de "play").
function drawIcon() {
  const imageData = {};
  for (const s of [16, 32]) {
    const c = new OffscreenCanvas(s, s); const x = c.getContext('2d');
    x.fillStyle = '#e53935'; x.beginPath(); x.roundRect(0, 0, s, s, s / 5); x.fill();
    x.fillStyle = '#fff'; x.beginPath(); x.moveTo(s * 0.38, s * 0.27); x.lineTo(s * 0.38, s * 0.73); x.lineTo(s * 0.76, s * 0.5); x.closePath(); x.fill();
    imageData[s] = x.getImageData(0, 0, s, s);
  }
  chrome.action.setIcon({ imageData }).catch(() => {});
}
function setup() {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
  drawIcon();
}
chrome.runtime.onInstalled.addListener(setup);
chrome.runtime.onStartup.addListener(setup);
drawIcon();

async function appStatus() {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 1500);
    const r = await fetch(`${YA_CONFIG.APP_URL}/api/status`, { signal: ctrl.signal });
    clearTimeout(t);
    if (!r.ok) return { ok: false };
    const j = await r.json();
    return { ok: true, projectsDir: j.projectsDir };
  } catch { return { ok: false }; }
}

function dataUrlToBlob(dataUrl) {
  const [head, b64] = dataUrl.split(',');
  const mime = (/data:([^;]+)/.exec(head) || [])[1] || 'application/octet-stream';
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: mime });
}

async function blobToDataUrl(blob) {
  const buf = new Uint8Array(await blob.arrayBuffer());
  let s = '';
  for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
  return `data:${blob.type || 'application/octet-stream'};base64,${btoa(s)}`;
}

const EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif', 'video/mp4': 'mp4', 'video/webm': 'webm' };

function cleanProject(p) {
  return String(p || 'proyecto').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9_-]+/g, '_').replace(/^_+|_+$/g, '') || 'proyecto';
}

function waitDownload(id) {
  return new Promise((resolve, reject) => {
    const listener = delta => {
      if (delta.id !== id || !delta.state) return;
      if (delta.state.current === 'complete') {
        chrome.downloads.onChanged.removeListener(listener);
        chrome.downloads.search({ id }, items => resolve(items[0] && items[0].filename));
      } else if (delta.state.current === 'interrupted') {
        chrome.downloads.onChanged.removeListener(listener);
        reject(new Error('Descarga interrumpida'));
      }
    };
    chrome.downloads.onChanged.addListener(listener);
  });
}

// msg: { project, baseName, url? , dataUrl? }
async function saveResult(msg) {
  let blob;
  if (msg.dataUrl) blob = dataUrlToBlob(msg.dataUrl);
  else {
    const r = await fetch(msg.url, { credentials: 'include' });
    if (!r.ok) throw new Error(`No se pudo descargar el resultado (${r.status})`);
    blob = await r.blob();
  }
  if (!blob.size) throw new Error('El resultado descargado está vacío');
  const type = (blob.type || '').split(';')[0];
  const ext = EXT[type] || (type.startsWith('video/') ? 'mp4' : 'png');
  const name = `${msg.baseName}.${ext}`;
  const project = cleanProject(msg.project);

  const st = await appStatus();
  if (st.ok) {
    const r = await fetch(`${YA_CONFIG.APP_URL}/api/flow/save?project=${encodeURIComponent(project)}&name=${encodeURIComponent(name)}`, { method: 'POST', body: blob });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || 'La app no pudo guardar el archivo');
    return { where: j.path, name: j.name, via: 'app' };
  }
  const id = await chrome.downloads.download({
    url: await blobToDataUrl(blob),
    filename: `YOUTUBE_AUTOMATIZADO/${project}/${name}`,
    conflictAction: 'uniquify',
    saveAs: false,
  });
  const where = await waitDownload(id);
  return { where, name: where ? where.split(/[\\/]/).pop() : name, via: 'downloads' };
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === 'ya:saveResult') {
    saveResult(msg).then(r => sendResponse({ ok: true, ...r }), e => sendResponse({ ok: false, error: e.message }));
    return true;
  }
  if (msg && msg.type === 'ya:appStatus') {
    appStatus().then(sendResponse);
    return true;
  }
  return false;
});
