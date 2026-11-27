// Servidor de Vimo: API REST + eventos en tiempo real + archivos de medios + interfaz web compilada.
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { MEDIA_DIR, DATA_DIR } from './db.js';
import { bus, recoverInterrupted } from './jobs.js';
import './pipeline/produce.js';
import { projects, script } from './routes/projects.js';
import { styles, characters, avatars, voices, music, settings, keys } from './routes/assets.js';
import { FFMPEG } from './media.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WEB_DIST = path.resolve(__dirname, '../../web/dist');
const PORT = Number(process.env.PORT) || 5180;
const HOST = process.env.HOST || '127.0.0.1';

const app = express();
app.use(express.json({ limit: '5mb' }));

app.get('/api/health', (req, res) => {
  const ff = spawnSync(FFMPEG, ['-version']);
  res.json({ ok: true, ffmpeg: ff.status === 0 ? String(ff.stdout).split('\n')[0] : null, data_dir: DATA_DIR });
});
app.use('/api/projects', projects);
app.use('/api/script', script);
app.use('/api/styles', styles);
app.use('/api/characters', characters);
app.use('/api/avatars', avatars);
app.use('/api/voices', voices);
app.use('/api/music', music);
app.use('/api/settings', settings);
app.use('/api/keys', keys);

// Progreso en tiempo real (Server-Sent Events).
app.get('/api/events', (req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.write('retry: 3000\n\n');
  const onJob = j => res.write(`event: job\ndata: ${JSON.stringify(j)}\n\n`);
  const onProject = id => res.write(`event: project\ndata: ${JSON.stringify({ id })}\n\n`);
  const ping = setInterval(() => res.write(': ping\n\n'), 20000);
  bus.on('job', onJob);
  bus.on('project', onProject);
  req.on('close', () => { clearInterval(ping); bus.off('job', onJob); bus.off('project', onProject); });
});

app.use('/media', express.static(MEDIA_DIR, { maxAge: '1h', fallthrough: false, dotfiles: 'allow' }));

if (fs.existsSync(WEB_DIST)) {
  app.use(express.static(WEB_DIST));
  app.get(/^(?!\/api|\/media).*/, (req, res) => res.sendFile(path.join(WEB_DIST, 'index.html')));
} else {
  app.get('/', (req, res) => res.type('text').send('Interfaz no compilada. Ejecuta «npm run build» o usa «npm run dev:web».'));
}

// Errores: mensaje legible para la interfaz.
app.use((err, req, res, _next) => {
  const status = err.status || (err.code === 'MISSING_KEY' ? 400 : 500);
  if (status >= 500) console.error(err);
  res.status(status).json({ error: err.message || 'Error interno', code: err.code });
});

recoverInterrupted();
app.listen(PORT, HOST, () => console.log(`Vimo escuchando en http://${HOST}:${PORT}  (datos: ${DATA_DIR})`));
