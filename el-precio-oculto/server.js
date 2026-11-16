// El Precio Oculto · Viral Finder — servidor local (Node, sin frameworks).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, config, serviceStatus } from './lib/config.js';
import { searchViral, getVideoInfo } from './lib/youtube.js';
import { createProject, loadProject, listProjects, projectDir, projectPath } from './lib/project.js';
import { runPipeline, sceneAction, setTranscript, publicProject, events, isRunning } from './lib/pipeline.js';
import { ffmpegAvailable } from './lib/media.js';
import { zipDir } from './lib/zip.js';

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.json': 'application/json; charset=utf-8', '.md': 'text/markdown; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.mp4': 'video/mp4', '.svg': 'image/svg+xml' };

const send = (res, code, data) => { res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); res.end(JSON.stringify(data)); };
const fail = (res, code, msg) => send(res, code, { error: msg });

async function body(req, limit = 5e6) {
  let size = 0;
  const chunks = [];
  for await (const c of req) { size += c.length; if (size > limit) throw new Error('Petición demasiado grande'); chunks.push(c); }
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : {};
}

/** Sirve un archivo con soporte de Range (para reproducir audio/video en el navegador). */
function serveFile(req, res, file, { download } = {}) {
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return fail(res, 404, 'Archivo no encontrado');
  const size = fs.statSync(file).size;
  const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
  const headers = { 'content-type': type, 'accept-ranges': 'bytes', 'cache-control': 'no-store' };
  if (download) headers['content-disposition'] = `attachment; filename="${encodeURIComponent(download)}"; filename*=UTF-8''${encodeURIComponent(download)}`;
  const m = /bytes=(\d*)-(\d*)/.exec(req.headers.range || '');
  if (m) {
    const start = m[1] ? Number(m[1]) : size - Number(m[2]);
    const end = m[1] && m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
    if (start >= size || start > end) { res.writeHead(416, { 'content-range': `bytes */${size}` }); return res.end(); }
    res.writeHead(206, { ...headers, 'content-range': `bytes ${start}-${end}/${size}`, 'content-length': end - start + 1 });
    return fs.createReadStream(file, { start, end }).pipe(res);
  }
  res.writeHead(200, { ...headers, 'content-length': size });
  fs.createReadStream(file).pipe(res);
}

function safeJoin(base, rel) {
  const f = path.resolve(base, rel);
  if (!f.startsWith(path.resolve(base) + path.sep)) throw new Error('Ruta no permitida');
  return f;
}

const routes = [];
const route = (method, pattern, fn) => routes.push({ method, re: new RegExp(`^${pattern.replace(/:(\w+)/g, '(?<$1>[^/]+)')}$`), fn });

route('GET', '/api/status', async (req, res) => {
  const ff = await ffmpegAvailable();
  const st = serviceStatus().map((s) => (s.id === 'ffmpeg' ? { ...s, ok: !!ff, role: ff || s.role, missing: ff ? null : 'FFmpeg no está instalado o no está en el PATH. Sin FFmpeg no se puede montar ni verificar el video.' } : s));
  send(res, 200, { services: st });
});

// Prueba real de la voz: sintetiza una frase corta para escucharla antes de generar un video.
route('POST', '/api/tts-test', async (req, res) => {
  const { synthesizeScene } = await import('./lib/tts.js');
  const dir = path.join(config.projectsDir, '_prueba_voz');
  fs.mkdirSync(dir, { recursive: true });
  const r = await synthesizeScene({ text: 'Millones de personas pasan cada día frente a este negocio sin imaginar dónde está su verdadero dinero.', outWav: path.join(dir, 'prueba.wav') });
  send(res, 200, { ...r, url: `/api/tts-test/audio?t=${Date.now()}` });
});
route('GET', '/api/tts-test/audio', async (req, res) => serveFile(req, res, path.join(config.projectsDir, '_prueba_voz', 'prueba.wav')));

route('GET', '/api/search', async (req, res, _p, url) => {
  const q = url.searchParams.get('q')?.trim();
  if (!q) return fail(res, 400, 'Escribe un tema para buscar.');
  const results = await searchViral({ q, days: Number(url.searchParams.get('days') || 30), lang: url.searchParams.get('lang') || 'es', max: 25 });
  send(res, 200, { results });
});

route('POST', '/api/replicate', async (req, res) => {
  const b = await body(req);
  const video = await getVideoInfo(b.url || b.id);
  const p = createProject(video);
  if (b.transcript) await setTranscript(p.id, b.transcript, b.transcriptSource);
  runPipeline(p.id, { only: 'datos' });
  send(res, 200, { id: p.id });
});

route('GET', '/api/projects', async (req, res) => send(res, 200, { projects: listProjects() }));

route('GET', '/api/projects/:id', async (req, res, { id }) => {
  const p = loadProject(id);
  if (!p) return fail(res, 404, 'Proyecto no encontrado');
  send(res, 200, publicProject(p));
});

route('POST', '/api/projects/:id/run', async (req, res, { id }) => {
  const b = await body(req);
  if (!loadProject(id)) return fail(res, 404, 'Proyecto no encontrado');
  runPipeline(id, { from: b.from, only: b.only, force: !!b.force });
  send(res, 202, { started: true });
});

route('POST', '/api/projects/:id/transcript', async (req, res, { id }) => {
  const b = await body(req, 20e6);
  if (isRunning(id)) return fail(res, 409, 'Espera a que termine el proceso en curso.');
  const p = await setTranscript(id, b.text, b.source);
  send(res, 200, publicProject(p));
});

route('POST', '/api/projects/:id/scenes/:n/:action', async (req, res, { id, n, action }) => {
  const b = await body(req);
  const p = await sceneAction(id, n, action, b);
  send(res, 200, publicProject(p));
});

route('GET', '/api/projects/:id/events', async (req, res, { id }) => {
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
  res.write('retry: 3000\n\n');
  const on = (e) => { if (e.id === id) res.write(`data: ${JSON.stringify(e)}\n\n`); };
  events.on('event', on);
  const ping = setInterval(() => res.write(': ping\n\n'), 20000);
  req.on('close', () => { events.off('event', on); clearInterval(ping); });
});

route('GET', '/api/projects/:id/download/mp4', async (req, res, { id }) => {
  const p = loadProject(id);
  if (!p) return fail(res, 404, 'Proyecto no encontrado');
  const pp = publicProject(p);
  if (!pp.canDownloadMp4) return fail(res, 409, 'El MP4 todavía no está terminado y verificado. Pulsa «GENERAR VIDEO COMPLETO» y revisa los errores de verificación.');
  serveFile(req, res, projectPath(id, 'salida', 'video.mp4'), { download: `${(p.script?.title || id).replace(/[\\/:*?"<>|]/g, '').slice(0, 80)}.mp4` });
});

route('GET', '/api/projects/:id/download/zip', async (req, res, { id }) => {
  const p = loadProject(id);
  if (!p) return fail(res, 404, 'Proyecto no encontrado');
  res.writeHead(200, { 'content-type': 'application/zip', 'content-disposition': `attachment; filename="${id}.zip"` });
  await zipDir(projectDir(id), res, `${id}/`);
});

route('GET', '/api/projects/:id/file/(?<rel>.+)', async (req, res, { id, rel }) => {
  const f = safeJoin(projectDir(id), decodeURIComponent(rel));
  serveFile(req, res, f, { download: new URL(req.url, 'http://x').searchParams.has('dl') ? path.basename(f) : undefined });
});

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  try {
    if (url.pathname.startsWith('/api/')) {
      if (config.accessToken && req.headers['x-access-token'] !== config.accessToken && url.searchParams.get('token') !== config.accessToken) return fail(res, 401, 'Falta el token de acceso (APP_ACCESS_TOKEN).');
      for (const r of routes) {
        if (r.method !== req.method) continue;
        const m = r.re.exec(url.pathname);
        if (m) return await r.fn(req, res, m.groups || {}, url);
      }
      return fail(res, 404, 'Ruta no encontrada');
    }
    const rel = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
    serveFile(req, res, safeJoin(path.join(ROOT, 'public'), rel));
  } catch (e) {
    // Errores de servicios externos (clave que falta, red, límites) → 502 con el mensaje real; resto → 500.
    if (!res.headersSent) fail(res, e.service ? 502 : 500, e.message);
    else res.end();
  }
});

fs.mkdirSync(config.projectsDir, { recursive: true });
server.listen(config.port, '127.0.0.1', () => {
  console.log(`\nEl Precio Oculto · Viral Finder → http://localhost:${config.port}\n`);
  for (const s of serviceStatus()) if (s.missing) console.log(`  • ${s.name}: ${s.missing}`);
});
