// Prueba de integración: buscador → oportunidad → REPLICAR Y MEJORAR → análisis → propuesta → guion → escenas →
// imágenes (Gemini y Google Flow) → revisión → voz → montaje FFmpeg → verificación → descarga del MP4.
// Los servicios externos son un DOBLE DE PRUEBAS (tests/fake-services.js); FFmpeg y la base de datos son reales.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startFakes } from './fake-services.js';

let fakes, base, server, drain;
const api = async (p, opts = {}) => {
  const res = await fetch(base + p, { ...opts, headers: { 'content-type': 'application/json', ...(opts.headers || {}) } });
  const body = res.headers.get('content-type')?.includes('json') ? await res.json() : await res.arrayBuffer();
  if (!res.ok) throw new Error(`${p}: ${res.status} ${JSON.stringify(body)}`);
  return body;
};

before(async () => {
  fakes = await startFakes();
  Object.assign(process.env, fakes.env, { EPO_DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'epo-data-')), MUSIC_VOLUME_DB: '-26' });
  const { openDb } = await import('../server/db/index.js');
  const jobs = await import('../server/core/jobs.js');
  await import('../server/modules/production.js');
  const { createServer } = await import('../server/app.js');
  openDb();
  jobs.startWorker();
  drain = jobs.drain;
  server = createServer().listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
  // referencia de la mascota (en la app la genera el navegador a partir del SVG)
  const { execFileSync } = await import('node:child_process');
  const png = path.join(process.env.EPO_DATA_DIR, 'ref.png');
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', path.resolve('web/img/detective.svg'), '-vf', 'scale=384:-1', png]);
  await api('/api/mascota/referencia', { method: 'POST', body: fs.readFileSync(png), headers: { 'content-type': 'image/png' } });
});

after(() => { server?.close(); fakes?.server.close(); setTimeout(() => process.exit(0), 100).unref(); });

let searchResult;
test('búsqueda real (formato YouTube) con oportunidades e historial', async () => {
  searchResult = await api('/api/busquedas', { method: 'POST', body: JSON.stringify({ query: 'negocio del cine', days: 30, language: 'es', competition: true }) });
  assert.equal(searchResult.status, 'ok');
  assert.equal(searchResult.results.length, 2);
  const top = searchResult.results[0];
  assert.equal(top.id, 'abcdefghijk', 'el video con más vistas/día y 18× sus suscriptores va primero');
  assert.equal(top.level, 'alta');
  assert.ok(top.reasons.some((r) => /18\.0× más vistas que suscriptores/.test(r)));
  assert.ok(searchResult.quota_used >= 200, `cuota registrada: ${searchResult.quota_used}`);
  const h = await api('/api/busquedas');
  assert.equal(h.items[0].query, 'negocio del cine');
  const panel = await api('/api/panel');
  assert.equal(panel.quota.used, searchResult.quota_used);
});

let projectId;
test('REPLICAR Y MEJORAR con Gemini produce un MP4 verificado', { timeout: 300000 }, async () => {
  const p = await api('/api/proyectos', { method: 'POST', body: JSON.stringify({ videoId: 'abcdefghijk' }) });
  projectId = p.id;
  await drain();
  const r = await api(`/api/proyectos/${projectId}`);
  const failed = r.stages.filter((s) => s.state !== 'hecho');
  assert.deepEqual(failed, [], JSON.stringify(failed));
  assert.equal(r.status, 'terminado');
  assert.equal(r.analysis.acceso, 'transcripcion');
  assert.equal(r.analysis.campos.tema.estado, 'verificado', 'la cita existe en la transcripción');
  assert.ok(r.proposal.research.sources.length >= 3);
  assert.ok(r.script.removed.length === 0, 'la cifra sin fuente se corrigió con su fuente');
  assert.ok(r.script.parts.flatMap((x) => x.paragraphs).every((t) => !/12 veces/.test(t)), 'la cifra sin respaldo no quedó en el guion');
  assert.ok(r.scenes.length >= 8);
  assert.ok(r.scenes.every((s) => s.review.state === 'aprobada' && s.audio_sec > 0 && s.image_version));
  assert.ok(r.verification.ok, JSON.stringify(r.verification.checks.filter((c) => !c.ok)));
  for (const id of ['sincronia', 'reproducible', 'musica', 'negros', 'estatico', 'voz']) assert.ok(r.verification.checks.find((c) => c.id === id).ok, id);
  assert.ok(r.can_download);
  const mp4 = Buffer.from(await api(`/api/proyectos/${projectId}/mp4`));
  assert.equal(mp4.subarray(4, 8).toString(), 'ftyp');
  for (const f of ['guion.md', 'narracion.mp3', 'miniatura.png', 'descripcion.txt', 'fuentes.md', 'titulo.txt']) assert.ok(r.deliverables.includes(`salida/${f}`), f);
  assert.ok(fakes.calls.image >= r.scenes.length + 1 && fakes.calls.review >= r.scenes.length);
});

test('editar una narración rehace sólo esa voz y vuelve a verificar', { timeout: 240000 }, async () => {
  const before = fakes.calls.tts;
  await api(`/api/proyectos/${projectId}/escenas/2/narracion`, { method: 'POST', body: JSON.stringify({ texto: 'Pero el dueño de la sala piensa en algo muy distinto, y eso lo cambia todo.' }) });
  let r = await api(`/api/proyectos/${projectId}`);
  assert.equal(r.can_download, false, 'el MP4 anterior deja de ofrecerse');
  await api(`/api/proyectos/${projectId}/producir`, { method: 'POST', body: '{}' });
  await drain();
  r = await api(`/api/proyectos/${projectId}`);
  assert.equal(fakes.calls.tts - before, 1);
  assert.equal(r.status, 'terminado');
});

test('con Google Flow: espera las imágenes, las recibe por el puente y termina', { timeout: 300000 }, async () => {
  await api('/api/configuracion', { method: 'PUT', body: JSON.stringify({ IMAGE_ENGINE: 'flow' }) });
  const imagesBefore = fakes.calls.image;
  const p = await api('/api/proyectos', { method: 'POST', body: JSON.stringify({ videoId: 'abcdefghijk' }) });
  await drain();
  let r = await api(`/api/proyectos/${p.id}`);
  assert.equal(r.status, 'necesita_accion');
  assert.match(r.stages.find((s) => s.name === 'imagenes').message, /Esperando imágenes de Google Flow/);
  assert.equal(fakes.calls.image, imagesBefore, 'con Flow el servidor no genera imágenes');
  const list = await api('/api/flow/proyectos');
  assert.ok(list.items.some((x) => x.id === p.id && x.pending === r.scenes.length));
  const q = await api(`/api/flow/proyectos/${p.id}`);
  assert.equal(q.items.length, r.scenes.length + 1, 'escenas + miniatura');
  assert.match(q.items[0].prompt, /BROWN trench coat/);
  assert.ok(q.mascot);
  // La extensión enviaría aquí cada imagen generada en Flow (archivos de prueba, formatos distintos):
  for (const it of q.items) {
    await api(`/api/flow/proyectos/${p.id}/imagen/${it.n}`, { method: 'POST', body: fakes.makePng(`flow${it.n}`), headers: { 'content-type': 'image/png' } });
  }
  assert.equal((await api(`/api/flow/proyectos/${p.id}`)).items.length, 0);
  await api(`/api/proyectos/${p.id}/producir`, { method: 'POST', body: '{}' });
  await drain();
  r = await api(`/api/proyectos/${p.id}`);
  assert.equal(r.status, 'terminado', JSON.stringify(r.stages.filter((s) => s.state !== 'hecho')));
  assert.ok(r.scenes.every((s) => s.image_engine === 'flow'));
});

test('sin clave de YouTube el buscador lo dice claramente', async () => {
  const k = process.env.YOUTUBE_API_KEY;
  delete process.env.YOUTUBE_API_KEY;
  const res = await fetch(`${base}/api/busquedas`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query: 'x' }) });
  process.env.YOUTUBE_API_KEY = k;
  assert.equal(res.status, 502);
  assert.match((await res.json()).error, /falta la clave YOUTUBE_API_KEY/);
});
