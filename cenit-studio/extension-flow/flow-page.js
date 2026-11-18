// Se ejecuta dentro de Google Flow, con la sesión del usuario. Escribe el prompt, pulsa generar, espera la imagen
// nueva y la devuelve. Nunca se salta inicios de sesión, verificaciones ni límites: si los detecta, se detiene y lo dice.
(() => {
  if (window.__cenitFlow) return;
  window.__cenitFlow = true;

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  /** Cartel visible en Flow con el paso actual, para que el usuario (y el soporte) vea dónde se detiene. */
  function status(text, bad = false) {
    let el = document.getElementById('cenit-flow-status');
    if (!el) {
      el = document.createElement('div');
      el.id = 'cenit-flow-status';
      el.style.cssText = 'position:fixed;top:12px;left:50%;transform:translateX(-50%);z-index:2147483647;padding:10px 16px;border-radius:10px;font:600 14px system-ui,sans-serif;color:#fff;box-shadow:0 6px 24px rgba(0,0,0,.4);max-width:80vw;pointer-events:none';
      document.documentElement.appendChild(el);
    }
    el.style.background = bad ? '#b91c1c' : '#047857';
    el.textContent = `Cenit · Flow: ${text}`;
    console.log('[Cenit · Flow]', text);
  }
  const visible = (el) => { if (!el) return false; const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 4 && r.height > 4 && s.visibility !== 'hidden' && s.display !== 'none'; };
  const label = (el) => `${el.getAttribute('aria-label') || ''} ${el.getAttribute('title') || ''} ${el.textContent || ''}`.toLowerCase().replace(/\s+/g, ' ').trim();

  function blocker() {
    if (/accounts\.google\.com|signin/.test(location.href)) return 'Google Flow pide iniciar sesión. Inicia sesión y vuelve a pulsar «Flow».';
    if (document.querySelector('iframe[src*="recaptcha"], iframe[title*="captcha" i]')) return 'Google Flow muestra una verificación. Resuélvela en su pestaña y vuelve a pulsar «Flow».';
    const txt = document.body.innerText.slice(-6000).toLowerCase();
    if (/(daily limit|usage limit|out of credits|not enough credits|límite diario|límite de uso|sin créditos|créditos insuficientes|quota exceeded)/.test(txt)) return 'Google Flow indica que se acabaron tus créditos o tu límite de uso. Espera a que se renueve.';
    return null;
  }

  /** Busca también dentro de componentes con «shadow DOM». */
  function deepAll(sel, root = document, out = []) {
    out.push(...root.querySelectorAll(sel));
    for (const el of root.querySelectorAll('*')) if (el.shadowRoot) deepAll(sel, el.shadowRoot, out);
    return out;
  }
  const editable = (e) => e && (e.tagName === 'TEXTAREA' || (e.tagName === 'INPUT' && /^(text|search|)$/i.test(e.type || '')) || e.isContentEditable);
  const deepActive = () => { let a = document.activeElement; while (a?.shadowRoot?.activeElement) a = a.shadowRoot.activeElement; return a; };

  /** Cuadro de prompt: el editor visible cuyo texto de ayuda habla de crear; si no, el más bajo y grande. */
  const HELP = /(what do you want|qué quieres crear|create|crear|describe|prompt|imagina|imagine)/i;
  function helpText(el) {
    const own = `${el.getAttribute('placeholder') || ''} ${el.getAttribute('aria-label') || ''} ${el.getAttribute('aria-placeholder') || ''} ${el.dataset?.placeholder || ''}`;
    const box = el.parentElement?.parentElement?.parentElement;
    return `${own} ${box ? box.textContent.slice(0, 300) : ''}`;
  }
  const isSearch = (e) => /search|buscar/i.test(`${e.getAttribute('aria-label') || ''} ${e.getAttribute('placeholder') || ''} ${e.type || ''}`);
  function candidates() {
    return deepAll('textarea, input, [contenteditable], [role="textbox"]')
      .filter((e) => editable(e) || e.getAttribute('role') === 'textbox')
      .filter((e) => { const r = e.getBoundingClientRect(); return r.width > 40 && r.height > 0 && getComputedStyle(e).visibility !== 'hidden'; })
      .filter((e) => !isSearch(e) && !e.closest('#cenit-flow-status'));
  }
  function promptBox() {
    const c = candidates();
    if (!c.length) return null;
    const helped = c.filter((e) => HELP.test(helpText(e)));
    const pool = helped.length ? helped : c;
    return pool.sort((a, b) => b.getBoundingClientRect().top - a.getBoundingClientRect().top)[0];
  }
  /** Si el editor sólo aparece al pulsar el texto de ayuda («¿Qué quieres crear?»), lo pulsa y usa el que recibe el foco. */
  async function activatePrompt() {
    let box = promptBox();
    if (box) return box;
    const hint = deepAll('div, span, p, label').filter((e) => visible(e) && e.children.length === 0 && /(qué quieres crear|what do you want to create)/i.test(e.textContent || ''))[0];
    if (!hint) return null;
    for (const target of [hint, hint.parentElement, hint.parentElement?.parentElement]) {
      if (!target) continue;
      target.click();
      target.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      target.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
      await sleep(400);
      const a = deepActive();
      if (editable(a) && !isSearch(a)) return a;
      box = promptBox();
      if (box) return box;
    }
    return null;
  }
  function diag() {
    return `cuadros de texto: ${deepAll('textarea').length}, editables: ${deepAll('[contenteditable]').length}, role=textbox: ${deepAll('[role="textbox"]').length}, iframes: ${document.querySelectorAll('iframe').length}`;
  }

  const textOf = (box) => (box.value ?? box.innerText ?? box.textContent ?? '').trim();
  async function writePrompt(box, text) {
    box.click(); box.focus();
    if (box.tagName === 'TEXTAREA' || box.tagName === 'INPUT') {
      Object.getOwnPropertyDescriptor(Object.getPrototypeOf(box), 'value').set.call(box, text);
      box.dispatchEvent(new Event('input', { bubbles: true }));
      box.dispatchEvent(new Event('change', { bubbles: true }));
      return textOf(box).length > 0;
    }
    document.getSelection().selectAllChildren(box);
    document.execCommand('insertText', false, text);
    await sleep(300);
    if (textOf(box).length > 10) return true;
    // Editores que ignoran insertText: se simula «pegar».
    const dt = new DataTransfer(); dt.setData('text/plain', text);
    box.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    await sleep(300);
    if (textOf(box).length > 10) return true;
    box.dispatchEvent(new InputEvent('beforeinput', { inputType: 'insertText', data: text, bubbles: true, cancelable: true }));
    await sleep(300);
    return textOf(box).length > 10;
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
    const fail = (error, extra = {}) => { status(error, true); return { ok: false, error, ...extra }; };
    const stop = blocker();
    if (stop) return fail(stop, { blocker: true });
    status('buscando el cuadro de texto…');
    const box = await activatePrompt();
    if (!box) return fail(`no encuentro el cuadro de texto de Google Flow (${diag()}). Mándale una foto de esto al soporte.`, { blocker: true });
    const before = new Set(bigImages().map(key));
    status('escribiendo el prompt…');
    if (!(await writePrompt(box, prompt))) return fail(`no pude escribir en el cuadro de texto (${box.tagName.toLowerCase()}). Mándale una foto de esto al soporte.`);
    await sleep(700);
    const btn = submitButton(box);
    status(btn ? 'pulsando generar…' : 'no veo el botón de generar: pruebo con Enter…');
    if (btn) btn.click();
    else box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
    status('esperando la imagen de Flow…');
    const t0 = Date.now();
    let found = null, seenAt = 0;
    while (Date.now() - t0 < timeout) {
      await sleep(1500);
      const b = blocker();
      if (b) return fail(b, { blocker: true });
      const fresh = bigImages().filter((i) => !before.has(key(i)));
      if (fresh.length) {
        const k = key(fresh[0]);
        if (found !== k) { found = k; seenAt = Date.now(); }
        else if (Date.now() - seenAt > 2500) { // estable: no es una vista previa a medio cargar
          status('imagen lista, enviándola a Cenit…');
          const out = { ok: true, src: k };
          try { if (/^(blob:|data:)/.test(k) || new URL(k, location.href).origin === location.origin) out.dataUrl = await asDataUrl(k); } catch { /* la descarga la intenta la extensión */ }
          return out;
        }
      }
      const err = [...document.querySelectorAll('[role="alert"], [aria-live="assertive"]')].map((e) => e.innerText.trim()).find((t) => /(error|failed|couldn.t|no se pudo|inténtalo|try again|policy|política)/i.test(t));
      if (err && Date.now() - t0 > 3000) return fail(`Google Flow informó: ${err.slice(0, 200)}`);
    }
    return fail(`Google Flow no entregó una imagen en ${Math.round(timeout / 60000)} min. ¿Está Flow en modo imagen?`);
  }

  chrome.runtime.onMessage.addListener((msg, _s, reply) => {
    if (msg?.cmd === 'ping') {
      activatePrompt().then((box) => {
        if (!box && msg.wait) status(`buscando el cuadro «¿Qué quieres crear?»… (${diag()})`, msg.wait > 3);
        reply({ ok: true, prompt: !!box, blocker: blocker() });
      }, () => reply({ ok: true, prompt: false, blocker: blocker() }));
      return true;
    }
    if (msg?.cmd === 'status') { status(msg.text, msg.bad); reply({ ok: true }); return false; }
    if (msg?.cmd === 'generate') { generate(msg).then(reply, (e) => reply({ ok: false, error: e.message })); return true; }
    return false;
  });
})();
