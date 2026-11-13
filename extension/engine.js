/* RaulitoShow IA — motor de automatización de Google Flow (compartido por la extensión de Chrome
 * y por la versión para tablet). Trabaja DENTRO de la página real de Flow, en la sesión del usuario,
 * con los mismos controles que usaría una persona. Nunca resuelve CAPTCHA ni inicia sesión: si los
 * detecta, se pone en pausa y pide intervención humana.
 *
 * io = {
 *   getRun(): Promise<run|null>, setRun(run): Promise,   // estado persistente de la ejecución
 *   getRefFile(): Promise<File|null>,                    // personaje de referencia
 *   saveMedia(src, project, baseName): Promise<{ok, name, where, via, error}>,
 *   timeoutMs: number                                    // espera máxima por generación
 * }
 */
// eslint-disable-next-line no-unused-vars
function createRaulitoEngine(io) {
  'use strict';
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  let looping = false;

  class HumanNeeded extends Error {}

  // ---------------- almacenamiento ----------------
  const getRun = async () => (await io.getRun()) || null;
  const setRun = run => io.setRun(run);
  async function patchRun(fn) { const run = await getRun(); if (!run) return null; fn(run); run.updatedAt = Date.now(); await setRun(run); return run; }
  async function log(text) {
    await patchRun(r => { r.log = (r.log || []).concat(`${new Date().toLocaleTimeString()} ${text}`).slice(-60); });
  }

  // ---------------- utilidades DOM ----------------
  function visible(el) {
    if (!el || !el.isConnected) return false;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return false;
    const cs = getComputedStyle(el);
    return cs.visibility !== 'hidden' && cs.display !== 'none' && Number(cs.opacity) > 0.05;
  }
  const textOf = el => (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
  const labelOf = el => [el.getAttribute('aria-label'), el.getAttribute('title'), textOf(el)].filter(Boolean).join(' ').trim();
  const isDisabled = el => el.disabled || el.getAttribute('aria-disabled') === 'true';
  function clickables(root = document) {
    return [...root.querySelectorAll('button, [role="button"], [role="option"], [role="menuitem"], [role="menuitemradio"], [role="radio"], [role="tab"], [role="switch"]')].filter(visible);
  }
  function realClick(el) {
    el.scrollIntoView({ block: 'center', inline: 'center' });
    const r = el.getBoundingClientRect();
    const opts = { bubbles: true, cancelable: true, view: window, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, button: 0 };
    el.dispatchEvent(new PointerEvent('pointerdown', { ...opts, pointerType: 'mouse', isPrimary: true }));
    el.dispatchEvent(new MouseEvent('mousedown', opts));
    el.dispatchEvent(new PointerEvent('pointerup', { ...opts, pointerType: 'mouse', isPrimary: true }));
    el.dispatchEvent(new MouseEvent('mouseup', opts));
    el.click();
  }
  function isSelected(el) {
    const a = k => (el.getAttribute(k) || '').toLowerCase();
    return a('aria-selected') === 'true' || a('aria-checked') === 'true' || a('aria-pressed') === 'true' ||
      ['on', 'checked', 'active', 'selected'].includes(a('data-state')) || el.hasAttribute('data-selected');
  }

  // ---------------- detección de la interfaz de Flow ----------------
  function findPromptBox() {
    const byId = document.getElementById('PINHOLE_TEXT_AREA_ELEMENT_ID');
    if (byId && visible(byId)) return byId;
    const cands = [...document.querySelectorAll('textarea, [contenteditable="true"][role="textbox"], div[contenteditable="true"]')]
      .filter(el => visible(el) && !el.closest('[aria-hidden="true"]') && !isDisabled(el));
    if (!cands.length) return null;
    // El cuadro de prompts es el área de texto editable más grande de la página.
    cands.sort((a, b) => (b.getBoundingClientRect().width * b.getBoundingClientRect().height) - (a.getBoundingClientRect().width * a.getBoundingClientRect().height));
    return cands[0];
  }
  // Contenedor del cuadro de prompts (incluye sus botones: adjuntar, ajustes, generar).
  function composerOf(box) {
    let el = box;
    for (let i = 0; i < 8 && el.parentElement; i++) {
      el = el.parentElement;
      const btns = clickables(el).filter(b => !b.contains(box));
      if (btns.length >= 2 && el.getBoundingClientRect().height < window.innerHeight * 0.7) return el;
    }
    return box.parentElement || document.body;
  }
  function readPrompt(box) { return box.tagName === 'TEXTAREA' ? box.value : textOf(box); }
  async function setPrompt(box, text) {
    box.focus();
    if (box.tagName === 'TEXTAREA') {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
      setter.call(box, '');
      box.dispatchEvent(new Event('input', { bubbles: true }));
      setter.call(box, text);
      box.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
      box.dispatchEvent(new Event('change', { bubbles: true }));
    } else {
      const sel = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(box);
      sel.removeAllRanges(); sel.addRange(range);
      document.execCommand('delete');
      document.execCommand('insertText', false, text);
    }
    await sleep(300);
    const got = readPrompt(box).replace(/\s+/g, ' ').trim();
    if (got !== text.replace(/\s+/g, ' ').trim()) throw new Error('Flow no aceptó el texto del prompt (el cuadro no muestra el texto escrito).');
  }

  const SUBMIT_RE = /(^|\b)(generar|generate|crear|create|enviar|send|submit|arrow_forward|arrow_upward)(\b|$)/i;
  function findSubmit(composer, box) {
    const btns = clickables(composer).filter(b => !b.contains(box) && b.tagName !== 'INPUT');
    const named = btns.filter(b => SUBMIT_RE.test(labelOf(b)));
    if (named.length) return named[named.length - 1];
    return null;
  }

  function detectHumanCheck() {
    const captcha = document.querySelector('iframe[src*="recaptcha"], iframe[title*="captcha" i], iframe[src*="challenge"], #captcha, .g-recaptcha');
    if (captcha && visible(captcha)) return 'Flow muestra una verificación (CAPTCHA). Resuélvela tú en la página de Flow y pulsa Reanudar.';
    const box = findPromptBox();
    if (!box) {
      const signIn = clickables().find(b => /^(sign in|iniciar sesión|acceder|log in)$/i.test(textOf(b)));
      if (signIn) return 'Flow pide iniciar sesión. Inicia sesión en Flow y pulsa Reanudar.';
      return 'No encuentro el cuadro de prompts de Flow. Abre un proyecto en Flow (donde se escriben los prompts) y pulsa Reanudar.';
    }
    return null;
  }

  // ---------------- ajustes de Flow (formato y número de resultados) ----------------
  const OPTION_ROLES = /^(option|menuitemradio|menuitem|radio|tab)$/;
  const exactOptions = label => clickables().filter(el => textOf(el) === label || (el.getAttribute('aria-label') || '').trim() === label);
  function pressEscape() {
    const t = document.activeElement || document.body;
    t.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }));
  }
  // Selecciona una opción de los ajustes de Flow por su texto exacto (p. ej. "16:9" o "x2").
  // Devuelve true si queda seleccionada (o ya lo estaba) y false si no se encuentra en la interfaz.
  async function applyOption(label, kindRe) {
    for (let attempt = 0; attempt < 3; attempt++) {
      const opts = exactOptions(label);
      if (opts.some(isSelected)) { pressEscape(); return true; }
      const menuOpt = opts.find(el => OPTION_ROLES.test(el.getAttribute('role') || ''));
      if (menuOpt) { realClick(menuOpt); await sleep(500); pressEscape(); await sleep(200); return true; }
      if (attempt === 0) {
        // Chip de resumen del cuadro de prompts que ya muestra el valor elegido (p. ej. "Nano Banana · 16:9 · x2").
        const chip = clickables().find(el => kindRe.test(textOf(el)) && textOf(el).split(/[\s·|,/]+/).includes(label) && textOf(el) !== label);
        if (chip) return true;
      }
      // Abrir el menú de ajustes: un botón con la opción, un chip con el valor actual o el botón de ajustes.
      const opener = opts[0] || clickables().find(el => kindRe.test(textOf(el))) ||
        clickables().find(el => /(settings|ajustes|configuraci|tune)/i.test(labelOf(el)));
      if (!opener) return false;
      realClick(opener);
      await sleep(700);
      if (opts[0] && opener === opts[0] && !exactOptions(label).some(el => el !== opener)) return true; // botón directo (sin menú)
    }
    pressEscape();
    return false;
  }

  // ---------------- personaje de referencia ----------------
  function composerImages(composer) {
    return [...composer.querySelectorAll('img')].filter(visible).length;
  }
  async function attachReference(file, composer) {
    let input = composer.querySelector('input[type="file"]') || document.querySelector('input[type="file"][accept*="image"]') || document.querySelector('input[type="file"]');
    if (!input) {
      // Algunos diseños crean el input al pulsar el botón de añadir (+ / añadir imagen / ingredientes).
      const addBtn = clickables(composer).find(b => /(add|añadir|agregar|upload|subir|image|imagen|ingredient|ingrediente|^\+$|add_photo|add_circle)/i.test(labelOf(b)));
      if (addBtn) { realClick(addBtn); await sleep(800); }
      input = document.querySelector('input[type="file"]');
      if (!input) return false;
    }
    const before = composerImages(composer);
    const dt = new DataTransfer();
    dt.items.add(file);
    input.files = dt.files;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    for (let i = 0; i < 40; i++) {           // hasta 20 s para que Flow muestre la miniatura
      await sleep(500);
      if (composerImages(composer) > before) return true;
      const h = detectHumanCheck(); if (h && !/cuadro de prompts/.test(h)) throw new HumanNeeded(h);
    }
    return 'sin_confirmar';
  }

  // ---------------- resultados ----------------
  function mediaKey(el) { return el.currentSrc || el.src || (el.querySelector && el.querySelector('source') && el.querySelector('source').src) || ''; }
  function mediaElements() {
    return [...document.querySelectorAll('img, video')].filter(el => {
      const src = mediaKey(el);
      if (!src || src.startsWith('data:image/svg')) return false;
      if (el.tagName === 'IMG') { if (!el.complete || el.naturalWidth < 256 || el.naturalHeight < 144) return false; }
      return visible(el);
    });
  }
  const CONFIRM_RE = /^(confirm|confirmar|continue|continuar|approve|aprobar|proceed|proceder|accept|aceptar|yes|sí|si|ok|generate|generar|run|ejecutar|go ahead|adelante)$/i;
  const ERROR_RE = /(failed|falló|fallo|error|no se pudo|couldn'?t|could not|unable|policy|política|rechaz|blocked|bloquead|limit|límite|quota|cuota)/i;

  async function waitResults({ before, beforeButtons, beforeAlerts, expected, autoConfirm, sceneN }) {
    const t0 = Date.now();
    let found = []; let stableSince = 0; let lastCount = 0; let lastChange = Date.now();
    const clickedConfirm = new Set(); let askedHuman = false;
    while (Date.now() - t0 < io.timeoutMs) {
      await sleep(1000);
      const h = detectHumanCheck();
      if (h && !/cuadro de prompts/.test(h)) throw new HumanNeeded(h);

      // Confirmaciones del agente de Flow (botones nuevos tras enviar el prompt)
      const confirmBtns = clickables().filter(b => !beforeButtons.has(b) && CONFIRM_RE.test(textOf(b)) && !isDisabled(b));
      for (const b of confirmBtns) {
        if (clickedConfirm.has(b)) continue;
        if (autoConfirm) { clickedConfirm.add(b); realClick(b); await log(`Escena ${sceneN}: confirmado automáticamente al agente de Flow ("${textOf(b)}").`); }
        else if (!askedHuman) { askedHuman = true; await patchRun(r => { r.message = `El agente de Flow pide confirmación ("${textOf(b)}"). Confírmalo tú en Flow; la escena ${sceneN} seguirá esperando.`; }); }
      }

      // Errores visibles de Flow
      const alerts = [...document.querySelectorAll('[role="alert"], [role="status"], [aria-live="assertive"]')].filter(a => visible(a) && !beforeAlerts.has(textOf(a)));
      const err = alerts.map(textOf).find(t => t && ERROR_RE.test(t));
      if (err) throw new Error(`Flow informó: ${err.slice(0, 200)}`);

      // Medios nuevos
      const now = mediaElements().filter(el => !before.has(mediaKey(el)));
      const keys = [...new Set(now.map(mediaKey))];
      if (keys.length !== lastCount) { lastCount = keys.length; lastChange = Date.now(); stableSince = 0; }
      found = keys.map(k => now.find(el => mediaKey(el) === k));
      if (keys.length >= expected) {
        if (!stableSince) stableSince = Date.now();
        if (Date.now() - stableSince > 2500) break;
      } else if (keys.length > 0 && Date.now() - lastChange > 90000) {
        await log(`Escena ${sceneN}: Flow entregó ${keys.length} de ${expected} resultados; se guardan los recibidos.`);
        break;
      }
    }
    if (!found.length) throw new Error(`Tiempo de espera agotado (${Math.round(io.timeoutMs / 60000)} min) sin resultados nuevos en Flow.`);
    if (askedHuman) await patchRun(r => { r.message = ''; });
    return found.slice(0, expected);
  }

  async function saveMedia(el, project, baseName) {
    const r = await io.saveMedia(mediaKey(el), project, baseName);
    if (!r || !r.ok) throw new Error((r && r.error) || 'No se pudo guardar el resultado');
    return r;
  }

  // ---------------- una escena ----------------
  async function processScene(run, scene) {
    const cfg = run.config;
    const h = detectHumanCheck();
    if (h) throw new HumanNeeded(h);
    const box = findPromptBox();
    const composer = composerOf(box);

    if (!run.settingsApplied) {
      const okA = await applyOption(cfg.aspect, /(16:9|9:16|1:1|4:3|3:4)/);
      const okX = await applyOption(cfg.outputs, /\bx[1-4]\b/i);
      if (!okA || !okX) {
        await patchRun(r => { r.settingsApplied = true; });
        throw new HumanNeeded(`No pude seleccionar ${!okA ? cfg.aspect : ''}${!okA && !okX ? ' y ' : ''}${!okX ? cfg.outputs : ''} en los ajustes de Flow. Selecciónalo manualmente en Flow y pulsa Reanudar.`);
      }
      await patchRun(r => { r.settingsApplied = true; });
      await log(`Ajustes de Flow aplicados: ${cfg.aspect}, ${cfg.outputs}.`);
    }

    if (cfg.useRef) {
      const ref = await io.getRefFile();
      if (ref && !run.refManual) {
        // Se adjunta en cada prompt cuando el cuadro de Flow no conserva ya una imagen adjunta.
        if (composerImages(composerOf(findPromptBox())) === 0) {
          const ok = await attachReference(ref, composerOf(findPromptBox()));
          if (!ok) {
            await patchRun(r => { r.refManual = true; });
            throw new HumanNeeded('No encuentro dónde adjuntar imágenes en Flow. Adjunta tu personaje manualmente en el cuadro de Flow y pulsa Reanudar.');
          }
          if (ok === 'sin_confirmar') await log(`Escena ${scene.n}: personaje enviado a Flow, pero Flow no mostró miniatura de confirmación.`);
          else await log(`Escena ${scene.n}: personaje de referencia adjuntado.`);
        }
      }
    }

    const finalPrompt = cfg.prefix && cfg.prefix.trim() ? `${cfg.prefix.trim()} ${scene.prompt}` : scene.prompt;
    const pbox = findPromptBox();
    await setPrompt(pbox, finalPrompt);

    const before = new Set(mediaElements().map(mediaKey));
    const beforeButtons = new Set(clickables());
    const beforeAlerts = new Set([...document.querySelectorAll('[role="alert"], [role="status"], [aria-live="assertive"]')].map(textOf));

    // Botón de generar de Flow (espera a que se habilite)
    let submit = null;
    for (let i = 0; i < 20; i++) {
      submit = findSubmit(composerOf(pbox), pbox) || findSubmit(document, pbox);
      if (submit && !isDisabled(submit)) break;
      await sleep(500);
    }
    if (!submit || isDisabled(submit)) throw new Error('No encuentro el botón de generar de Flow habilitado.');
    realClick(submit);
    await log(`Escena ${scene.n}: prompt enviado a Flow.`);
    // Comprobar que Flow aceptó el envío (el cuadro se vacía o el botón cambia de estado).
    let accepted = false;
    for (let i = 0; i < 20 && !accepted; i++) {
      await sleep(500);
      const b = findPromptBox();
      accepted = !b || readPrompt(b).trim() !== finalPrompt.trim() || isDisabled(submit) || !submit.isConnected ||
        mediaElements().some(el => !before.has(mediaKey(el)));
    }
    if (!accepted) await log(`Escena ${scene.n}: Flow conserva el texto en el cuadro; se espera igualmente el resultado.`);

    const expected = parseInt(String(cfg.outputs).replace(/\D/g, ''), 10) || 1;
    const media = await waitResults({ before, beforeButtons, beforeAlerts, expected, autoConfirm: cfg.autoConfirm, sceneN: scene.n });

    const files = [];
    if (cfg.saveAsScene) {
      for (let k = 0; k < media.length; k++) {
        const base = `escena_${String(scene.n).padStart(3, '0')}${k ? `_${k + 1}` : ''}`;
        const r = await saveMedia(media[k], cfg.project, base);
        files.push({ name: r.name, where: r.where, via: r.via });
      }
    }
    return { files, results: media.length };
  }

  // ---------------- bucle principal ----------------
  async function waitDelay(sec) {
    const until = Date.now() + sec * 1000;
    await patchRun(r => { r.waitingUntil = until; });
    while (Date.now() < until) {
      const r = await getRun();
      if (!r || r.status !== 'running' || r.pauseRequested) break;
      await sleep(250);
    }
    await patchRun(r => { r.waitingUntil = null; });
  }

  async function loop() {
    if (looping) return;
    looping = true;
    try {
      for (;;) {
        let run = await getRun();
        if (!run || run.status !== 'running') return;
        const idx = run.scenes.findIndex(s => s.status === 'pending' || s.status === 'paused');
        if (idx < 0) {
          await patchRun(r => { r.status = 'done'; r.finishedAt = Date.now(); r.message = 'Todas las escenas han terminado.'; });
          return;
        }
        if (run.pauseRequested) {
          await patchRun(r => { r.status = 'paused'; r.pauseRequested = false; r.scenes[idx].status = 'paused'; r.message = 'En pausa. Pulsa Reanudar para continuar.'; });
          return;
        }
        run = await patchRun(r => { r.scenes[idx].status = 'processing'; r.scenes[idx].t0 = Date.now(); r.scenes[idx].error = ''; r.message = ''; });
        const scene = run.scenes[idx];
        try {
          const res = await processScene(run, scene);
          await patchRun(r => { Object.assign(r.scenes[idx], { status: 'done', t1: Date.now(), files: res.files, results: res.results }); });
          await log(`Escena ${scene.n}: completada (${res.results} resultado${res.results === 1 ? '' : 's'}${res.files.length ? `, guardado: ${res.files.map(f => f.name).join(', ')}` : ''}).`);
        } catch (e) {
          if (e instanceof HumanNeeded) {
            await patchRun(r => { r.status = 'paused'; r.pauseRequested = false; r.needsHuman = true; r.scenes[idx].status = 'paused'; r.scenes[idx].t0 = null; r.message = e.message; });
            await log(`Pausa: ${e.message}`);
            return;
          }
          await patchRun(r => { Object.assign(r.scenes[idx], { status: 'error', t1: Date.now(), error: e.message }); });
          await log(`Escena ${scene.n}: error — ${e.message}`);
        }
        run = await getRun();
        const more = run && run.scenes.some(s => s.status === 'pending');
        if (more && run.status === 'running' && !run.pauseRequested && run.config.delay > 0) await waitDelay(run.config.delay);
      }
    } finally { looping = false; }
  }

  async function command(type, run) {
    if (type === 'start') { await setRun(run); loop(); return { ok: true }; }
    if (type === 'pause') {
      await patchRun(r => {
        if (r.status !== 'running') return;
        r.pauseRequested = true;
        r.message = r.waitingUntil ? 'Pausando…' : 'Se pausará al terminar la escena en proceso.';
      });
      return { ok: true };
    }
    if (type === 'resume') {
      await patchRun(r => { if (r.status === 'paused') { r.status = 'running'; r.pauseRequested = false; r.needsHuman = false; r.message = ''; } });
      loop();
      return { ok: true };
    }
    return { ok: false, error: 'Comando desconocido' };
  }

  // Si la página se recargó a mitad de una ejecución, se pausa: no se sabe si la escena en curso llegó a enviarse.
  async function recoverAfterReload() {
    const run = await getRun();
    if (run && run.status === 'running') {
      await patchRun(r => {
        r.status = 'paused'; r.pauseRequested = false;
        const s = r.scenes.find(x => x.status === 'processing');
        if (s) { s.status = 'paused'; s.t0 = null; }
        r.message = 'La página de Flow se recargó durante la ejecución. Comprueba en Flow la última escena y pulsa Reanudar.';
      });
    }
  }

  return { command, loop, getRun, recoverAfterReload, findPromptBox, detectHumanCheck };
}
