import { api, esc, toast, busy } from '../app.js';

const GROUPS = [
  ['YouTube', 'Buscador y datos reales de los videos.', ['YOUTUBE_API_KEY'], 'youtube',
    'console.cloud.google.com → crea un proyecto → «APIs y servicios» → Biblioteca → «YouTube Data API v3» → Habilitar → Credenciales → Crear clave de API. Gratis: 10.000 unidades al día.'],
  ['Google Gemini', 'Análisis, transcripción, investigación con Google Search, guion, storyboard, revisión de imágenes, imágenes y voz.', ['GEMINI_API_KEY', 'GEMINI_TEXT_MODEL', 'GEMINI_IMAGE_MODEL', 'GEMINI_TTS_MODEL', 'GEMINI_TTS_VOICE'], 'gemini',
    'aistudio.google.com/apikey → «Create API key». El texto y la voz tienen nivel gratuito; el modelo de imagen puede requerir facturación activa.'],
  ['Imágenes', 'Motor predeterminado para los proyectos nuevos.', ['IMAGE_ENGINE'], null,
    '«gemini» genera en el servidor. «flow» usa Google Flow con tu cuenta mediante la extensión de la carpeta extension/ (Chrome → chrome://extensions → Modo de desarrollador → Cargar descomprimida).'],
  ['Voz', 'Narración real en español latino.', ['VOICE_ENGINE', 'EDGE_VOICE', 'ELEVENLABS_API_KEY', 'ELEVENLABS_VOICE_ID'], 'voz',
    '«auto» usa ElevenLabs si hay clave y voz; si no, Gemini; si no, Microsoft Edge (gratis, sin clave). Voces Edge latinas: es-MX-JorgeNeural, es-MX-DaliaNeural, es-CO-GonzaloNeural, es-US-AlonsoNeural.'],
  ['Montaje', 'FFmpeg y ajustes del video final.', ['FFMPEG_PATH', 'FFPROBE_PATH', 'TARGET_MINUTES', 'MUSIC_VOLUME_DB'], 'ffmpeg',
    'Instala FFmpeg (Windows: «winget install Gyan.FFmpeg»; Mac: «brew install ffmpeg»; Linux: «sudo apt install ffmpeg»).'],
];

/** Rasteriza el SVG oficial de la mascota a PNG en el navegador (no depende de FFmpeg). */
async function mascotPng() {
  const svg = await (await fetch('/img/detective.svg')).text();
  const img = new Image();
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  await img.decode();
  const c = document.createElement('canvas');
  c.width = 768; c.height = 1024;
  const g = c.getContext('2d');
  g.fillStyle = '#F5EDDC'; g.fillRect(0, 0, c.width, c.height);
  g.drawImage(img, 0, 0, c.width, c.height);
  return new Promise((r) => c.toBlob(r, 'image/png'));
}

export async function configuracion(view) {
  const render = async () => {
    const [c, m] = await Promise.all([api('/api/configuracion'), api('/api/mascota')]);
    const S = Object.fromEntries(c.settings.map((s) => [s.key, s]));
    const field = (k) => { const s = S[k]; return `<label class="f">${esc(s.label)} <span class="muted">(${esc(s.source)})</span>
      ${s.options ? `<select name="${k}">${s.options.map((o) => `<option ${o === s.value ? 'selected' : ''}>${o}</option>`).join('')}</select>`
        : `<input name="${k}" ${s.secret ? `type="password" placeholder="${s.configured ? `guardada: ${esc(s.value)}` : 'sin configurar'}"` : `value="${esc(s.value)}"`} autocomplete="off"></label>`}`; };
    view.innerHTML = `<h1>Configuración</h1><p class="sub">Claves y servicios externos. Se guardan en la base de datos local (<code>${esc(c.dataDir)}</code>) y nunca salen de tu equipo salvo hacia el servicio correspondiente.</p>
    <div class="card"><h2>Mascota oficial</h2><div class="mascot-box"><img src="/img/detective.svg" alt="">
      <div><p><b>${esc(m.nombre)}</b>: ${m.rasgos_es.map(esc).join(', ')}.</p>
      <p class="muted">La imagen de referencia se envía a Gemini y a Google Flow con cada escena para que el personaje no cambie.</p>
      <p>${m.reference ? '<span class="pill p-ok">referencia guardada</span>' : '<span class="pill p-bad">falta guardar la referencia</span>'}</p>
      <button id="ref" class="gold">${m.reference ? 'Volver a guardar referencia' : 'Guardar referencia'}</button></div></div></div>
    ${GROUPS.map(([title, desc, keys, test, help]) => `<form class="card" data-group="${title}"><h2>${title}</h2><p class="muted">${desc}</p>
      <div class="grid">${keys.map(field).join('')}</div><p class="muted">${help}</p>
      <div class="row"><button class="dark">Guardar</button>${test ? `<button type="button" data-test="${test}">Probar conexión real</button>` : ''}<span class="out muted"></span></div></form>`).join('')}
    <div class="card"><h2>Biblioteca de música</h2><p class="muted">Sube pistas instrumentales con licencia para YouTube (por ejemplo, de la Biblioteca de audio de YouTube Studio). Si no hay ninguna, el exportador compone una pista original con FFmpeg y lo indica.</p>
      <ul>${c.music.map((f) => `<li>${esc(f)} <button class="small" data-delmusic="${esc(f)}">Quitar</button></li>`).join('') || '<li class="muted">Sin pistas</li>'}</ul>
      <input type="file" id="music" accept="audio/*" multiple></div>`;
  };
  await render();
  view.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const body = {};
    for (const [k, v] of fd.entries()) if (!(e.target.querySelector(`[name="${k}"]`).type === 'password' && !v)) body[k] = v;
    try { await api('/api/configuracion', { method: 'PUT', body }); toast('Guardado.'); await render(); } catch (err) { toast(err.message); }
  });
  view.addEventListener('click', async (e) => {
    const t = e.target;
    if (t.dataset.test) {
      const out = t.parentElement.querySelector('.out');
      const done = busy(t, 'Probando…');
      try {
        const r = await api(`/api/configuracion/probar/${t.dataset.test}`, { method: 'POST' });
        out.innerHTML = `${r.ok ? '✔' : '✘'} ${esc(r.detalle)}${r.audio ? ` <audio controls autoplay src="${r.audio}"></audio>` : ''}`;
        out.style.color = r.ok ? 'var(--ok)' : 'var(--bad)';
      } catch (err) { out.textContent = `✘ ${err.message}`; out.style.color = 'var(--bad)'; }
      done();
    }
    if (t.id === 'ref') {
      const done = busy(t, 'Guardando…');
      try { await api('/api/mascota/referencia', { method: 'POST', raw: await mascotPng() }); toast('Referencia de la mascota guardada.'); await render(); } catch (err) { toast(err.message); done(); }
    }
    if (t.dataset.delmusic) { await api(`/api/musica/${encodeURIComponent(t.dataset.delmusic)}`, { method: 'DELETE' }); await render(); }
  });
  view.addEventListener('change', async (e) => {
    if (e.target.id !== 'music') return;
    for (const f of e.target.files) {
      try { await api(`/api/musica?nombre=${encodeURIComponent(f.name)}`, { method: 'POST', raw: f }); } catch (err) { toast(`${f.name}: ${err.message}`); }
    }
    toast('Música subida.');
    await render();
  });
}
