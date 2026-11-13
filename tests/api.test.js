'use strict';
// Pruebas reales de la app: servidor, almacenamiento, audio y exportación MP4 con FFmpeg.
const test = require('node:test');
const assert = require('node:assert');
const { spawn, execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { makeMedia, tmpDir } = require('./helpers');

const PORT = 5400 + Math.floor(Math.random() * 400);
const BASE = `http://127.0.0.1:${PORT}`;
const DATA = tmpDir('ya-data-');
const MEDIA = makeMedia(tmpDir('ya-media-'));
let proc;
const sha = f => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');

async function j(p, opt) { const r = await fetch(BASE + p, opt); return { status: r.status, body: await r.json(), headers: r.headers }; }
const up = (pid, kind, file, name) => j(`/api/projects/${pid}/files/${kind}?name=${encodeURIComponent(name || path.basename(file))}`, { method: 'POST', body: fs.readFileSync(file) });

test.before(async () => {
  proc = spawn(process.execPath, [path.join(__dirname, '../app/server.js')], { env: { ...process.env, YA_DATA_DIR: DATA, YA_PORT: String(PORT) }, stdio: 'pipe' });
  for (let i = 0; i < 50; i++) { try { await fetch(BASE + '/api/status'); return; } catch { await new Promise(r => setTimeout(r, 100)); } }
  throw new Error('el servidor no arrancó');
});
test.after(() => { proc.kill(); fs.rmSync(DATA, { recursive: true, force: true }); });

async function waitJob(id) {
  for (let i = 0; i < 600; i++) {
    const { body } = await j('/api/jobs/' + id);
    if (body.state !== 'running') return body;
    await new Promise(r => setTimeout(r, 250));
  }
  throw new Error('timeout');
}

test('estado y FFmpeg', async () => {
  await new Promise(r => setTimeout(r, 300));
  const { body } = await j('/api/status');
  assert.strictEqual(body.app, 'YOUTUBE AUTOMATIZADO');
  assert.strictEqual(body.ffmpeg.ok, true);
  assert.ok(body.projectsDir.startsWith(DATA));
});

test('flujo completo: proyecto, imágenes, audio, exportación MP4 real', async () => {
  const hashes = MEDIA.imgs.map(sha);
  const { status, body: p } = await j('/api/projects', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Prueba Video' }) });
  assert.strictEqual(status, 201);
  assert.strictEqual(p.id, 'Prueba_Video');

  const scenes = [];
  for (const f of MEDIA.imgs) { const r = await up(p.id, 'imagenes', f); assert.strictEqual(r.status, 201); scenes.push({ file: r.body.name, kind: 'imagenes', duration: 1.5 }); }

  // No sobrescribe archivos con el mismo nombre
  const dup = await up(p.id, 'imagenes', MEDIA.imgs[0]);
  assert.strictEqual(dup.body.name, 'escena_001 (2).png');

  // Audio MP3/WAV/M4A con duración real
  const a = await up(p.id, 'audio', MEDIA.audio);
  assert.strictEqual(a.status, 201);
  assert.ok(Math.abs(a.body.duration - 6) < 0.1, 'duración mp3 ' + a.body.duration);
  const w = await up(p.id, 'audio', MEDIA.wav); assert.ok(Math.abs(w.body.duration - 3) < 0.05);
  const m = await up(p.id, 'audio', MEDIA.m4a); assert.ok(Math.abs(m.body.duration - 2) < 0.1);
  // Archivo que no es audio → rechazado
  const bad = await up(p.id, 'audio', MEDIA.txt, 'falso.mp3');
  assert.strictEqual(bad.status, 400);

  // Exportación con zoom, 1080p
  const ex = await j(`/api/projects/${p.id}/export`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ scenes, audio: { file: a.body.name }, zoom: true, quality: '1080p' }) });
  assert.strictEqual(ex.status, 202);
  const job = await waitJob(ex.body.jobId);
  assert.strictEqual(job.state, 'done', job.error);
  assert.strictEqual(job.percent, 100);
  assert.ok(job.steps.every(s => s.status === 'done'));
  assert.strictEqual(job.steps.length, 9);
  assert.ok(fs.existsSync(job.output.path));
  assert.ok(job.output.path.startsWith(path.join(DATA, 'proyectos', p.id, 'exportaciones')));
  // El audio (6 s) es más largo que las escenas (4 x 1.5 = 6 s) → sin aviso
  assert.deepStrictEqual(job.warnings, []);

  // Validación independiente del archivo final
  const info = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_name,width,height,nb_frames:format=duration', '-of', 'json', job.output.path]));
  const v = info.streams.find(s => s.codec_name === 'h264');
  const au = info.streams.find(s => s.codec_name === 'aac');
  assert.ok(v && au);
  assert.strictEqual(v.width, 1920); assert.strictEqual(v.height, 1080);
  assert.strictEqual(Number(v.nb_frames), 180);
  assert.ok(Math.abs(Number(info.format.duration) - 6) < 0.1);
  // Decodificación completa sin errores
  execFileSync('ffmpeg', ['-v', 'error', '-xerror', '-i', job.output.path, '-f', 'null', '-']);

  // Escena 2 en t=2.25 s debe ser verde (comprobación del orden y los tiempos)
  const px = execFileSync('ffmpeg', ['-v', 'error', '-ss', '2.25', '-i', job.output.path, '-frames:v', '1', '-vf', 'crop=4:4:20:20,scale=1:1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']);
  assert.ok(px[1] > 100 && px[0] < 60 && px[2] < 60, 'pixel ' + [...px]);

  // Exportación sin zoom en 720p con duración distinta al audio → aviso
  const ex2 = await j(`/api/projects/${p.id}/export`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ scenes: scenes.map(s => ({ ...s, duration: 1 })), audio: { file: a.body.name }, zoom: false, quality: '720p' }) });
  const job2 = await waitJob(ex2.body.jobId);
  assert.strictEqual(job2.state, 'done', job2.error);
  assert.strictEqual(job2.output.width, 1280);
  assert.ok(Math.abs(job2.output.duration - 4) < 0.1);
  assert.strictEqual(job2.warnings.length, 1);
  assert.notStrictEqual(job2.output.path, job.output.path);

  // Los originales no se han modificado
  assert.deepStrictEqual(MEDIA.imgs.map(sha), hashes);

  // Estado del editor persistente
  await j(`/api/projects/${p.id}/editor`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ images: scenes, durations: [1, 2, 3, 4] }) });
  const again = await j(`/api/projects/${p.id}`);
  assert.deepStrictEqual(again.body.editor.durations, [1, 2, 3, 4]);
});

test('errores de exportación claros', async () => {
  const { body: p } = await j('/api/projects', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'errores' }) });
  const noImgs = await waitJob((await j(`/api/projects/${p.id}/export`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ scenes: [], audio: null }) })).body.jobId);
  assert.strictEqual(noImgs.state, 'error');
  assert.match(noImgs.error, /No hay imágenes/);
  assert.strictEqual(noImgs.steps[0].status, 'error');

  const r = await up(p.id, 'imagenes', MEDIA.imgs[0]);
  const noAudio = await waitJob((await j(`/api/projects/${p.id}/export`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ scenes: [{ file: r.body.name, duration: 2 }] }) })).body.jobId);
  assert.strictEqual(noAudio.state, 'error');
  assert.match(noAudio.error, /audio/);
  assert.strictEqual(noAudio.steps[1].status, 'error');
});

test('puente RaulitoShow IA → proyecto (flow/) y CORS solo para la extensión', async () => {
  const png = fs.readFileSync(MEDIA.imgs[2]);
  const r1 = await j('/api/flow/save?project=Mi Proyecto&name=escena_007.png', { method: 'POST', body: png, headers: { Origin: 'chrome-extension://abcdefghijklmnopabcdefghijklmnop' } });
  assert.strictEqual(r1.status, 201);
  assert.strictEqual(r1.headers.get('access-control-allow-origin'), 'chrome-extension://abcdefghijklmnopabcdefghijklmnop');
  assert.strictEqual(r1.body.project, 'Mi_Proyecto');
  const r2 = await j('/api/flow/save?project=Mi Proyecto&name=escena_007.png', { method: 'POST', body: png });
  assert.strictEqual(r2.body.name, 'escena_007 (2).png');
  const list = await j('/api/projects/Mi_Proyecto/files/flow');
  assert.deepStrictEqual(list.body.map(f => f.name), ['escena_007 (2).png', 'escena_007.png'].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })));
  const evil = await fetch(BASE + '/api/status', { headers: { Origin: 'https://evil.example' } });
  assert.strictEqual(evil.headers.get('access-control-allow-origin'), null);
  // Rutas con ../ rechazadas
  const trav = await fetch(BASE + '/api/projects/Mi_Proyecto/files/flow/..%2F..%2Fproject.json');
  assert.notStrictEqual(trav.status, 200);
});
