// Se ejecuta dentro de la página de Google Flow, en la sesión del usuario. Escribe el prompt, pulsa generar,
// espera la imagen nueva y la devuelve al panel. Nunca intenta saltarse inicios de sesión ni CAPTCHA: si los
// detecta, se detiene y lo dice.
(() => {
  if (window.__epoFlow) return;
  window.__epoFlow = true;

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const visible = (el) => { if (!el) return false; const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 4 && r.height > 4 && s.visibility !== 'hidden' && s.display !== 'none'; };
  const label = (el) => `${el.getAttribute('aria-label') || ''} ${el.getAttribute('title') || ''} ${el.textContent || ''}`.toLowerCase().replace(/\s+/g, ' ').trim();

  function blocker() {
    if (/accounts\.google\.com|signin/.test(location.href)) return 'Flow pide iniciar sesión. Inicia sesión y vuelve a pulsar ENVIAR A FLOW.';
    if (document.querySelector('iframe[src*="recaptcha"], iframe[title*="captcha" i], #captcha')) return 'Flow muestra una verificación (CAPTCHA). Resuélvela tú en la pestaña y vuelve a pulsar ENVIAR A FLOW.';
    const txt = document.body.innerText.slice(-6000).toLowerCase();
    if (/(daily limit|usage limit|out of credits|límite diario|límite de uso|sin créditos|quota exceeded)/.test(txt)) return 'Flow indica que alcanzaste tu límite de uso o créditos. Espera a que se renueve y continúa.';
    return null;
  }

  /** Cuadro de prompt: el área de texto o editor visible más grande de la página. */
  function promptBox() {
    const c = [...document.querySelectorAll('textarea, [contenteditable="true"], [role="textbox"]')].filter(visible);
    return c.sort((a, b) => b.getBoundingClientRect().width * b.getBoundingClientRect().height - a.getBoundingClientRect().width * a.getBoundingClientRect().height)[0] || null;
  }

  function writePrompt(box, text) {
    box.focus();
    if (box.tagName === 'TEXTAREA' || box.tagName === 'INPUT') {
      const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(box), 'value').set;
      setter.call(box, text);
      box.dispatchEvent(new Event('input', { bubbles: true }));
      box.dispatchEvent(new Event('change', { bubbles: true }));
    } else {
      document.getSelection().selectAllChildren(box);
      if (!document.execCommand('insertText', false, text)) { box.textContent = text; box.dispatchEvent(new InputEvent('input', { bubbles: true, data: text })); }
    }
    return (box.value ?? box.textContent).trim().length > 0;
  }

  /** Botón de generar: el botón habilitado más cercano al cuadro cuyo texto o icono indica enviar/generar. */
  function submitButton(box) {
    const re = /(generate|generar|create|crear|send|enviar|submit|arrow_forward|arrow_upward|send_spark)/;
    const br = box.getBoundingClientRect();
    const cands = [...document.querySelectorAll('button, [role="button"]')].filter((b) => visible(b) && !b.disabled && b.getAttribute('aria-disabled') !== 'true' && re.test(label(b)));
    return cands.sort((a, b) => dist(a, br) - dist(b, br))[0] || null;
  }
  const dist = (el, br) => { const r = el.getBoundingClientRect(); return Math.hypot(r.left - br.right, r.top - br.bottom); };

  /** Adjunta la imagen de referencia mediante el selector de archivos de la página, si existe. */
  async function attachReference(dataUrl) {
    let input = [...document.querySelectorAll('input[type="file"]')].find((i) => !i.accept || /image/.test(i.accept));
    if (!input) {
      const add = [...document.querySelectorAll('button, [role="button"]')].find((b) => visible(b) && /(add|añadir|agregar|upload|subir|image|imagen|ingredient|ingrediente)/.test(label(b)) && /(add|añadir|agregar|\+|upload|subir)/.test(label(b)));
      if (add) { add.click(); await sleep(800); input = [...document.querySelectorAll('input[type="file"]')].find((i) => !i.accept || /image/.test(i.accept)); }
    }
    if (!input) return false;
    const blob = await (await fetch(dataUrl)).blob();
    const dt = new DataTransfer();
    dt.items.add(new File([blob], 'detective-precio-oculto.png', { type: 'image/png' }));
    input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await sleep(2500);
    return true;
  }

  const imgKey = (img) => img.currentSrc || img.src;
  const bigImages = () => [...document.querySelectorAll('img')].filter((i) => i.complete && i.naturalWidth >= 256 && i.naturalHeight >= 144 && imgKey(i));

  async function asDataUrl(src) {
    const blob = await (await fetch(src)).blob();
    return new Promise((r) => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(blob); });
  }

  async function generate({ prompt, reference, timeout = 240000 }) {
    const stop = blocker();
    if (stop) return { ok: false, error: stop, blocker: stop };
    const box = promptBox();
    if (!box) return { ok: false, error: 'No encuentro el cuadro de prompt de Flow. Abre un proyecto de Flow (pantalla de creación) y vuelve a intentarlo.', blocker: 'No se encontró el cuadro de prompt de Flow.' };
    let refNote = '';
    if (reference) refNote = (await attachReference(reference)) ? 'mascota adjuntada' : 'no se pudo adjuntar la mascota automáticamente';
    const before = new Set(bigImages().map(imgKey));
    if (!writePrompt(box, prompt)) return { ok: false, error: 'No se pudo escribir el prompt en Flow.' };
    await sleep(400);
    const btn = submitButton(box);
    if (btn) btn.click();
    else box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
    const t0 = Date.now();
    let found = null, seenAt = 0;
    while (Date.now() - t0 < timeout) {
      await sleep(1500);
      const b = blocker();
      if (b) return { ok: false, error: b, blocker: b };
      const fresh = bigImages().filter((i) => !before.has(imgKey(i)));
      if (fresh.length) {
        const key = imgKey(fresh[0]);
        if (found !== key) { found = key; seenAt = Date.now(); }
        else if (Date.now() - seenAt > 2500) { // estable: ya no es una vista previa a medio cargar
          const src = key;
          const result = { ok: true, src, note: refNote, width: fresh[0].naturalWidth, height: fresh[0].naturalHeight };
          if (/^(blob:|data:)/.test(src) || new URL(src, location.href).origin === location.origin) result.dataUrl = await asDataUrl(src);
          return result;
        }
      }
      const err = [...document.querySelectorAll('[role="alert"], [aria-live="assertive"]')].map((e) => e.innerText.trim()).find((t) => /(error|failed|couldn.t|no se pudo|inténtalo|try again|policy|política)/i.test(t));
      if (err && Date.now() - t0 > 3000) return { ok: false, error: `Flow informó: ${err.slice(0, 200)}` };
    }
    return { ok: false, error: `Flow no entregó una imagen en ${Math.round(timeout / 60000)} min.` };
  }

  chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
    if (msg?.cmd === 'ping') { reply({ ok: true, prompt: !!promptBox(), blocker: blocker() }); return false; }
    if (msg?.cmd === 'generate') { generate(msg).then(reply, (e) => reply({ ok: false, error: e.message })); return true; }
    return false;
  });
})();
