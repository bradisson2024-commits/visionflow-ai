/* Editor RaulitoShow IA — lógica de la interfaz */
(() => {
  'use strict';
  const T = window.Timing;
  const $ = id => document.getElementById(id);
  const IMG_RE = /\.(png|jpe?g|webp|gif|bmp|avif)$/i;
  const AUDIO_RE = /\.(mp3|wav|m4a)$/i;
  const ZOOM = 0.08; // igual que el exportador (1.00x → 1.08x)
  const natural = (a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });

  const state = {
    projectId: null,
    images: [],       // [{file, kind, label}]
    durations: [],
    audio: null,      // {file, name, duration}
    text: '',
    zoom: true,
    quality: '1080p',
    dist: null,       // {method, message, warning}
  };
  let parsed = { mode: 'none', lines: [], cues: [] };
  let selected = 0;
  let curTime = 0;
  let playing = false;
  let lastTick = 0;
  const imgCache = new Map();

  // ---------- API ----------
  async function api(path, opt = {}) {
    const r = await fetch(path, opt);
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || `Error ${r.status}`);
    return j;
  }
  const pid = () => encodeURIComponent(state.projectId);
  const fileUrl = (kind, file) => `/api/projects/${pid()}/files/${kind}/${encodeURIComponent(file)}`;
  async function upload(kind, file, name) {
    return api(`/api/projects/${pid()}/files/${kind}?name=${encodeURIComponent(name || file.name)}`, { method: 'POST', body: file });
  }

  let saveTimer = null;
  function save() {
    clearTimeout(saveTimer);
    $('saveState').textContent = 'Guardando…';
    saveTimer = setTimeout(async () => {
      try {
        await api(`/api/projects/${pid()}/editor`, { method: 'PUT', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ images: state.images, durations: state.durations, audio: state.audio, text: state.text,
            zoom: state.zoom, quality: state.quality, dist: state.dist }) });
        $('saveState').textContent = 'Guardado';
      } catch (e) { $('saveState').textContent = 'No se pudo guardar: ' + e.message; }
    }, 400);
  }

  // ---------- Proyecto ----------
  async function initProjects() {
    let list = await api('/api/projects');
    if (!list.length) list = [await api('/api/projects', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Mi primer video' }) })];
    const want = new URLSearchParams(location.search).get('project');
    $('projectSel').innerHTML = list.map(p => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join('');
    await openProject(list.some(p => p.id === want) ? want : list[0].id);
  }
  async function openProject(id) {
    pause();
    state.projectId = id;
    $('projectSel').value = id;
    history.replaceState(null, '', '/editor?project=' + encodeURIComponent(id));
    const p = await api('/api/projects/' + pid());
    const e = p.editor || {};
    state.images = Array.isArray(e.images) ? e.images : [];
    state.durations = Array.isArray(e.durations) && e.durations.length === state.images.length ? e.durations : state.images.map(() => 4);
    state.audio = e.audio || null;
    state.text = e.text || '';
    state.zoom = e.zoom !== false;
    state.quality = e.quality || '1080p';
    state.dist = e.dist || null;
    $('zoomChk').checked = state.zoom;
    $('qualitySel').value = state.quality;
    $('sceneText').value = state.text;
    parsed = T.parseSceneText(state.text);
    imgCache.clear();
    selected = 0; curTime = 0;
    $('exportBox').hidden = true;
    renderAudio();
    renderAll();
    $('saveState').textContent = '';
  }
  $('projectSel').onchange = e => openProject(e.target.value);

  // ---------- 1. Imágenes ----------
  function readEntries(dirEntry) {
    return new Promise((resolve, reject) => {
      const reader = dirEntry.createReader(); const all = [];
      const next = () => reader.readEntries(batch => { if (!batch.length) resolve(all); else { all.push(...batch); next(); } }, reject);
      next();
    });
  }
  async function walk(entry, prefix, out) {
    if (entry.isFile) {
      const file = await new Promise((res, rej) => entry.file(res, rej));
      out.push({ file, rel: prefix + file.name });
    } else if (entry.isDirectory) {
      for (const e of await readEntries(entry)) await walk(e, prefix + entry.name + '/', out);
    }
  }

  async function validImage(file) {
    try { const bmp = await createImageBitmap(file); bmp.close && bmp.close(); return true; } catch { return false; }
  }

  // replace=true: una carpeta sustituye la lista; false: imágenes sueltas se añaden.
  async function addImages(items, replace) {
    if (!state.projectId) return;
    const files = items.filter(it => IMG_RE.test(it.file.name)).sort((a, b) => natural(a.rel, b.rel));
    const skipped = items.length - files.length;
    if (!files.length) { $('imgStatus').textContent = 'No se encontraron imágenes compatibles (PNG, JPG, WEBP, GIF, BMP, AVIF).'; return; }
    pause();
    const added = []; const bad = [];
    for (let i = 0; i < files.length; i++) {
      $('imgStatus').textContent = `Copiando al proyecto ${i + 1}/${files.length}…`;
      if (!(await validImage(files[i].file))) { bad.push(files[i].rel); continue; }
      try {
        const saved = await upload('imagenes', files[i].file);
        added.push({ file: saved.name, kind: 'imagenes', label: files[i].rel });
      } catch (e) { bad.push(`${files[i].rel} (${e.message})`); }
    }
    const d = Number($('allDur').value) || 4;
    if (replace) { state.images = added; state.durations = added.map(() => d); selected = 0; curTime = 0; }
    else { state.images.push(...added); state.durations.push(...added.map(() => d)); }
    state.dist = null;
    let msg = `${added.length} imágenes copiadas al proyecto (los originales no se modifican).`;
    if (bad.length) msg += ` ${bad.length} no se pudieron leer: ${bad.slice(0, 3).join(', ')}${bad.length > 3 ? '…' : ''}`;
    if (skipped) msg += ` ${skipped} archivos ignorados por no ser imágenes.`;
    $('imgStatus').textContent = msg;
    renderAll(); save();
  }

  $('pickFolderBtn').onclick = () => $('folderInput').click();
  $('pickFilesBtn').onclick = () => $('filesInput').click();
  $('folderInput').onchange = e => { const fs = [...e.target.files].map(f => ({ file: f, rel: f.webkitRelativePath || f.name })); e.target.value = ''; addImages(fs, true); };
  $('filesInput').onchange = e => { const fs = [...e.target.files].map(f => ({ file: f, rel: f.name })); e.target.value = ''; addImages(fs, false); };
  setupDrop($('imgDrop'), async dt => {
    const out = [];
    const entries = [...dt.items].map(i => i.webkitGetAsEntry && i.webkitGetAsEntry()).filter(Boolean);
    if (entries.length) { for (const en of entries) await walk(en, '', out); }
    else out.push(...[...dt.files].map(f => ({ file: f, rel: f.name })));
    const hasDir = entries.some(en => en.isDirectory);
    addImages(out, hasDir);
  });

  $('useFlowBtn').onclick = async () => {
    try {
      const files = (await api(`/api/projects/${pid()}/files/flow`)).filter(f => IMG_RE.test(f.name));
      if (!files.length) { $('imgStatus').textContent = 'Este proyecto todavía no tiene imágenes guardadas por RaulitoShow IA.'; return; }
      pause();
      const d = Number($('allDur').value) || 4;
      state.images = files.map(f => ({ file: f.name, kind: 'flow', label: f.name }));
      state.durations = state.images.map(() => d);
      state.dist = null; selected = 0; curTime = 0;
      $('imgStatus').textContent = `${files.length} imágenes cargadas desde los resultados de RaulitoShow IA (carpeta flow/ del proyecto).`;
      renderAll(); save();
    } catch (e) { $('imgStatus').textContent = e.message; }
  };

  // ---------- 2. Audio ----------
  async function setAudio(file) {
    if (!AUDIO_RE.test(file.name)) { $('audioState').textContent = 'Formato no admitido. Usa MP3, WAV o M4A.'; return; }
    pause();
    $('audioState').textContent = 'Cargando…';
    $('audioName').textContent = file.name;
    try {
      const saved = await upload('audio', file);
      state.audio = { file: saved.name, name: file.name, duration: saved.duration };
      state.dist = null;
      renderAudio(); renderAll(); save();
    } catch (e) { $('audioState').textContent = 'Error: ' + e.message; }
  }
  function renderAudio() {
    const p = $('audioPlayer');
    if (!state.audio) { $('audioName').textContent = '—'; $('audioDur').textContent = '—'; $('audioState').textContent = 'Sin audio'; p.removeAttribute('src'); p.load(); return; }
    $('audioName').textContent = state.audio.name;
    $('audioDur').textContent = `${T.fmt(state.audio.duration, 2)} (${state.audio.duration.toFixed(2)} s)`;
    $('audioState').textContent = 'Cargado ✓';
    p.src = fileUrl('audio', state.audio.file);
  }
  $('pickAudioBtn').onclick = () => $('audioInput').click();
  $('audioInput').onchange = e => { const f = e.target.files[0]; e.target.value = ''; if (f) setAudio(f); };
  setupDrop($('audioDrop'), dt => { const f = dt.files[0]; if (f) setAudio(f); });

  // ---------- 3. Texto ----------
  async function setTextFile(file) {
    const txt = await file.text();
    $('sceneText').value = txt;
    onTextChange();
    try { await upload('texto', file); } catch { /* la copia es opcional */ }
  }
  function onTextChange() {
    state.text = $('sceneText').value;
    parsed = T.parseSceneText(state.text);
    renderTextInfo(); renderCaption(); save();
  }
  function renderTextInfo() {
    const n = state.images.length;
    let s;
    if (parsed.mode === 'none') s = 'Sin texto: las imágenes se reparten con duraciones iguales.';
    else if (parsed.mode === 'timed') s = `${parsed.cues.length} escenas con marcas de tiempo reales (se usarán al repartir con el audio).`;
    else s = `${parsed.lines.length} líneas → asociadas en orden a las imágenes 1…${Math.min(n, parsed.lines.length) || parsed.lines.length}.`;
    if (parsed.mode !== 'none' && n && parsed.lines.length !== n) s += ` Atención: hay ${n} imágenes.`;
    $('textInfo').textContent = s;
  }
  $('sceneText').addEventListener('input', onTextChange);
  $('pickTextBtn').onclick = () => $('textInput').click();
  $('textInput').onchange = e => { const f = e.target.files[0]; e.target.value = ''; if (f) setTextFile(f); };
  setupDrop($('textDrop'), dt => { const f = dt.files[0]; if (f) setTextFile(f); });

  // ---------- Distribución ----------
  $('applyAllBtn').onclick = () => {
    const d = Number($('allDur').value);
    if (!isFinite(d) || d < 0.2) { setDistMsg('La duración debe ser de al menos 0.2 s.', 'warn'); return; }
    state.durations = state.images.map(() => d);
    state.dist = { method: 'manual', message: `Todas las escenas duran ${d} s.` };
    curTime = Math.min(curTime, T.total(state.durations));
    renderAll(); save();
  };
  $('distributeBtn').onclick = () => {
    try {
      const r = T.distribute(state.images.length, state.audio && state.audio.duration, parsed);
      state.durations = r.durations;
      state.dist = { method: r.method, message: r.message, warning: r.warning || '' };
      renderAll(); save();
    } catch (e) { setDistMsg(e.message, 'warn'); }
  };
  function setDistMsg(text, cls) { const el = $('distMsg'); el.textContent = text; el.className = 'small ' + (cls || ''); }

  // ---------- Render ----------
  function outputAspect() {
    const first = state.images[0] && imgCache.get(key(state.images[0]));
    if (!first || !first.naturalWidth) return 16 / 9;
    const r = first.naturalWidth / first.naturalHeight;
    if (r >= 0.9 && r <= 1.1) return 1; if (r > 1.1 && r < 1.5) return 4 / 3; if (r >= 1.5) return 16 / 9; return 9 / 16;
  }
  function sizeCanvas() {
    const a = outputAspect(); const c = $('canvas');
    const W = a >= 1 ? 1280 : 720; const H = Math.round(W / a);
    if (c.width !== W || c.height !== H) { c.width = W; c.height = H; }
  }
  const key = im => im.kind + '/' + im.file;
  function getImg(im) {
    const k = key(im);
    if (!imgCache.has(k)) {
      const img = new Image();
      img.onload = () => { if (state.images[0] && key(state.images[0]) === k) sizeCanvas(); draw(); };
      img.src = fileUrl(im.kind, im.file);
      imgCache.set(k, img);
    }
    return imgCache.get(k);
  }

  function renderAll() {
    const n = state.images.length;
    if (state.durations.length !== n) state.durations = state.images.map((_, i) => state.durations[i] || 4);
    const total = T.total(state.durations);
    $('imgCount').textContent = `${n} ${n === 1 ? 'imagen' : 'imágenes'}`;
    $('thumbs').innerHTML = '';
    state.images.forEach(im => { const i = document.createElement('img'); i.src = fileUrl(im.kind, im.file); i.title = im.label || im.file; i.loading = 'lazy'; $('thumbs').appendChild(i); });
    $('galTitle').textContent = `Escenas — ${n} ${n === 1 ? 'imagen' : 'imágenes'} — ${T.fmt(total, 1)}`;
    $('timeline').max = String(total);
    $('tTotal').textContent = T.fmt(total);
    $('viewerEmpty').hidden = n > 0;
    if (state.dist) setDistMsg(state.dist.message + (state.dist.warning ? ' ' + state.dist.warning : ''), state.dist.method === 'aproximada' || state.dist.warning ? 'warn' : 'ok');
    else setDistMsg('', '');
    if (state.audio && n && Math.abs(state.audio.duration - total) > 0.5) {
      const el = $('distMsg');
      el.textContent = (el.textContent ? el.textContent + ' ' : '') + `Las escenas suman ${total.toFixed(2)} s y el audio dura ${state.audio.duration.toFixed(2)} s.`;
      el.className = 'small warn';
    }
    renderCards(); renderTextInfo();
    if (n) { getImg(state.images[0]); sizeCanvas(); }
    selected = n ? T.sceneAt(state.durations, curTime) : 0;
    updateTimeUi(); draw();
  }

  function renderCards() {
    const starts = T.starts(state.durations);
    const box = $('cards'); box.innerHTML = '';
    state.images.forEach((im, i) => {
      const c = document.createElement('div');
      c.className = 'card' + (i === selected ? ' sel' : '');
      c.dataset.i = i;
      c.innerHTML = `<img loading="lazy" src="${fileUrl(im.kind, im.file)}" alt="">
        <div class="meta"><b>Escena ${i + 1}</b><span>Inicio ${T.fmt(starts[i])}</span><span>Duración ${state.durations[i].toFixed(2)} s</span></div>`;
      c.onclick = () => { selectScene(i); };
      box.appendChild(c);
    });
  }
  function selectScene(i) {
    selected = i;
    curTime = T.starts(state.durations)[i] || 0;
    syncAudio(true);
    updateTimeUi(); draw();
  }
  function highlight() {
    document.querySelectorAll('.card').forEach(c => c.classList.toggle('sel', Number(c.dataset.i) === selected));
  }

  function renderCaption() {
    const t = parsed.lines[selected];
    $('caption').textContent = state.images.length && t ? `“${t}”` : '';
  }

  function updateTimeUi() {
    const total = T.total(state.durations);
    $('tCur').textContent = T.fmt(curTime);
    $('timeline').value = String(curTime);
    $('progressFill').style.width = total ? (100 * curTime / total) + '%' : '0';
    if (state.images.length) selected = T.sceneAt(state.durations, curTime);
    highlight();
    const starts = T.starts(state.durations);
    $('sceneNow').textContent = state.images.length
      ? `Escena ${selected + 1} de ${state.images.length} · inicio ${T.fmt(starts[selected])} · duración ${state.durations[selected].toFixed(2)} s`
      : '';
    renderCaption();
  }

  function draw() {
    const c = $('canvas'); const ctx = c.getContext('2d');
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, c.width, c.height);
    if (!state.images.length) return;
    const i = selected; const im = getImg(state.images[i]);
    if (!im.complete || !im.naturalWidth) return;
    const starts = T.starts(state.durations);
    const local = Math.max(0, curTime - starts[i]);
    const z = state.zoom ? 1 + ZOOM * Math.min(1, local / Math.max(0.001, state.durations[i])) : 1;
    // Ajustar (sin recortar) con bandas negras, igual que el exportador, y aplicar zoom centrado.
    const s = Math.min(c.width / im.naturalWidth, c.height / im.naturalHeight) * z;
    const w = im.naturalWidth * s, h = im.naturalHeight * s;
    ctx.drawImage(im, (c.width - w) / 2, (c.height - h) / 2, w, h);
    // Precarga de la siguiente
    if (state.images[i + 1]) getImg(state.images[i + 1]);
  }

  // ---------- Reproducción ----------
  const audio = $('audioPlayer');
  function syncAudio(force) {
    if (!state.audio || !audio.src) return;
    if (curTime < state.audio.duration) {
      if (force || Math.abs(audio.currentTime - curTime) > 0.25) audio.currentTime = curTime;
      if (playing && audio.paused) audio.play().catch(() => {});
      if (!playing && !audio.paused) audio.pause();
    } else if (!audio.paused) audio.pause();
  }
  function play() {
    if (!state.images.length) return;
    const total = T.total(state.durations);
    if (curTime >= total - 0.01) curTime = 0;
    playing = true; lastTick = performance.now();
    syncAudio(true);
    requestAnimationFrame(tick);
  }
  function pause() { playing = false; if (!audio.paused) audio.pause(); }
  function tick(now) {
    if (!playing) return;
    const total = T.total(state.durations);
    const dt = (now - lastTick) / 1000; lastTick = now;
    // El audio manda mientras suena; si no hay audio (o ya terminó) se usa el reloj.
    if (state.audio && !audio.paused && curTime < state.audio.duration) curTime = audio.currentTime;
    else curTime += dt;
    if (curTime >= total) { curTime = total; playing = false; audio.pause(); }
    syncAudio(false);
    updateTimeUi(); draw();
    if (playing) requestAnimationFrame(tick);
  }
  $('playBtn').onclick = play;
  $('pauseBtn').onclick = () => { pause(); updateTimeUi(); };
  $('timeline').addEventListener('input', e => { curTime = Number(e.target.value); syncAudio(true); updateTimeUi(); draw(); });

  // ---------- 4. Exportar ----------
  $('zoomChk').onchange = e => { state.zoom = e.target.checked; draw(); save(); };
  $('qualitySel').onchange = e => { state.quality = e.target.value; save(); };
  $('exportBtn').onclick = async () => {
    pause();
    const box = $('exportBox'); box.hidden = false;
    $('exportResult').innerHTML = ''; $('exportSteps').innerHTML = ''; $('exportBar').style.width = '0'; $('exportPct').textContent = 'Iniciando…';
    $('exportBtn').disabled = true;
    try {
      const { jobId } = await api(`/api/projects/${pid()}/export`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scenes: state.images.map((im, i) => ({ file: im.file, kind: im.kind, duration: state.durations[i] })),
          audio: state.audio, zoom: state.zoom, quality: state.quality }) });
      await pollJob(jobId);
    } catch (e) {
      $('exportResult').innerHTML = `<div class="notice err">${escapeHtml(e.message)}</div>`;
    } finally { $('exportBtn').disabled = false; }
  };
  async function pollJob(id) {
    for (;;) {
      const j = await api('/api/jobs/' + id);
      $('exportBar').style.width = j.percent.toFixed(1) + '%';
      $('exportPct').textContent = j.state === 'running' ? `${j.percent.toFixed(0)} %` : (j.state === 'done' ? '100 % — terminado' : 'Error');
      $('exportSteps').innerHTML = j.steps.map((s, i) => `<li class="${s.status}"><span>${{ pending: '○', running: '◐', done: '✓', error: '✗' }[s.status]}</span><span>${i + 1}. ${s.name}</span>${s.detail ? `<span class="d">${escapeHtml(s.detail)}</span>` : ''}</li>`).join('');
      if (j.state === 'done') {
        const url = fileUrl('exportaciones', j.output.name);
        $('exportResult').innerHTML = `${j.warnings.map(w => `<div class="notice warn">${escapeHtml(w)}</div>`).join('')}
          <div class="notice ok">Video guardado en:<br><code>${escapeHtml(j.output.path)}</code></div>
          <video controls src="${url}"></video>
          <div class="row" style="margin-top:6px"><a href="${url}?download" download>Descargar MP4</a></div>`;
        return;
      }
      if (j.state === 'error') { $('exportResult').innerHTML = `<div class="notice err">${escapeHtml(j.error)}</div>`; return; }
      await new Promise(r => setTimeout(r, 500));
    }
  }

  // ---------- util ----------
  function setupDrop(el, onDrop) {
    el.addEventListener('dragover', e => { e.preventDefault(); el.classList.add('over'); });
    el.addEventListener('dragleave', () => el.classList.remove('over'));
    el.addEventListener('drop', e => { e.preventDefault(); el.classList.remove('over'); onDrop(e.dataTransfer); });
  }
  function escapeHtml(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
  window.addEventListener('dragover', e => e.preventDefault());
  window.addEventListener('drop', e => e.preventDefault());

  initProjects().catch(e => { $('saveState').textContent = 'Error: ' + e.message; });
  window.__editor = { state, get selected() { return selected; }, get curTime() { return curTime; } }; // para pruebas
})();
