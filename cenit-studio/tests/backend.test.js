// Prueba de integración del backend: PostgreSQL real, FFmpeg real, cola real; YouTube y Gemini con dobles locales.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { startFakes } from './fakes.js';

let app, fakes, sql, idle, u1, u2;
const DB = 'cenit_test';
const call = async (method, url, { token, body, raw, headers = {} } = {}) => {
  const r = await app.inject({ method, url, payload: raw ?? (body !== undefined ? body : undefined), headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers } });
  const json = (() => { try { return r.json(); } catch { return null; } })();
  return { status: r.statusCode, body: json, raw: r.rawPayload, headers: r.headers };
};
const ok = async (...a) => { const r = await call(...a); if (r.status >= 300) throw new Error(`${a[0]} ${a[1]} → ${r.status} ${JSON.stringify(r.body)}`); return r.body; };

before(async () => {
  execFileSync('su', ['postgres', '-c', `dropdb --if-exists ${DB}; createdb ${DB}`]);
  fakes = await startFakes();
  Object.assign(process.env, fakes.env, { DATABASE_URL: `postgres://postgres:postgres@127.0.0.1:5432/${DB}`, LOCAL_JWT_SECRET: 'secreto-de-pruebas', STORAGE_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'cenit-st-')), RUN_WORKER: 'false' });
  ({ sql } = await import('../server/db/index.js'));
  const { migrate } = await import('../server/db/migrate.js');
  await migrate();
  ({ idle } = await import('../server/core/jobs.js'));
  for (const m of ['projects', 'visuals', 'voices', 'render', 'inspired', 'weekly']) await import(`../server/modules/${m}.js`);
  const { buildApp } = await import('../server/app.js');
  app = await buildApp();
  u1 = await ok('POST', '/api/auth/register', { body: { email: 'ana@ejemplo.com', password: 'clave-segura-1' } });
  u2 = await ok('POST', '/api/auth/register', { body: { email: 'luis@ejemplo.com', password: 'clave-segura-2' } });
});
after(async () => { await app?.close(); fakes?.server.close(); const { closeDb } = await import('../server/db/index.js'); await closeDb(); });

test('sesión, créditos iniciales y permisos', async () => {
  const me = await ok('GET', '/api/me', { token: u1.token });
  assert.equal(me.credits, 20000);
  assert.equal(me.user.isAdmin, true, 'el primer usuario es administrador');
  assert.equal((await ok('GET', '/api/me', { token: u2.token })).user.isAdmin, false);
  assert.equal((await call('GET', '/api/me')).status, 401);
  assert.equal((await call('GET', '/api/me', { token: 'basura' })).status, 401);
  assert.equal((await call('POST', '/api/auth/login', { body: { email: 'ana@ejemplo.com', password: 'mal' } })).status, 401);
  assert.equal((await call('POST', '/api/creditos/recargar', { token: u2.token, body: { amount: 100 } })).status, 403);
  await ok('POST', '/api/creditos/recargar', { token: u1.token, body: { amount: 500, email: 'luis@ejemplo.com' } });
  assert.equal((await ok('GET', '/api/me', { token: u2.token })).credits, 20500);
});

let viralId;
test('Radar Viral: clasificación explicable y sin confundir popularidad histórica', async () => {
  const r = await ok('POST', '/api/radar/viral', { token: u1.token, body: { keyword: 'misterio', period: '30d', languages: ['es', 'en'] } });
  viralId = r.id;
  const by = Object.fromEntries(r.items.map((i) => [i.item_id, i]));
  assert.ok(!by.vBigOld0001, 'un vídeo de hace 3 años no entra en el periodo');
  assert.ok(by.vSmallHit03.categories.includes('canal_pequeno'), 'canal de 2.000 suscriptores con 300.000 vistas');
  assert.ok(by.vSmallHit03.categories.includes('viral'));
  assert.ok(by.vSmallHit03.categories.includes('excepcional'));
  assert.ok(!by.vBigNew0002.categories.includes('viral'), 'rinde por debajo de lo habitual de su canal grande');
  assert.ok(by.vSmallHit03.explanation.some((e) => /× la mediana del canal/.test(e)));
  assert.ok(by.vSmallHit03.explanation.some((e) => /sin dos capturas/.test(e)), 'declara que la velocidad aún no está medida');
  assert.ok(r.quota_used >= 200);
  // capturas sucesivas → velocidad medida y aceleración
  await sql`insert into yt_video_snapshots(video_id, taken_at, views) values ('vSmallHit03', now() - interval '3 hours', 294000), ('vSmallHit03', now() - interval '2 hours', 295000)`;
  await sql`delete from yt_video_snapshots where video_id = 'vSmallHit03' and taken_at > now() - interval '1 hour'`;
  fakes.grow();
  const r2 = await ok('POST', `/api/radar/busquedas/${viralId}/actualizar`, { token: u1.token });
  const hit = r2.items.find((i) => i.item_id === 'vSmallHit03');
  assert.ok(hit.categories.includes('acelerado'), JSON.stringify(hit.explanation));
  assert.ok(hit.explanation.some((e) => /Velocidad medida entre capturas/.test(e)));
});

test('clasificación: un vídeo muy visto pero antiguo nunca es «viral»', async () => {
  const { classifyVideo, mergeThresholds } = await import('../server/modules/metrics.js');
  const c = classifyVideo({ views: 9000000, published_at: new Date(Date.now() - 3 * 365 * 86400e3).toISOString() }, { channel: { subscribers: 1000 }, profile: { medianViews: 1000, sample: 10 }, velocity: {}, thresholds: mergeThresholds() });
  assert.ok(!c.categories.includes('viral') && !c.categories.includes('extraordinario') && !c.categories.includes('despegando'));
  assert.ok(c.explanation.some((e) => /No se etiqueta como viral/.test(e)));
});

test('Radar de Canales: canal nuevo y monetización con evidencia', async () => {
  const r = await ok('POST', '/api/radar/canales', { token: u1.token, body: { keyword: 'misterio', maxSubscribers: 5000, channelMaxAgeDays: 60 } });
  assert.equal(r.items.length, 1);
  const it = r.items[0];
  assert.equal(it.item_id, 'UCsmall00000000000000002');
  assert.equal(it.monetization, 'senales', 'enlace de membresías = señal pública, no confirmación');
  assert.ok(it.categories.includes('canal_nuevo') && it.categories.includes('canal_pequeno'));
  assert.ok(it.explanation.some((e) => /Creado el .* según YouTube/.test(e)));
  assert.match(it.evidence.monetization.disclaimer, /No confirmada/);
  assert.equal((await call('POST', `/api/canales/${it.item_id}/evidencia`, { token: u1.token, body: { sourceUrl: 'no-es-url', note: 'x' } })).status, 400);
  await ok('POST', `/api/canales/${it.item_id}/evidencia`, { token: u1.token, body: { sourceUrl: 'https://ejemplo.com/entrevista', note: 'El creador muestra su panel de ingresos de YouTube.' } });
  const a = await ok('POST', '/api/canales/analizar', { token: u1.token, body: { ref: '@misteriosnuevos' } });
  assert.equal(a.monetization.group, 'confirmada');
  assert.match(a.stats.revenueEstimate.basis, /ESTIMACIÓN/);
  assert.equal(a.videos.length, 3);
  assert.ok(a.performance.top[0].vsMedian > 1);
  // otro usuario no ve esa evidencia: para él vuelve a ser sólo señal
  assert.equal((await ok('POST', '/api/canales/analizar', { token: u2.token, body: { ref: '@misteriosnuevos' } })).monetization.group, 'senales');
});

let pid;
test('Desde Idea: guion, mejora, escenas coherentes, reparto y referencias', { timeout: 120000 }, async () => {
  const before = (await ok('GET', '/api/me', { token: u1.token })).credits;
  const p = await ok('POST', '/api/proyectos', { token: u1.token, body: { mode: 'idea', idea: '¿Por qué el cangrejo de los cocoteros sabe a langosta?', format: '16:9', style_id: 'cinematic-stickman', template: 'misterio', rhythm: 'normal' } });
  pid = p.id;
  const imp = await ok('POST', `/api/proyectos/${pid}/mejorar-idea`, { token: u1.token, body: {} });
  assert.match(imp.mejorada, /cangrejo/);
  const g = await ok('POST', `/api/proyectos/${pid}/guion`, { token: u1.token, body: { minutes: 1 } });
  assert.ok(g.script.split(' ').length > 50);
  const est = await ok('GET', `/api/proyectos/${pid}/estimacion?recalcular=1`, { token: u1.token });
  assert.ok(est.scenes >= 1 && est.imageCredits > 0 && est.animateAllCredits > est.imageCredits);
  await ok('POST', `/api/proyectos/${pid}/dividir`, { token: u1.token });
  await idle();
  const full = await ok('GET', `/api/proyectos/${pid}`, { token: u1.token });
  assert.equal(full.scenes.length, 5);
  assert.equal(full.scenes.map((s) => s.narration).join(' '), g.script.replace(/\s+/g, ' ').trim(), 'las escenas reproducen el guion exacto');
  assert.deepEqual(full.cast.map((c) => c.name).sort(), ['Cangrejo', 'Marta']);
  const marta = full.cast.find((c) => c.name === 'Marta');
  assert.ok(full.scenes[0].character_ids.includes(marta.id));
  const ref = await ok('POST', `/api/proyectos/${pid}/reparto/${marta.id}/generar`, { token: u1.token });
  assert.ok(ref.ref_path);
  const big = await ok('POST', `/api/proyectos/${pid}/reparto/${marta.id}/ampliar`, { token: u1.token });
  const { probe } = await import('../server/services/ffmpeg.js');
  const { localPath } = await import('../server/core/storage.js');
  assert.equal((await probe(await localPath(big.ref_path))).streams[0].width, 2 * (await probe(await localPath(ref.ref_path))).streams[0].width);
  assert.ok((await ok('GET', '/api/me', { token: u1.token })).credits < before, 'consume créditos');
});

test('imágenes: todas, fallo aislado, reintento y Prompt Img individual', { timeout: 120000 }, async () => {
  const p0 = await ok('GET', `/api/proyectos/${pid}`, { token: u1.token });
  const s3 = p0.scenes[2];
  await ok('PATCH', `/api/proyectos/${pid}/escenas/${s3.id}`, { token: u1.token, body: { image_prompt: 'FALLA a propósito' } });
  const creditsBefore = (await ok('GET', '/api/me', { token: u1.token })).credits;
  await ok('POST', `/api/proyectos/${pid}/imagenes`, { token: u1.token, body: {} });
  await idle();
  let p = await ok('GET', `/api/proyectos/${pid}`, { token: u1.token });
  assert.deepEqual(p.scenes.map((s) => s.image_status), ['lista', 'lista', 'error', 'lista', 'lista']);
  assert.match(p.scenes[2].image_error, /bloqueado/);
  assert.equal((await ok('GET', '/api/me', { token: u1.token })).credits, creditsBefore - 4 * 39, 'la imagen fallida se reembolsa');
  await ok('PATCH', `/api/proyectos/${pid}/escenas/${s3.id}`, { token: u1.token, body: { image_prompt: 'the crab climbing the spiral staircase' } });
  await ok('POST', `/api/proyectos/${pid}/imagenes`, { token: u1.token, body: { sceneIds: [s3.id] } });
  await idle();
  p = await ok('GET', `/api/proyectos/${pid}`, { token: u1.token });
  assert.ok(p.scenes.every((s) => s.image_status === 'lista'));
  const old = p.scenes[0].image_path;
  await ok('POST', `/api/proyectos/${pid}/imagenes`, { token: u1.token, body: { sceneIds: [p.scenes[0].id] } });
  await idle();
  p = await ok('GET', `/api/proyectos/${pid}`, { token: u1.token });
  assert.notEqual(p.scenes[0].image_path, old, 'sólo esa imagen se regenera');
  assert.equal(p.scenes[1].image_path, p0.scenes[1].image_path ?? p.scenes[1].image_path);
});

test('animación (cámara y Veo), voz, subtítulos, música, edición y exportación', { timeout: 300000 }, async () => {
  let p = await ok('GET', `/api/proyectos/${pid}`, { token: u1.token });
  await ok('POST', `/api/proyectos/${pid}/animar`, { token: u1.token, body: { sceneIds: [p.scenes[0].id], mode: 'camara' } });
  await ok('POST', `/api/proyectos/${pid}/animar`, { token: u1.token, body: { sceneIds: [p.scenes[1].id], mode: 'veo' } });
  await ok('PATCH', `/api/proyectos/${pid}`, { token: u1.token, body: { voice: { provider: 'gemini', voiceId: 'Charon', speed: 1.1 } } });
  await ok('POST', `/api/proyectos/${pid}/voz`, { token: u1.token, body: {} });
  await idle();
  p = await ok('GET', `/api/proyectos/${pid}`, { token: u1.token });
  assert.equal(p.scenes[0].anim_status, 'lista');
  assert.equal(p.scenes[1].anim_status, 'lista', p.scenes[1].anim_error);
  assert.ok(p.scenes.every((s) => s.audio_status === 'lista' && s.audio_sec > 0));
  const cues = (await ok('GET', `/api/proyectos/${pid}/subtitulos/auto`, { token: u1.token })).cues;
  assert.ok(cues.length > p.scenes.length && cues.every((c) => c.end > c.start));
  const tracks = await ok('GET', '/api/musica', { token: u1.token });
  const music = tracks.find((t) => t.kind === 'musica'), fx = tracks.find((t) => t.kind === 'efecto');
  await ok('PATCH', `/api/proyectos/${pid}`, { token: u1.token, body: {
    subtitles: { enabled: true, manual: true, cues: cues.map((c, i) => (i === 0 ? { ...c, text: 'TEXTO EDITADO' } : c)), style: { font: 'DejaVu Sans', size: 60, position: 'abajo', primary: '#FFFFFF', highlight: '#3BA0FF', outline: '#000000', outlineWidth: 3, animation: 'karaoke' } },
    music: { trackId: music.id, volume: 0.2, ducking: true, startScene: 1, endScene: 5, sfx: [{ trackId: fx.id, scene: 3, volume: 0.7 }] },
    edit: { kenBurns: true, brightness: 0.02, contrast: 1.05, saturation: 1.1, voiceVolume: 1, transitionSec: 0.4 },
  } });
  await ok('PATCH', `/api/proyectos/${pid}/escenas/${p.scenes[2].id}`, { token: u1.token, body: { transition: 'deslizar' } });
  await ok('POST', `/api/proyectos/${pid}/escenas/orden`, { token: u1.token, body: { ids: [p.scenes[1].id, p.scenes[0].id, ...p.scenes.slice(2).map((s) => s.id)] } });
  await ok('POST', `/api/proyectos/${pid}/render`, { token: u1.token, body: { kind: 'previa' } });
  await ok('POST', `/api/proyectos/${pid}/render`, { token: u1.token, body: { kind: 'final', resolution: '720p' } });
  await idle();
  p = await ok('GET', `/api/proyectos/${pid}`, { token: u1.token });
  const failed = p.jobs.filter((j) => j.status === 'error' && j.kind !== 'escena.imagen'); // el fallo de imagen de la prueba anterior fue provocado
  assert.deepEqual(failed, [], JSON.stringify(failed));
  assert.ok(p.edit.previewPath && p.export_path);
  assert.equal(p.export_meta.resolution, '1280x720');
  const tl = await ok('GET', `/api/proyectos/${pid}/linea-tiempo`, { token: u1.token });
  assert.ok(Math.abs(p.export_meta.duration - tl.reduce((a, x) => a + x.duration, 0)) < 0.6);
  const dl = await call('GET', `/api/archivo?key=${encodeURIComponent(p.export_path)}&descargar=1`, { token: u1.token });
  assert.equal(dl.status, 200);
  assert.equal(dl.raw.subarray(4, 8).toString(), 'ftyp');
  assert.equal((await call('GET', `/api/archivo?key=${encodeURIComponent(p.export_path)}`, { token: u2.token })).status, 404, 'otro usuario no puede descargarlo');
  assert.equal((await call('GET', `/api/proyectos/${pid}`, { token: u2.token })).status, 404);
});

test('Desde Guion y Desde URL (web y YouTube)', { timeout: 120000 }, async () => {
  const short = await call('POST', '/api/proyectos', { token: u1.token, body: { mode: 'guion', script: 'muy corto', format: '9:16', style_id: 'anime-japones' } });
  assert.equal(short.status, 400);
  const g = await ok('POST', '/api/proyectos', { token: u1.token, body: { mode: 'guion', script: 'Marta llegó al faro una noche de tormenta. Nadie había encendido aquella luz en cuarenta años. En la playa la esperaba un cangrejo enorme. El cangrejo trepó por la escalera. Marta lo siguió con su linterna.', format: '9:16', style_id: 'anime-japones' } });
  await ok('POST', `/api/proyectos/${g.id}/dividir`, { token: u1.token });
  const web = await ok('POST', '/api/proyectos', { token: u1.token, body: { mode: 'url', url: `${fakes.base}/articulo`, format: '1:1', style_id: 'documental' } });
  const ytp = await ok('POST', '/api/proyectos', { token: u1.token, body: { mode: 'url', url: 'https://www.youtube.com/watch?v=vSmallHit03', format: '16:9', style_id: 'terror-gotico' } });
  await idle();
  assert.equal((await ok('GET', `/api/proyectos/${g.id}`, { token: u1.token })).scenes.length, 3);
  const w = await ok('GET', `/api/proyectos/${web.id}`, { token: u1.token });
  assert.equal(w.source.kind, 'web');
  assert.equal(w.idea, 'La guardiana del faro y el diario perdido');
  const y = await ok('GET', `/api/proyectos/${ytp.id}`, { token: u1.token });
  assert.equal(y.source.kind, 'youtube');
  assert.equal(y.source.metadata.title, 'El misterio del faro que nadie explica');
  assert.match(y.source.note, /no descarga/);
});

test('Desde Audio: transcripción con tiempos, escenas y narración subida en el vídeo', { timeout: 240000 }, async () => {
  const p = await ok('POST', '/api/proyectos', { token: u1.token, body: { mode: 'audio', format: '16:9', style_id: 'vector-flat', title: 'Narración subida' } });
  const wav = path.join(os.tmpdir(), 'narracion.wav');
  execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'sine=f=200:d=16', '-af', 'volume=0.5', wav]);
  const boundary = '----cenit';
  const body = Buffer.concat([Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="narracion.wav"\r\nContent-Type: audio/wav\r\n\r\n`), fs.readFileSync(wav), Buffer.from(`\r\n--${boundary}--\r\n`)]);
  await ok('POST', `/api/proyectos/${p.id}/audio`, { token: u1.token, raw: body, headers: { 'content-type': `multipart/form-data; boundary=${boundary}` } });
  await idle();
  let full = await ok('GET', `/api/proyectos/${p.id}`, { token: u1.token });
  assert.equal(full.source.segments.length, 4);
  await ok('POST', `/api/proyectos/${p.id}/dividir`, { token: u1.token });
  await idle();
  full = await ok('GET', `/api/proyectos/${p.id}`, { token: u1.token });
  assert.ok(full.scenes.length >= 2);
  await ok('POST', `/api/proyectos/${p.id}/imagenes`, { token: u1.token, body: {} });
  await ok('POST', `/api/proyectos/${p.id}/voz`, { token: u1.token, body: {} });
  await idle();
  full = await ok('GET', `/api/proyectos/${p.id}`, { token: u1.token });
  const total = full.scenes.reduce((a, s) => a + s.audio_sec, 0);
  assert.ok(Math.abs(total - 16) < 0.3, `la narración subida se reparte completa (${total})`);
  await ok('POST', `/api/proyectos/${p.id}/render`, { token: u1.token, body: { kind: 'final', resolution: '720p' } });
  await idle();
  full = await ok('GET', `/api/proyectos/${p.id}`, { token: u1.token });
  assert.ok(full.export_path, JSON.stringify(full.jobs.filter((j) => j.status === 'error')));
});

test('Crear vídeo inspirado en una oportunidad del Radar', { timeout: 300000 }, async () => {
  const p = await ok('POST', '/api/oportunidad', { token: u1.token, body: { videoId: 'vSmallHit03', format: '9:16', styleId: 'epoca-romana', minutes: 1, voice: { provider: 'gemini', voiceId: 'Kore' } } });
  await idle();
  const full = await ok('GET', `/api/proyectos/${p.id}`, { token: u1.token });
  const j = full.jobs.find((x) => x.kind === 'oportunidad.crear');
  assert.equal(j.status, 'hecho', j.message);
  assert.equal(full.source.analysis.idea_original_propuesta, 'La guardiana del faro y el diario perdido');
  assert.ok(full.export_path && full.export_meta.resolution === '1080x1920');
});

test('Investigación semanal: guarda, compara con el historial y no repite novedades', { timeout: 120000 }, async () => {
  const r = await ok('POST', '/api/semanal', { token: u1.token, body: { name: 'Misterios', niches: ['misterio'], languages: ['es'], weekday: 1, hour: 9, maxSubscribers: 5000 } });
  assert.ok(new Date(r.next_run_at) > new Date());
  await ok('POST', `/api/semanal/${r.id}/ejecutar`, { token: u1.token });
  await idle();
  await ok('POST', `/api/semanal/${r.id}/ejecutar`, { token: u1.token });
  await idle();
  const reps = await ok('GET', `/api/semanal/${r.id}/informes`, { token: u1.token });
  assert.equal(reps.length, 2);
  const [second, first] = reps;
  assert.ok(first.summary.new > 0 && first.items.every((i) => i.isNew));
  assert.equal(second.summary.new, 0);
  assert.match(second.summary.message, /No hay resultados nuevos verificados/);
  assert.ok(first.items.some((i) => i.type === 'canal' && /Señales públicas|confirmada/.test(i.monetization)), 'el canal aparece con su estado de monetización según la evidencia');
});

test('sin claves, los servicios lo dicen claramente', async () => {
  const k = process.env.YOUTUBE_API_KEY;
  delete process.env.YOUTUBE_API_KEY;
  const r = await call('POST', '/api/radar/viral', { token: u1.token, body: { keyword: 'x' } });
  process.env.YOUTUBE_API_KEY = k;
  assert.equal(r.status, 503);
  assert.match(r.body.error, /falta YOUTUBE_API_KEY/);
});
