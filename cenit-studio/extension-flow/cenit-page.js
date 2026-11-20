// Se ejecuta en Cenit Studio (localhost). Avisa a la app de que la extensión está instalada y hace de puente:
// app → extensión (lista de prompts) y extensión → app (avance de cada imagen).
document.documentElement.dataset.cenitFlow = '1';

const toPage = (m) => window.postMessage({ source: 'cenit-ext', ...m }, location.origin);

window.addEventListener('message', (e) => {
  if (e.source !== window || e.data?.source !== 'cenit' || e.data.type !== 'flow:run') return;
  chrome.runtime.sendMessage(e.data).catch(() => toPage({ type: 'flow:progress', status: 'error', message: 'La extensión «Cenit · Flow» no responde: recarga esta página (F5).' }));
});

chrome.runtime.onMessage.addListener((m) => { if (m?.type === 'flow:progress') toPage(m); });
