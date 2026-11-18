// Se ejecuta dentro de Google Flow, con la sesión del usuario. Escribe el prompt, pulsa generar, espera la imagen
// nueva y la devuelve. Nunca se salta inicios de sesión, verificaciones ni límites: si los detecta, se detiene y lo dice.
(() => {
  if (window.__cenitFlow) return;
  window.__cenitFlow = true;

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const visible = (el) => { if (!el) return false; const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 4 && r.height > 4 && s.visibility !== 'hidden' && s.display !== 'none'; };
  const label = (el) => `${el.getAttribute('aria-label') || ''} ${el.getAttribute('title') || ''} ${el.textContent || ''}`.toLowerCase().replace(/\s+/g, ' ').trim();

  function blocker() {
    if (/accounts\.google\.com|signin/.test(location.href)) return 'Google Flow pide iniciar sesión. Inicia sesión y vuelve a pulsar «Flow».';
    if (document.querySelector('iframe[src*="recaptcha"], iframe[title*="captcha" i]')) return 'Google Flow muestra una verificación. Resuélvela en su pestaña y vuelve a pulsar «Flow».';
    const txt = document.body.innerText.slice(-6000).toLowerCase();
    if (/(daily limit|usage limit|out of credits|not enough credits|límite diario|límite de uso|sin créditos|créditos insuficientes|quota exceeded)/.test(txt)) return 'Google Flow indica que se acabaron tus créditos o tu límite de uso. Espera a que se renueve.';
    return null;
  }

  /** Cuadro de prompt: el editor de texto visible más grande. */
  function promptBox() {
    const c = [...document.querySelectorAll('textarea, [contenteditable="true"], [role="textbox"]')].filter(visible);
    const area = (e) => { const r = e.getBoundingClientRect(); return r.width * r.height; };
    return c.sort((a, b) => area(b) - area(a))[0] || null;
  }

  function writePrompt(box, text) {
    box.focus();
    if (box.tagName === 'TEXTAREA' || box.tagName === 'INPUT') {
      Object.getOwnPropertyDescriptor(Object.getPrototypeOf(box), 'value').set.call(box, text);
      box.dispatchEvent(new Event('input', { bubbles: true }));
      box.dispatchEvent(new Event('change', { bubbles: true }));
    } else {
      document.getSelection().selectAllChildren(box);
      if (!document.execCommand('insertText', false, text)) { box.textContent = text; box.dispatchEvent(new InputEvent('input', { bubbles: true, data: text })); }
    }
    return (box.value ?? box.textContent).trim().length > 0;
  }

  const dist = (el, br) => { const r = el.getBoundingClientRect(); return Math.hypot(r.left - br.right, r.top - br.bottom); };
  function submitButton(box) {
    const re = /(generate|generar|create|crear|send|enviar|submit|arrow_forward|arrow_upward|send_spark)/;
    const br = box.getBoundingClientRect();
    const c = [...document.querySelectorAll('button, [role="button"]')].filter((b) => visible(b) && !b.disabled && b.getAttribute('aria-disabled') !== 'true' && re.test(label(b)));
    return c.sort((a, b) => dist(a, br) - dist(b, br))[0] || null;
  }

  const key = (img) => img.currentSrc || img.src;
  const bigImages = () => [...document.querySelectorAll('img')].filter((i) => i.complete && i.naturalWidth >= 256 && i.naturalHeight >= 144 && key(i));
  async function asDataUrl(src) {
    const blob = await (await fetch(src, { credentials: 'include' })).blob();
    return new Promise((r) => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(blob); });
  }

  async function generate({ prompt, timeout = 240000 }) {
    const stop = blocker();
    if (stop) return { ok: false, error: stop, blocker: true };
    const box = promptBox();
    if (!box) return { ok: false, error: 'No encuentro el cuadro de texto de Google Flow. Abre un proyecto en Flow, elige crear imágenes y vuelve a pulsar «Flow».', blocker: true };
    const before = new Set(bigImages().map(key));
    if (!writePrompt(box, prompt)) return { ok: false, error: 'No se pudo escribir el prompt en Google Flow.' };
    await sleep(500);
    const btn = submitButton(box);
    if (btn) btn.click();
    else box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
    const t0 = Date.now();
    let found = null, seenAt = 0;
    while (Date.now() - t0 < timeout) {
      await sleep(1500);
      const b = blocker();
      if (b) return { ok: false, error: b, blocker: true };
      const fresh = bigImages().filter((i) => !before.has(key(i)));
      if (fresh.length) {
        const k = key(fresh[0]);
        if (found !== k) { found = k; seenAt = Date.now(); }
        else if (Date.now() - seenAt > 2500) { // estable: no es una vista previa a medio cargar
          const out = { ok: true, src: k };
          try { if (/^(blob:|data:)/.test(k) || new URL(k, location.href).origin === location.origin) out.dataUrl = await asDataUrl(k); } catch { /* la descarga la intenta la extensión */ }
          return out;
        }
      }
      const err = [...document.querySelectorAll('[role="alert"], [aria-live="assertive"]')].map((e) => e.innerText.trim()).find((t) => /(error|failed|couldn.t|no se pudo|inténtalo|try again|policy|política)/i.test(t));
      if (err && Date.now() - t0 > 3000) return { ok: false, error: `Google Flow informó: ${err.slice(0, 200)}` };
    }
    return { ok: false, error: `Google Flow no entregó una imagen en ${Math.round(timeout / 60000)} min. ¿Está Flow en modo imagen?` };
  }

  chrome.runtime.onMessage.addListener((msg, _s, reply) => {
    if (msg?.cmd === 'ping') { reply({ ok: true, prompt: !!promptBox(), blocker: blocker() }); return false; }
    if (msg?.cmd === 'generate') { generate(msg).then(reply, (e) => reply({ ok: false, error: e.message })); return true; }
    return false;
  });
})();
