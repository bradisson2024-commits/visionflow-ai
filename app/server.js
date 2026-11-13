'use strict';
// YOUTUBE AUTOMATIZADO — servidor local (solo 127.0.0.1). Sin dependencias externas de npm.
const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');
const storage = require('./lib/storage');
const media = require('./lib/media');
const exporter = require('./lib/exporter');

const PORT = parseInt(process.env.YA_PORT || '5317', 10);
const HOST = '127.0.0.1';
const PUBLIC = path.join(__dirname, 'public');
const MAX_UPLOAD = 1024 * 1024 * 1024; // 1 GB por archivo

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.gif': 'image/gif', '.bmp': 'image/bmp', '.avif': 'image/avif',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.m4a': 'audio/mp4', '.aac': 'audio/aac',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.txt': 'text/plain; charset=utf-8', '.srt': 'text/plain; charset=utf-8',
  '.vtt': 'text/vtt; charset=utf-8',
};

let toolsStatus = { ok: false, error: 'comprobando…' };

function cors(req, res) {
  const origin = req.headers.origin || '';
  // Solo la extensión YOUTUBE AUTOMATIZADO (origen chrome-extension://) y la propia app pueden llamar a la API.
  if (/^chrome-extension:\/\/[a-p]{32}$/.test(origin) || origin === `http://${HOST}:${PORT}` || origin === `http://localhost:${PORT}`) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  }
}

function send(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body);
}

function readBody(req, limit = MAX_UPLOAD) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', c => {
      size += c.length;
      if (size > limit) { reject(Object.assign(new Error('Archivo demasiado grande'), { status: 413 })); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function readJson(req) {
  const b = await readBody(req, 20 * 1024 * 1024);
  try { return JSON.parse(b.toString('utf8') || '{}'); } catch { throw Object.assign(new Error('JSON no válido'), { status: 400 }); }
}

function serveFile(req, res, file, download) {
  const st = fs.statSync(file);
  const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
  const headers = { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-cache' };
  if (download) headers['Content-Disposition'] = `attachment; filename="${path.basename(file).replace(/"/g, '')}"`;
  const range = req.headers.range && /bytes=(\d*)-(\d*)/.exec(req.headers.range);
  if (range) {
    let start = range[1] ? parseInt(range[1], 10) : 0;
    let end = range[2] ? parseInt(range[2], 10) : st.size - 1;
    if (!range[1] && range[2]) { start = st.size - parseInt(range[2], 10); end = st.size - 1; }
    if (start >= st.size || end >= st.size || start > end) { res.writeHead(416, { 'Content-Range': `bytes */${st.size}` }); return res.end(); }
    res.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${end}/${st.size}`, 'Content-Length': end - start + 1 });
    fs.createReadStream(file, { start, end }).pipe(res);
  } else {
    res.writeHead(200, { ...headers, 'Content-Length': st.size });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file).pipe(res);
  }
}

async function handleApi(req, res, url) {
  const parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent); // ['api', ...]
  const m = req.method;

  if (parts[1] === 'status' && m === 'GET') {
    return send(res, 200, { app: 'YOUTUBE AUTOMATIZADO', ffmpeg: toolsStatus, dataDir: storage.DATA_DIR, projectsDir: storage.PROJECTS_DIR });
  }

  if (parts[1] === 'projects' && parts.length === 2) {
    if (m === 'GET') return send(res, 200, storage.listProjects());
    if (m === 'POST') {
      const { name } = await readJson(req);
      if (!name || !String(name).trim()) return send(res, 400, { error: 'Escribe un nombre de proyecto' });
      return send(res, 201, storage.createProject(String(name).trim()));
    }
  }

  if (parts[1] === 'projects' && parts[2]) {
    const id = parts[2];
    if (parts.length === 3 && m === 'GET') {
      const p = storage.readProject(id);
      return send(res, 200, { ...p, dir: storage.projectDir(id) });
    }
    if (parts[3] === 'editor' && m === 'PUT') {
      const body = await readJson(req);
      return send(res, 200, storage.saveEditorState(id, body));
    }
    if (parts[3] === 'files' && parts[4]) {
      const kind = parts[4];
      if (parts.length === 5 && m === 'GET') return send(res, 200, storage.listFiles(id, kind));
      if (parts.length === 5 && m === 'POST') {
        const name = url.searchParams.get('name');
        const buf = await readBody(req);
        if (!buf.length) return send(res, 400, { error: 'Archivo vacío' });
        const saved = storage.saveFile(id, kind, name, buf);
        if (kind === 'audio') {
          try {
            const info = await media.probe(saved.path);
            if (!info.audio) { fs.unlinkSync(saved.path); return send(res, 400, { error: 'El archivo no contiene audio válido' }); }
            saved.duration = info.duration; saved.codec = info.audio.codec;
          } catch (e) { fs.unlinkSync(saved.path); return send(res, 400, { error: 'No se pudo leer el audio: ' + e.message }); }
        }
        return send(res, 201, saved);
      }
      if (parts.length === 6 && (m === 'GET' || m === 'HEAD')) {
        return serveFile(req, res, storage.filePath(id, kind, parts[5]), url.searchParams.has('download'));
      }
    }
    if (parts[3] === 'export' && m === 'POST') {
      if (!toolsStatus.ok) return send(res, 500, { error: toolsStatus.error });
      const body = await readJson(req);
      storage.readProject(id);
      const job = exporter.startExport({ projectId: id, scenes: body.scenes, audio: body.audio, zoom: !!body.zoom, quality: body.quality });
      return send(res, 202, { jobId: job.id });
    }
  }

  if (parts[1] === 'jobs' && parts[2] && m === 'GET') {
    const job = exporter.getJob(parts[2]);
    if (!job) return send(res, 404, { error: 'Trabajo no encontrado' });
    return send(res, 200, job);
  }

  // Puente RaulitoShow IA → almacenamiento: la extensión envía cada resultado descargado de Flow.
  if (parts[1] === 'flow' && parts[2] === 'save' && m === 'POST') {
    const project = url.searchParams.get('project');
    const name = url.searchParams.get('name');
    if (!project || !name) return send(res, 400, { error: 'Faltan project o name' });
    const p = storage.ensureProject(project);
    const buf = await readBody(req);
    if (!buf.length) return send(res, 400, { error: 'Archivo vacío' });
    const saved = storage.saveFile(p.id, 'flow', name, buf);
    return send(res, 201, { project: p.id, ...saved });
  }

  return send(res, 404, { error: 'Ruta no encontrada' });
}

const server = http.createServer(async (req, res) => {
  cors(req, res);
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
  const url = new URL(req.url, `http://${HOST}:${PORT}`);
  try {
    if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url);
    let p = url.pathname === '/' ? '/index.html' : url.pathname;
    if (p === '/editor') p = '/editor.html';
    if (p === '/raulitoshow') p = '/raulitoshow.html';
    const file = path.normalize(path.join(PUBLIC, p));
    if (!file.startsWith(PUBLIC) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); return res.end('No encontrado'); }
    serveFile(req, res, file, false);
  } catch (e) {
    if (!res.headersSent) send(res, e.status || 500, { error: e.message });
    else res.end();
  }
});

media.checkTools().then(s => { toolsStatus = s; if (!s.ok) console.warn('ATENCIÓN:', s.error); });

if (require.main === module) {
  server.listen(PORT, HOST, () => {
    console.log(`YOUTUBE AUTOMATIZADO en http://${HOST}:${PORT}`);
    console.log(`Proyectos guardados en: ${storage.PROJECTS_DIR}`);
  });
}

module.exports = { server, PORT, HOST };
