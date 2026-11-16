// Servidor HTTP (sin frameworks). API JSON en /api, interfaz web en /.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { paths } from './core/paths.js';
import { bus } from './core/bus.js';
import { getSetting, setSettings, publicSettings } from './core/settings.js';
import { recentJobs, activeJob } from './core/jobs.js';
import { one, all, run } from './db/index.js';
import * as search from './modules/search.js';
import * as yt from './services/youtube.js';
import * as gemini from './services/gemini.js';
import { synthesize, voiceEngine } from './services/voices.js';
import { version as ffmpegVersion, duration } from './services/ffmpeg.js';
import { createProject, getProject, listProjects, deleteProject, update, updateScene, resetFrom, STAGES } from './modules/projects.js';
import { startProduction, imagePending } from './modules/production.js';
import { receiveFlowImage, sceneImagePath, thumbBasePath, thumbnailPrompt, fileHash } from './modules/images.js';
import { MASCOT, saveReference, hasReference, scenePrompt } from './modules/mascot.js';
import { cleanTranscript } from './modules/textkit.js';
import { musicTracks } from './modules/soundtrack.js';

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.json': 'application/json', '.md': 'text/markdown; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.mp4': 'video/mp4', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ico': 'image/x-icon' };

class HttpError extends Error { constructor(code, msg) { super(msg); this.http = code; } }
const reply = (res, code, body) => { res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); res.end(JSON.stringify(body)); };

async function readBody(req, limit) {
  const parts = [];
  let n = 0;
  for await (const c of req) { n += c.length; if (n > limit) throw new HttpError(413, 'Archivo demasiado grande'); parts.push(c); }
  return Buffer.concat(parts);
}
const readJson = async (req) => { const b = await readBody(req, 25e6); try { return b.length ? JSON.parse(b) : {}; } catch { throw new HttpError(400, 'JSON no válido'); } };

function sendFile(req, res, file, download) {
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return reply(res, 404, { error: 'Archivo no encontrado' });
  const size = fs.statSync(file).size;
  const head = { 'content-type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream', 'accept-ranges': 'bytes', 'cache-control': 'no-cache' };
  if (download) head['content-disposition'] = `attachment; filename*=UTF-8''${encodeURIComponent(download)}`;
  const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
  if (m) {
    const start = m[1] === '' ? size - Number(m[2]) : Number(m[1]);
    const end = m[1] !== '' && m[2] !== '' ? Math.min(Number(m[2]), size - 1) : size - 1;
    if (!(start >= 0 && start <= end)) { res.writeHead(416, { 'content-range': `bytes */${size}` }); return res.end(); }
    res.writeHead(206, { ...head, 'content-range': `bytes ${start}-${end}/${size}`, 'content-length': end - start + 1 });
    return fs.createReadStream(file, { start, end }).pipe(res);
  }
  res.writeHead(200, { ...head, 'content-length': size });
  fs.createReadStream(file).pipe(res);
}

function inside(base, rel) {
  const f = path.resolve(base, rel);
  if (f !== path.resolve(base) && !f.startsWith(path.resolve(base) + path.sep)) throw new HttpError(403, 'Ruta no permitida');
  return f;
}

function projectOr404(id) { const p = getProject(Number(id)); if (!p) throw new HttpError(404, 'Proyecto no encontrado'); return p; }

/** Vista del proyecto para la interfaz (sin el material de investigación completo). */
function view(p) {
  const mtime = (f) => (fs.existsSync(f) ? Math.round(fs.statSync(f).mtimeMs) : 0);
  const job = activeJob(p.id);
  const proposal = p.proposal ? { ...p.proposal, research: { sources: p.proposal.research.sources } } : null;
  const mp4 = paths.project(p.slug, 'salida', 'video.mp4');
  return {
    ...p, proposal, job,
    scenes: p.scenes.map((s) => ({ ...s, image_version: mtime(sceneImagePath(p.slug, s.n)), pending_image: imagePending(p, s), audio_file: s.audio_file ? path.basename(s.audio_file) : null })),
    thumbnail_version: mtime(paths.project(p.slug, 'salida', 'miniatura.png')),
    can_download: p.status === 'terminado' && !!p.verification?.ok && fs.existsSync(mp4),
    events: all('SELECT level, message, created_at FROM events WHERE project_id = ? ORDER BY id DESC LIMIT 200', p.id).reverse(),
  };
}

// ------------------------------------------------------------------------------------------- rutas
const routes = [];
const on = (method, pattern, fn) => routes.push({ method, re: new RegExp(`^${pattern.replace(/:(\w+)/g, '(?<$1>[^/]+)')}$`), fn });

on('GET', '/api/panel', async () => {
  const counts = Object.fromEntries(all('SELECT status, COUNT(*) AS n FROM projects GROUP BY status').map((r) => [r.status, r.n]));
  return {
    quota: { used: yt.quotaUsedToday(), limit: yt.DAILY_QUOTA },
    counts, projects: listProjects().slice(0, 6), searches: search.history(6), jobs: recentJobs(8),
    services: { youtube: !!getSetting('YOUTUBE_API_KEY'), gemini: !!getSetting('GEMINI_API_KEY'), mascot: hasReference(), voice: voiceEngine(), images: getSetting('IMAGE_ENGINE'), music: musicTracks().length },
    top: all(`SELECT v.id, v.title, v.thumbnail, v.channel_title, o.score, o.level, o.search_id FROM opportunities o JOIN videos v ON v.id = o.video_id ORDER BY o.created_at DESC, o.score DESC LIMIT 40`)
      .filter((r, i, a) => a.findIndex((x) => x.id === r.id) === i).sort((a, b) => b.score - a.score).slice(0, 6),
  };
});

// Buscador + historial
on('POST', '/api/busquedas', async (req) => search.runSearch(await readJson(req)));
on('GET', '/api/busquedas', async () => ({ items: search.history(200) }));
on('GET', '/api/busquedas/:id', async (req, res, { id }) => search.getSearch(Number(id)) || (() => { throw new HttpError(404, 'Búsqueda no encontrada'); })());
on('DELETE', '/api/busquedas/:id', async (req, res, { id }) => { search.deleteSearch(Number(id)); return { ok: true }; });

// Proyectos
on('POST', '/api/proyectos', async (req) => {
  const b = await readJson(req);
  let videoId = b.videoId;
  if (!videoId && b.url) {
    videoId = yt.videoIdFrom(b.url);
    if (!videoId) throw new HttpError(400, 'Enlace de YouTube no válido.');
    if (!one('SELECT id FROM videos WHERE id = ?', videoId)) {
      const [v] = await yt.videos([videoId]);
      if (!v) throw new HttpError(404, 'YouTube no devolvió ese video (privado, eliminado o enlace incorrecto).');
      const subs = await yt.channelSubscribers([v.channel_id]);
      run(`INSERT INTO videos(id, title, description, channel_id, channel_title, subscribers, published_at, duration_sec, views, likes, comments, thumbnail, language, tags) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        v.id, v.title, v.description, v.channel_id, v.channel_title, subs[v.channel_id] ?? null, v.published_at, v.duration_sec, v.views, v.likes, v.comments, v.thumbnail, v.language, JSON.stringify(v.tags));
    }
  }
  const p = createProject(videoId);
  if (b.transcript) update(p.id, { transcript: cleanTranscript(b.transcript), transcript_source: 'Transcripción aportada por el usuario' });
  if (b.start !== false) startProduction(p.id);
  return view(getProject(p.id));
});
on('GET', '/api/proyectos', async () => ({ items: listProjects(), stages: STAGES }));
on('GET', '/api/proyectos/:id', async (req, res, { id }) => view(projectOr404(id)));
on('DELETE', '/api/proyectos/:id', async (req, res, { id }) => { if (activeJob(Number(id))) throw new HttpError(409, 'Espera a que termine el trabajo en curso.'); deleteProject(Number(id)); return { ok: true }; });
on('POST', '/api/proyectos/:id/producir', async (req, res, { id }) => {
  const p = projectOr404(id);
  const b = await readJson(req);
  if (b.from && !STAGES.some((s) => s[0] === b.from)) throw new HttpError(400, 'Etapa desconocida');
  startProduction(p.id, { from: b.from || undefined });
  return view(getProject(p.id));
});
on('POST', '/api/proyectos/:id/transcripcion', async (req, res, { id }) => {
  const p = projectOr404(id);
  const text = cleanTranscript((await readJson(req)).text);
  if (text.split(/\s+/).length < 40) throw new HttpError(400, 'La transcripción es demasiado corta.');
  update(p.id, { transcript: text, transcript_source: 'Transcripción aportada por el usuario' });
  resetFrom(p.id, 'analisis');
  return view(getProject(p.id));
});
on('POST', '/api/proyectos/:id/motor', async (req, res, { id }) => {
  const p = projectOr404(id);
  const engine = (await readJson(req)).engine;
  if (!['gemini', 'flow'].includes(engine)) throw new HttpError(400, 'Motor no válido');
  update(p.id, { image_engine: engine });
  return view(getProject(p.id));
});

// Editor de escenas
on('POST', '/api/proyectos/:id/escenas/:n/:accion', async (req, res, { id, n, accion }) => {
  const p = projectOr404(id);
  if (activeJob(p.id)) throw new HttpError(409, 'Espera a que termine el trabajo en curso.');
  const s = p.scenes.find((x) => x.n === Number(n));
  if (!s) throw new HttpError(404, 'Escena no encontrada');
  const b = await readJson(req);
  const file = sceneImagePath(p.slug, s.n);
  if (accion === 'aprobar') {
    if (!fs.existsSync(file)) throw new HttpError(400, 'La escena no tiene imagen.');
    updateScene(p.id, s.n, { review: { ...(s.review || {}), state: 'aprobada_manual', hash: fileHash(file), at: new Date().toISOString() }, image_requested_at: null });
    resetFrom(p.id, 'revision');
  } else if (accion === 'rehacer') {
    const extra = String(b.instruccion || '').trim();
    updateScene(p.id, s.n, { image_requested_at: new Date().toISOString(), review: null, visual: b.visual ? String(b.visual) : s.visual, image_prompt: extra ? `${s.image_prompt}. Must show: ${extra}` : s.image_prompt });
    if (p.image_engine === 'gemini' && fs.existsSync(file)) fs.rmSync(file);
    resetFrom(p.id, 'imagenes');
  } else if (accion === 'narracion') {
    const text = String(b.texto || '').trim();
    if (!text) throw new HttpError(400, 'La narración no puede quedar vacía.');
    updateScene(p.id, s.n, { narration: text, audio_text_hash: null });
    resetFrom(p.id, 'voz');
  } else throw new HttpError(400, 'Acción no válida');
  return view(getProject(p.id));
});

// Importación manual de imágenes de Flow (archivos escena_NNN)
on('POST', '/api/proyectos/:id/importar-imagen', async (req, res, { id }, url) => {
  const p = projectOr404(id);
  const m = /escena[_ -]?(\d{1,3})/i.exec(url.searchParams.get('nombre') || '');
  const n = url.searchParams.get('n') != null ? Number(url.searchParams.get('n')) : m ? Number(m[1]) : NaN;
  if (!Number.isInteger(n)) throw new HttpError(400, 'El archivo debe llamarse escena_NNN (por ejemplo escena_007.png).');
  await receiveFlowImage(p, n, await readBody(req, 40e6));
  return { ok: true, n };
});
on('GET', '/api/proyectos/:id/prompts-flow.txt', async (req, res, { id }) => {
  const p = projectOr404(id);
  res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8', 'content-disposition': `attachment; filename="prompts-flow-${p.slug}.txt"` });
  res.end(p.scenes.map((s) => `escena_${String(s.n).padStart(3, '0')}: ${scenePrompt(s)}`).join('\n') + '\n');
});

// Archivos del proyecto y descarga del MP4
on('GET', '/api/proyectos/:id/archivo/(?<rel>.+)', async (req, res, { id, rel }, url) => {
  const p = projectOr404(id);
  const f = inside(paths.project(p.slug), decodeURIComponent(rel));
  sendFile(req, res, f, url.searchParams.has('descargar') ? path.basename(f) : null);
});
on('GET', '/api/proyectos/:id/mp4', async (req, res, { id }) => {
  const p = view(projectOr404(id));
  if (!p.can_download) throw new HttpError(409, 'El MP4 aún no está terminado y verificado.');
  sendFile(req, res, paths.project(p.slug, 'salida', 'video.mp4'), `${p.title.replace(/[\\/:*?"<>|]/g, '').slice(0, 90)}.mp4`);
});

// Puente con la extensión «EPO · Conector Flow»
on('GET', '/api/flow/proyectos', async () => ({
  items: listProjects().map((x) => getProject(x.id)).filter((p) => p.image_engine === 'flow' && p.scenes.length)
    .map((p) => ({ id: p.id, title: p.title, total: p.scenes.length, pending: p.scenes.filter((s) => imagePending(p, s)).length, thumbnail: fs.existsSync(thumbBasePath(p.slug)) })),
}));
on('GET', '/api/flow/proyectos/:id', async (req, res, { id }) => {
  const p = projectOr404(id);
  const items = p.scenes.filter((s) => imagePending(p, s)).map((s) => ({ n: s.n, prompt: scenePrompt(s), narration: s.narration }));
  if (!fs.existsSync(thumbBasePath(p.slug)) && p.proposal) items.push({ n: 0, prompt: thumbnailPrompt(p.title, p.proposal.texto_miniatura), narration: 'Miniatura del video' });
  return { id: p.id, title: p.title, items, mascot: hasReference() ? '/api/mascota/referencia.png' : null };
});
on('POST', '/api/flow/proyectos/:id/imagen/:n', async (req, res, { id, n }) => {
  const p = projectOr404(id);
  await receiveFlowImage(p, Number(n), await readBody(req, 40e6));
  return { ok: true, n: Number(n), path: Number(n) ? sceneImagePath(p.slug, Number(n)) : thumbBasePath(p.slug) };
});

// Mascota
on('GET', '/api/mascota', async () => ({ ...MASCOT, reference: hasReference() }));
on('POST', '/api/mascota/referencia', async (req) => { saveReference(await readBody(req, 10e6)); return { ok: true }; });
on('GET', '/api/mascota/referencia.png', async (req, res) => sendFile(req, res, path.join(paths.mascot, 'referencia.png')));

// Configuración y pruebas de conexión (llamadas reales)
on('GET', '/api/configuracion', async () => ({ settings: publicSettings(), music: musicTracks(), ffmpeg: await ffmpegVersion(), dataDir: paths.data }));
on('PUT', '/api/configuracion', async (req) => { setSettings(await readJson(req)); return { settings: publicSettings() }; });
on('POST', '/api/configuracion/probar/:servicio', async (req, res, { servicio }) => {
  if (servicio === 'youtube') { const r = await yt.videos(['jNQXAC9IVRw']); return { ok: r.length === 1, detalle: r[0] ? `Conectado. Video de prueba: «${r[0].title}» (${r[0].views.toLocaleString('es')} vistas). Cuota usada hoy: ${yt.quotaUsedToday()} / ${yt.DAILY_QUOTA}.` : 'Sin respuesta' }; }
  if (servicio === 'gemini') { const r = await gemini.checkKey(); return { ok: r.text, detalle: `Clave válida: ${r.models} modelos disponibles. Texto: ${r.text ? 'sí' : 'NO'} · Imagen: ${r.image ? 'sí' : 'NO'} · Voz: ${r.tts ? 'sí' : 'NO'}.` }; }
  if (servicio === 'voz') {
    fs.mkdirSync(path.join(paths.data, 'pruebas'), { recursive: true });
    const base = path.join(paths.data, 'pruebas', 'voz');
    const r = await synthesize('Hola. Soy el detective de El Precio Oculto, y hoy vamos a descubrir lo que nadie te cuenta.', base);
    const target = path.join(paths.data, 'pruebas', `voz${path.extname(r.file)}`);
    fs.renameSync(r.file, target);
    return { ok: true, detalle: `${r.engine} · ${r.voice} · ${(await duration(target)).toFixed(1)} s`, audio: `/api/configuracion/prueba-voz?v=${Date.now()}` };
  }
  if (servicio === 'ffmpeg') { const v = await ffmpegVersion(); return { ok: !!v, detalle: v || 'FFmpeg no encontrado' }; }
  throw new HttpError(400, 'Servicio desconocido');
});
on('GET', '/api/configuracion/prueba-voz', async (req, res) => {
  const dir = path.join(paths.data, 'pruebas');
  const f = ['voz.wav', 'voz.mp3', 'voz.src.wav', 'voz.src.mp3'].map((x) => path.join(dir, x)).find((x) => fs.existsSync(x));
  if (!f) throw new HttpError(404, 'Aún no hay prueba de voz');
  sendFile(req, res, f);
});
on('POST', '/api/musica', async (req, res, _g, url) => {
  const name = path.basename(url.searchParams.get('nombre') || '');
  if (!/\.(mp3|wav|m4a|ogg|flac|aac)$/i.test(name)) throw new HttpError(400, 'Formato de audio no admitido.');
  fs.mkdirSync(paths.music, { recursive: true });
  fs.writeFileSync(path.join(paths.music, name), await readBody(req, 80e6));
  return { music: musicTracks() };
});
on('DELETE', '/api/musica/:nombre', async (req, res, { nombre }) => { fs.rmSync(inside(paths.music, decodeURIComponent(nombre)), { force: true }); return { music: musicTracks() }; });

// Eventos en vivo
on('GET', '/api/eventos', async (req, res) => {
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
  res.write('retry: 2000\n\n');
  const send = (e) => res.write(`data: ${JSON.stringify(e)}\n\n`);
  bus.on('event', send);
  const ping = setInterval(() => res.write(': ping\n\n'), 25000);
  req.on('close', () => { bus.off('event', send); clearInterval(ping); });
});

export function createServer() {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    // La extensión de Chrome llama desde chrome-extension://: se permite CORS sólo en el puente de Flow.
    if (url.pathname.startsWith('/api/flow/') || url.pathname === '/api/mascota/referencia.png') {
      res.setHeader('access-control-allow-origin', '*');
      res.setHeader('access-control-allow-methods', 'GET, POST, OPTIONS');
      res.setHeader('access-control-allow-headers', 'content-type');
      if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
    }
    try {
      if (url.pathname.startsWith('/api/')) {
        for (const r of routes) {
          if (r.method !== req.method) continue;
          const m = r.re.exec(url.pathname);
          if (!m) continue;
          const out = await r.fn(req, res, m.groups || {}, url);
          if (!res.headersSent && out !== undefined) reply(res, 200, out);
          return;
        }
        return reply(res, 404, { error: 'Ruta no encontrada' });
      }
      const rel = url.pathname === '/' || !path.extname(url.pathname) ? 'index.html' : decodeURIComponent(url.pathname.slice(1));
      sendFile(req, res, inside(paths.web, rel));
    } catch (e) {
      const code = e.http || (e.external ? 502 : 500);
      if (code === 500) console.error(e);
      if (!res.headersSent) reply(res, code, { error: e.message });
      else res.end();
    }
  });
}
