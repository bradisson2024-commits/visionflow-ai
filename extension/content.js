/* RaulitoShow IA — script de contenido de la extensión: conecta el motor (engine.js) con el
 * almacenamiento de la extensión, el guardado de resultados (background.js) y el panel lateral.
 * Estado en chrome.storage.local: ya_run (ejecución) y ya_refImage (personaje {name, type, dataUrl}).
 */
(() => {
  'use strict';
  if (window.__raulitoShowLoaded) return;
  window.__raulitoShowLoaded = true;

  const RUN_KEY = 'ya_run';
  const REF_KEY = 'ya_refImage';

  function dataUrlToFile(ref) {
    const bin = atob(ref.dataUrl.split(',')[1]); const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return new File([arr], ref.name || 'personaje.png', { type: ref.type || 'image/png' });
  }
  const blobToDataUrl = blob => new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = rej; fr.readAsDataURL(blob); });

  async function saveMedia(src, project, baseName) {
    const msg = { type: 'ya:saveResult', project, baseName };
    if (src.startsWith('blob:') || src.startsWith('data:')) msg.dataUrl = src.startsWith('data:') ? src : await blobToDataUrl(await (await fetch(src)).blob());
    else msg.url = src;
    let r = await chrome.runtime.sendMessage(msg);
    if (!r.ok && msg.url) {
      // Segundo intento: descargar desde la propia página (misma sesión de Flow).
      try {
        const resp = await fetch(src, { credentials: 'include' });
        if (resp.ok) r = await chrome.runtime.sendMessage({ type: 'ya:saveResult', project, baseName, dataUrl: await blobToDataUrl(await resp.blob()) });
      } catch { /* se informa el primer error */ }
    }
    return r;
  }

  const engine = createRaulitoEngine({
    getRun: async () => (await chrome.storage.local.get(RUN_KEY))[RUN_KEY] || null,
    setRun: run => chrome.storage.local.set({ [RUN_KEY]: run }),
    getRefFile: async () => { const ref = (await chrome.storage.local.get(REF_KEY))[REF_KEY]; return ref && ref.dataUrl ? dataUrlToFile(ref) : null; },
    saveMedia,
    timeoutMs: YA_CONFIG.GENERATION_TIMEOUT_MS,
  });

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg || !msg.type) return false;
    (async () => {
      if (msg.type === 'ya:ping') return { ok: true, url: location.href, promptBox: !!engine.findPromptBox(), human: engine.detectHumanCheck() };
      if (msg.type === 'ya:start') return engine.command('start', msg.run);
      if (msg.type === 'ya:pause') return engine.command('pause');
      if (msg.type === 'ya:resume') return engine.command('resume');
      return { ok: false, error: 'Comando desconocido' };
    })().then(sendResponse, e => sendResponse({ ok: false, error: e.message }));
    return true;
  });

  engine.recoverAfterReload();
})();
