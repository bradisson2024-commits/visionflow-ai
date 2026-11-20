// Se ejecuta dentro de Google Flow. No escribe ni pulsa nada por sí mismo: localiza el cuadro de texto, el botón de
// generar y las imágenes, y se los indica a la extensión, que escribe y pulsa con teclado y ratón reales (Chrome
// DevTools Protocol). Si no encuentra algo, le pide al usuario que haga clic una vez en ello y lo recuerda.
(() => {
  if (window.__cenitFlow2) return;
  window.__cenitFlow2 = true;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // ------------------------------------------------------------ cartel de estado
  function status(text, kind = 'ok') {
    let el = document.getElementById('cenit-flow-status');
    if (!el) {
      el = document.createElement('div');
      el.id = 'cenit-flow-status';
      el.style.cssText = 'position:fixed;top:12px;left:50%;transform:translateX(-50%);z-index:2147483647;padding:10px 16px;border-radius:10px;font:600 14px system-ui,sans-serif;color:#fff;box-shadow:0 6px 24px rgba(0,0,0,.45);max-width:80vw;pointer-events:none;text-align:center';
      document.documentElement.appendChild(el);
    }
    el.style.background = kind === 'bad' ? '#b91c1c' : kind === 'ask' ? '#b45309' : '#047857';
    el.style.display = text ? 'block' : 'none';
    el.textContent = text ? `Cenit · Flow: ${text}` : '';
    if (text) console.log('[Cenit · Flow]', text);
  }

  // ------------------------------------------------------------ búsqueda (incluye shadow DOM)
  function deepAll(sel, root = document, out = []) {
    out.push(...root.querySelectorAll(sel));
    for (const el of root.querySelectorAll('*')) if (el.shadowRoot) deepAll(sel, el.shadowRoot, out);
    return out;
  }
  const shown = (el) => { if (!el?.isConnected) return false; const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 4 && r.height > 4 && s.visibility !== 'hidden' && s.display !== 'none' && Number(s.opacity) > 0.05; };
  const rectOf = (el) => { const r = el.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; };
  const label = (el) => `${el.getAttribute?.('aria-label') || ''} ${el.getAttribute?.('title') || ''} ${el.textContent || ''}`.toLowerCase().replace(/\s+/g, ' ').trim();
  const isSearch = (e) => /search|buscar/i.test(`${e.getAttribute('aria-label') || ''} ${e.getAttribute('placeholder') || ''} ${e.type || ''}`);
  const textOf = (el) => (el ? (el.value ?? el.innerText ?? el.textContent ?? '') : '').trim();

  // Selector recordado: ruta de pasos (etiqueta + posición) desde <html> y a través de cada shadow root, más una
  // firma de atributos como respaldo si la página cambia.
  function pathOf(el) {
    const segs = [];
    let steps = [], cur = el;
    while (cur && cur !== document.documentElement) {
      const parent = cur.parentNode;
      if (!parent) break;
      const sibs = [...parent.children].filter((x) => x.tagName === cur.tagName);
      steps.unshift([cur.tagName, sibs.indexOf(cur)]);
      if (parent instanceof ShadowRoot) { segs.unshift(steps); steps = []; cur = parent.host; } else cur = parent;
    }
    segs.unshift(steps);
    return segs;
  }
  function walk(segs) {
    let node = document.documentElement;
    for (let k = 0; k < segs.length; k++) {
      let cur = k === 0 ? node : node.shadowRoot;
      if (!cur) return null;
      for (const [tag, idx] of segs[k]) { cur = [...cur.children].filter((x) => x.tagName === tag)[idx]; if (!cur) return null; }
      node = cur;
    }
    return node;
  }
  const signature = (el) => ({ tag: el.tagName.toLowerCase(), role: el.getAttribute('role'), aria: el.getAttribute('aria-label'), ph: el.getAttribute('placeholder'), ce: el.isContentEditable, txt: (el.textContent || '').trim().slice(0, 40) });
  function resolve(saved) {
    if (!saved) return null;
    const el = walk(saved.path);
    if (el && shown(el)) return el;
    const g = saved.sig;
    return deepAll(g.tag).find((e) => shown(e) && e.getAttribute('role') === g.role && e.getAttribute('aria-label') === g.aria && e.getAttribute('placeholder') === g.ph && e.isContentEditable === g.ce && (g.ce || (e.textContent || '').trim().slice(0, 40) === g.txt)) || null;
  }
  let calib = {};
  chrome.storage.local.get('calib').then((r) => { calib = r.calib || {}; });

  // Cuadro de prompt automático: editable visible (no la búsqueda) cuyo entorno habla de crear; si no, el más bajo.
  const HELP = /(qué quieres crear|what do you want|create|crear|describe|imagina|imagine|prompt)/i;
  function autoPrompt() {
    const c = deepAll('textarea, [contenteditable], [role="textbox"], input[type="text"]').filter((e) => (e.tagName === 'TEXTAREA' || e.tagName === 'INPUT' || e.isContentEditable || e.getAttribute('role') === 'textbox') && shown(e) && !isSearch(e) && !e.closest('#cenit-flow-status'));
    if (!c.length) return null;
    const near = (e) => `${e.getAttribute('placeholder') || ''} ${e.getAttribute('aria-label') || ''} ${e.getAttribute('aria-placeholder') || ''} ${(e.parentElement?.parentElement?.parentElement?.textContent || '').slice(0, 300)}`;
    const helped = c.filter((e) => HELP.test(near(e)));
    return (helped.length ? helped : c).sort((a, b) => b.getBoundingClientRect().top - a.getBoundingClientRect().top)[0];
  }
  // Si el editor sólo aparece al pulsar el texto de ayuda, devuelve ese texto para que la extensión haga clic en él.
  function helpHint() {
    return deepAll('div, span, p, label').find((e) => shown(e) && e.children.length === 0 && /(qué quieres crear|what do you want to create)/i.test(e.textContent || '')) || null;
  }
  function autoButton(box) {
    if (!box) return null;
    const re = /(generate|generar|create|crear|send|enviar|submit|arrow_forward|arrow_upward|send_spark)/;
    const br = box.getBoundingClientRect();
    const c = deepAll('button, [role="button"]').filter((b) => shown(b) && !b.disabled && b.getAttribute('aria-disabled') !== 'true' && re.test(label(b)) && !/agent|agente/.test(label(b)));
    const d = (el) => { const r = el.getBoundingClientRect(); return Math.hypot(r.left - br.right, r.top - br.bottom); };
    return c.filter((b) => d(b) < 400).sort((a, b) => d(a) - d(b))[0] || null;
  }
  const promptEl = () => resolve(calib.prompt) || autoPrompt();
  const buttonEl = (box) => resolve(calib.button) || autoButton(box);

  function blocker() {
    if (/accounts\.google\.com|signin/.test(location.href)) return 'Google Flow pide iniciar sesión. Inicia sesión y vuelve a pulsar el botón en Cenit.';
    if (deepAll('iframe[src*="recaptcha"], iframe[title*="captcha" i]').length) return 'Google Flow muestra una verificación. Resuélvela y vuelve a pulsar el botón en Cenit.';
    const txt = document.body.innerText.slice(-8000).toLowerCase();
    if (/(daily limit|usage limit|out of credits|not enough credits|límite diario|límite de uso|sin créditos|créditos insuficientes|no tienes suficientes créditos|quota exceeded)/.test(txt)) return 'Google Flow indica que se acabaron tus créditos o tu límite de uso.';
    return null;
  }

  // ------------------------------------------------------------ calibración (el usuario hace clic una vez)
  function calibrate(what) {
    return new Promise((resolveP) => {
      status(what === 'prompt' ? 'abre un proyecto si no lo está y haz clic UNA vez dentro del cuadro «¿Qué quieres crear?» para enseñármelo.' : 'haz clic UNA vez en la flecha → (el botón de generar) para enseñármelo.', 'ask');
      const on = (e) => {
        const el = e.composedPath()[0];
        if (!(el instanceof Element) || el.closest('#cenit-flow-status')) return;
        let target = el;
        if (what === 'prompt') target = el.closest('textarea, [contenteditable="true"], [contenteditable=""], [role="textbox"]') || deepAll('textarea, [contenteditable], [role="textbox"]').find((x) => x.contains(el)) || el;
        else target = el.closest('button, [role="button"]') || el;
        document.removeEventListener('click', on, true);
        calib[what] = { path: pathOf(target), sig: signature(target) };
        chrome.storage.local.set({ calib });
        status(what === 'prompt' ? 'cuadro de texto aprendido ✔' : 'botón de generar aprendido ✔');
        resolveP(true);
      };
      document.addEventListener('click', on, true);
      setTimeout(() => { document.removeEventListener('click', on, true); resolveP(false); }, 180000);
    });
  }

  // ------------------------------------------------------------ imágenes resultantes
  const key = (img) => img.currentSrc || img.src;
  const bigImages = () => deepAll('img').filter((i) => i.complete && i.naturalWidth >= 256 && i.naturalHeight >= 144 && key(i) && shown(i));
  async function asDataUrl(src) {
    const res = await fetch(src, { credentials: 'include' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const blob = await res.blob();
    if (!/^image\//.test(blob.type) && blob.size < 2000) throw new Error('no es una imagen');
    return new Promise((r) => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(blob); });
  }
  async function waitImage(before, timeout) {
    const t0 = Date.now();
    let found = null, seenAt = 0;
    while (Date.now() - t0 < timeout) {
      await sleep(1500);
      const b = blocker();
      if (b) return { ok: false, error: b, blocker: true };
      const fresh = bigImages().filter((i) => !before.includes(key(i)));
      if (fresh.length) {
        const img = fresh[0], k = key(img);
        if (found !== k) { found = k; seenAt = Date.now(); continue; }
        if (Date.now() - seenAt < 2500) continue; // espera a que deje de cambiar (vista previa → final)
        status('imagen lista, enviándola a Cenit…');
        img.scrollIntoView({ block: 'center' });
        await sleep(400);
        const out = { ok: true, src: k, rect: rectOf(img), natural: { w: img.naturalWidth, h: img.naturalHeight } };
        try { out.dataUrl = await asDataUrl(k); } catch { /* la extensión la descarga o la captura */ }
        return out;
      }
      const err = deepAll('[role="alert"], [aria-live="assertive"], [aria-live="polite"]').map((e) => (e.innerText || '').trim()).find((t) => /(error|failed|couldn.t|no se pudo|inténtalo|try again|policy|política|infring)/i.test(t));
      if (err && Date.now() - t0 > 4000) return { ok: false, error: `Google Flow informó: ${err.slice(0, 200)}` };
    }
    return { ok: false, error: `Google Flow no entregó una imagen en ${Math.round(timeout / 60000)} min. Comprueba que Flow está en modo imagen (Nano Banana).` };
  }

  // ------------------------------------------------------------ mensajes de la extensión
  chrome.runtime.onMessage.addListener((msg, _s, reply) => {
    (async () => {
      switch (msg?.cmd) {
        case 'ping': { const box = promptEl(); return { ok: true, prompt: !!box, blocker: blocker() }; }
        case 'status': status(msg.text, msg.kind); return { ok: true };
        case 'locate': {
          const box = promptEl();
          const hint = box ? null : helpHint();
          const btn = box ? buttonEl(box) : null;
          return { ok: true, prompt: box ? rectOf(box) : null, hint: hint ? rectOf(hint) : null, button: btn ? rectOf(btn) : null, text: textOf(box), blocker: blocker(), calibrated: { prompt: !!calib.prompt, button: !!calib.button } };
        }
        case 'snapshot': return { ok: true, keys: bigImages().map(key), busy: deepAll('[role="progressbar"], progress').filter(shown).length + deepAll('div, span').filter((e) => e.children.length === 0 && /^\s*\d{1,3}\s?%\s*$/.test(e.textContent || '') && shown(e)).length };
        case 'calibrate': return { ok: await calibrate(msg.what) };
        case 'forget': calib = {}; await chrome.storage.local.remove('calib'); status('he olvidado la calibración; la próxima vez te pediré que hagas clic.'); return { ok: true };
        case 'waitImage': return waitImage(msg.before || [], msg.timeout || 240000);
        default: return { ok: false, error: 'orden desconocida' };
      }
    })().then(reply, (e) => reply({ ok: false, error: e.message }));
    return true;
  });
})();
