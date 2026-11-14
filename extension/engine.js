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
  // Texto visible de un control sin los nombres de iconos (Material Symbols usa palabras como "crop_16_9").
  const ICON_WORD = /^[a-z0-9]+(_[a-z0-9]+)+$/;
  function cleanText(el) {
    const parts = [];
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const t = n.textContent.replace(/\s+/g, ' ').trim();
      if (!t) continue;
      const p = n.parentElement;
      const iconEl = p && p !== el && (p.tagName === 'I' || /(icon|symbol|material)/i.test(p.className && p.className.baseVal !== undefined ? p.className.baseVal : p.className || ''));
      if (iconEl || ICON_WORD.test(t)) continue;
      parts.push(t);
    }
    return parts.join(' ').replace(/\s+/g, ' ').trim();
  }
  const optionButtons = label => clickables().filter(el => cleanText(el) === label || (el.getAttribute('aria-label') || '').trim() === label);
  function pressEscape() {
    const t = document.activeElement || document.body;
    t.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }));
  }
  // Botón del cuadro de prompts que abre los ajustes. En Flow (nov. 2026) es el chip "Nano Banana Pro ▭ x1".
  function settingsOpener() {
    return clickables().find(el => /\bx[1-4]\b/.test(cleanText(el)) && cleanText(el) !== cleanText(el).match(/\bx[1-4]\b/)[0]) ||
      clickables().find(el => /(16:9|9:16|1:1|4:3|3:4)/.test(cleanText(el)) && !/^(16:9|9:16|1:1|4:3|3:4)$/.test(cleanText(el))) ||
      clickables().find(el => /(settings|ajustes|configuraci|tune)/i.test(labelOf(el)));
  }
  // Selecciona una opción de los ajustes de Flow por su texto (p. ej. "16:9" o "x2").
  // Devuelve true si la opción se pulsó (o ya estaba elegida) y false si no aparece en la interfaz.
  async function applyOption(label) {
    let opts = optionButtons(label);
    let opened = false;
    if (!opts.length) {
      const opener = settingsOpener();
      if (!opener) return false;
      realClick(opener); opened = true;
      for (let i = 0; i < 10 && !opts.length; i++) { await sleep(300); opts = optionButtons(label); }
    }
    if (!opts.length) { if (opened) pressEscape(); return false; }
    const target = opts.find(isSelected) || opts[0];
    if (!isSelected(target)) { realClick(target); await sleep(500); }
    return true;
  }
  async function applySettings(aspect, outputs) {
    const okA = await applyOption(aspect);
    const okX = await applyOption(outputs);
    // Cerrar el menú de ajustes si sigue abierto.
    if (optionButtons(outputs).length || optionButtons(aspect).length) {
      pressEscape(); await sleep(300);
      if (optionButtons(outputs).length && settingsOpener()) { realClick(settingsOpener()); await sleep(300); }
    }
    return { okA, okX };
  }

  // ---------------- personaje de referencia ----------------
  // Miniaturas adjuntas en el cuadro de prompts: <img> o elementos con imagen de fondo.
  function composerImages(composer) {
    const imgs = [...composer.querySelectorAll('img')].filter(visible).length;
    const bgs = [...composer.querySelectorAll('div, span, button')].filter(el => {
      if (!visible(el)) return false;
      const bg = getComputedStyle(el).backgroundImage;
      return bg && bg !== 'none' && /url\(/.test(bg);
    }).length;
    return imgs + bgs;
  }
  const UPLOAD_RE = /(upload|subir|cargar|importar|file_upload|add_photo_alternate|from computer|desde (el|tu) (equipo|ordenador|dispositivo))/i;
  const ADD_RE = /(add|añadir|agregar|upload|subir|image|imagen|ingredient|ingrediente|^\+$|add_photo|add_circle)/i;
  const findFileInput = () => [...document.querySelectorAll('input[type="file"]')].find(i => i.id !== 'ya-ref-holder');
  function setInputFile(input, file) {
    const dt = new DataTransfer(); dt.items.add(file);
    input.files = dt.files;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }
  // Prepara el interceptor del selector de archivos (extension/picker-main.js, mundo principal de la página).
  function armPicker(file) {
    let h = document.getElementById('ya-ref-holder');
    if (!h) { h = document.createElement('input'); h.type = 'file'; h.id = 'ya-ref-holder'; h.hidden = true; h.style.display = 'none'; document.documentElement.appendChild(h); }
    const dt = new DataTransfer(); dt.items.add(file); h.files = dt.files;
    document.documentElement.setAttribute('data-ya-armed', '1');
    return new Promise(res => {
      const t = setTimeout(() => { document.removeEventListener('ya-picked', on); res(false); }, 10000);
      function on() { clearTimeout(t); res(true); }
      document.addEventListener('ya-picked', on, { once: true });
    });
  }
  const disarmPicker = () => document.documentElement.removeAttribute('data-ya-armed');

  // Adjunta el personaje al cuadro de prompts de Flow. Flow (nov. 2026): botón "+" del cuadro → ventana de
  // imágenes → botón "subir" → selector de archivos. El selector se intercepta y recibe la imagen directamente.
  async function attachReference(file, composer) {
    const before = composerImages(composer);
    let input = composer.querySelector('input[type="file"]') || findFileInput();
    let opened = false;
    if (input) setInputFile(input, file);
    else {
      const picked = armPicker(file);
      const addBtn = clickables(composer).find(b => ADD_RE.test(labelOf(b)) && !SUBMIT_RE.test(labelOf(b)));
      if (addBtn) { realClick(addBtn); opened = true; await sleep(1000); }
      input = findFileInput();
      if (input) { disarmPicker(); setInputFile(input, file); }
      else {
        const up = clickables().find(b => b !== addBtn && UPLOAD_RE.test(labelOf(b)));
        if (!up) { disarmPicker(); if (opened) pressEscape(); return false; }
        realClick(up);
        if (!(await picked)) { disarmPicker(); pressEscape(); return false; }
      }
    }
    // Esperar a que Flow suba la imagen y la muestre en el cuadro (hasta 40 s).
    for (let i = 0; i < 80; i++) {
      await sleep(500);
      if (composerImages(composerOf(findPromptBox() || composer)) > before) { await closeAssetPanel(); return true; }
      const h = detectHumanCheck(); if (h && !/cuadro de prompts/.test(h)) throw new HumanNeeded(h);
      // Si Flow solo la añadió a la biblioteca, se elige la imagen recién subida (la primera de la lista).
      if (i === 10 || i === 30) {
        const tile = newestUploadedTile(file.name);
        if (tile) realClick(tile);
      }
    }
    await closeAssetPanel();
    return 'sin_confirmar';
  }
  function newestUploadedTile(name) {
    const stem = name.replace(/\.[^.]+$/, '').toLowerCase();
    const byName = clickables().find(b => stem && textOf(b).toLowerCase().includes(stem));
    if (byName) return byName;
    // La ventana de imágenes es el primer contenedor por encima del botón "subir" que contiene miniaturas.
    let panel = clickables().find(b => UPLOAD_RE.test(labelOf(b)));
    for (let i = 0; panel && i < 10; i++) {
      panel = panel.parentElement;
      const img = panel && [...panel.querySelectorAll('img')].find(im => visible(im) && !im.closest('#raulitoshow-ia-panel'));
      if (img) return img.closest('button, [role="button"], [role="option"], [role="gridcell"], [tabindex]') || img;
    }
    return null;
  }
  async function closeAssetPanel() {
    const up = clickables().find(b => UPLOAD_RE.test(labelOf(b)));
    if (!up) return;
    pressEscape(); await sleep(400);
    const still = clickables().find(b => UPLOAD_RE.test(labelOf(b)));
    if (still) {
      const close = clickables().find(b => /^(close|cerrar|×|✕|x)$/i.test(textOf(b)) || /(close|cerrar)/i.test(b.getAttribute('aria-label') || ''));
      if (close) { realClick(close); await sleep(400); }
    }
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

  // Tarjetas de resultado fallido de Flow (nov. 2026): "Failed — You've reached your usage limit…".
  const LIMIT_RE = /(usage limit|reached your (daily |monthly )?limit|l[ií]mite de uso|alcanzado (tu|el) l[ií]mite|out of credits|sin cr[eé]ditos|not enough credits|cr[eé]ditos insuficientes|quota exceeded|cuota)/i;
  const FAILED_LINE = /^(failed|error|falló|fallo|no se pudo generar|generation failed)$/i;
  function pageText() { return (document.body && document.body.innerText) || ''; }
  const countMatches = (re, text) => (text.match(new RegExp(re.source, 'gim')) || []).length;
  const failedCount = text => text.split('\n').filter(l => FAILED_LINE.test(l.trim())).length;
  function failureSnapshot() { const t = pageText(); return { limit: countMatches(LIMIT_RE, t), failed: failedCount(t) }; }
  // Mensaje de la tarjeta de error más reciente (las líneas que siguen a "Failed").
  function failureMessage() {
    const lines = pageText().split('\n').map(l => l.trim()).filter(Boolean);
    const i = lines.findIndex(l => FAILED_LINE.test(l));
    return i >= 0 ? lines.slice(i + 1, i + 3).join(' ').slice(0, 200) : '';
  }

  async function waitResults({ before, beforeButtons, beforeAlerts, beforeFail, expected, autoConfirm, sceneN }) {
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
      if (err) {
        if (LIMIT_RE.test(err)) throw new HumanNeeded(`Flow dice que alcanzaste tu límite de uso: «${err.slice(0, 160)}». Espera a que Google lo renueve (o amplía tu plan) y pulsa Reanudar: esta escena se volverá a enviar.`);
        throw new Error(`Flow informó: ${err.slice(0, 200)}`);
      }
      // Tarjetas nuevas de "Failed" en la galería de Flow
      if (beforeFail) {
        const now = failureSnapshot();
        if (now.limit > beforeFail.limit) throw new HumanNeeded(`Flow dice que alcanzaste tu límite de uso${failureMessage() ? ': «' + failureMessage() + '»' : ''}. Espera a que Google lo renueve (o amplía tu plan) y pulsa Reanudar: esta escena se volverá a enviar.`);
        if (now.failed > beforeFail.failed) throw new Error(`Flow no pudo generar esta escena${failureMessage() ? ': ' + failureMessage() : ''}`);
      }

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
      const { okA, okX } = await applySettings(cfg.aspect, cfg.outputs);
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
        // El personaje se sube UNA vez por ejecución: Flow lo conserva en el cuadro entre generaciones.
        // Solo se vuelve a subir si se adjuntó con confirmación visible y esa miniatura ya no está.
        const count = composerImages(composerOf(findPromptBox()));
        const needs = !run.refAttach ? count === 0 : (run.refAttach === 'confirmado' && count === 0);
        if (needs) {
          let ok = await attachReference(ref, composerOf(findPromptBox()));
          if (!ok) {                       // un reintento automático antes de pedir ayuda
            pressEscape(); await sleep(1500);
            ok = await attachReference(ref, composerOf(findPromptBox()));
          }
          if (!ok) {
            await patchRun(r => { r.refManual = true; });
            throw new HumanNeeded('No pude adjuntar tu personaje en Flow (lo intenté dos veces). Adjúntalo manualmente en el cuadro de Flow y pulsa Reanudar: no te lo volveré a pedir en esta ejecución.');
          }
          await patchRun(r => { r.refAttach = ok === true ? 'confirmado' : 'sin_confirmar'; });
          run.refAttach = ok === true ? 'confirmado' : 'sin_confirmar';
          if (ok === 'sin_confirmar') await log(`Escena ${scene.n}: personaje enviado a Flow (Flow no mostró miniatura reconocible; se da por adjuntado y no se volverá a subir).`);
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
    const beforeFail = failureSnapshot();

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
    const media = await waitResults({ before, beforeButtons, beforeAlerts, beforeFail, expected, autoConfirm: cfg.autoConfirm, sceneN: scene.n });

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
