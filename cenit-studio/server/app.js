// API de Cenit Studio (Fastify). Todas las rutas /api exigen sesión salvo /api/auth/*.
import fs from 'node:fs';
import path from 'node:path';
import Fastify from 'fastify';
import multipart from '@fastify/multipart';
import fstatic from '@fastify/static';
import { ROOT, config, authMode, storageMode } from './config.js';
import { sql } from './db/index.js';
import { AppError } from './core/errors.js';
import { userFromRequest, localLogin, localRegister, publicUser } from './core/auth.js';
import { balance, grant, pricing, DEFAULT_PRICING } from './core/credits.js';
import { events } from './core/events.js';
import { enqueue } from './core/jobs.js';
import { localPath, put, scratch } from './core/storage.js';
import * as yt from './services/youtube.js';
import * as gemini from './services/gemini.js';
import { version as ffmpegVersion } from './services/ffmpeg.js';
import { setSetting, getSetting } from './modules/settings.js';
import * as styles from './modules/styles.js';
import { TEMPLATES } from './modules/templates.js';
import * as P from './modules/projects.js';
import * as V from './modules/visuals.js';
import * as VO from './modules/voices.js';
import * as M from './modules/music.js';
import * as S from './modules/subtitles.js';
import * as R from './modules/render.js';
import * as PR from './modules/produce.js';
import * as RD from './modules/radar.js';
import * as WK from './modules/weekly.js';
import { createInspired } from './modules/inspired.js';
import { DEFAULT_THRESHOLDS, CATEGORY_LABELS } from './modules/metrics.js';
import { GROUP_LABELS, YPP } from './modules/monetization.js';

const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.mp4': 'video/mp4', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.m4a': 'audio/mp4', '.ogg': 'audio/ogg', '.flac': 'audio/flac', '.aac': 'audio/aac' };

export async function buildApp() {
  const app = Fastify({ logger: false, bodyLimit: 30 * 1024 * 1024 });
  await app.register(multipart, { limits: { fileSize: 80 * 1024 * 1024 } });

  app.setErrorHandler((e, req, reply) => {
    const status = e.status || e.statusCode || 500;
    if (status >= 500 && !e.service) console.error(e);
    reply.code(status).send({ error: e.message });
  });

  // ---------------------------------------------------------------- sesión
  app.addHook('preHandler', async (req) => {
    if (!req.url.startsWith('/api/') || req.url.startsWith('/api/auth/')) return;
    req.user = await userFromRequest(req);
  });
  const admin = (req) => { if (!req.user.is_admin) throw new AppError(403, 'Sólo para administradores.'); };
  const file = async (req) => { const f = await req.file(); if (!f) throw new AppError(400, 'Falta el archivo.'); return { filename: f.filename, mime: f.mimetype, buffer: await f.toBuffer(), fields: Object.fromEntries(Object.entries(f.fields).filter(([, v]) => v?.value !== undefined).map(([k, v]) => [k, v.value])) }; };

  app.get('/api/auth/config', async () => ({ mode: authMode(), supabaseUrl: authMode() === 'supabase' ? config.supabaseUrl : null, supabaseAnonKey: authMode() === 'supabase' ? config.supabaseAnonKey : null }));
  app.post('/api/auth/register', async (req) => localRegister(req.body?.email, req.body?.password));
  app.post('/api/auth/login', async (req) => localLogin(req.body?.email, req.body?.password));

  app.get('/api/me', async (req) => ({ user: publicUser(req.user), credits: await balance(req.user.id), pricing: await pricing() }));

  // ---------------------------------------------------------------- créditos y ajustes
  app.get('/api/creditos', async (req) => ({ balance: await balance(req.user.id), ledger: await sql`select * from credit_ledger where user_id = ${req.user.id} order by id desc limit 200`, pricing: await pricing() }));
  app.post('/api/creditos/recargar', async (req) => {
    admin(req);
    const amount = Math.round(Number(req.body?.amount));
    if (!(amount > 0)) throw new AppError(400, 'Cantidad no válida');
    const [u] = await sql`select id from app_users where email = ${String(req.body?.email || req.user.email).toLowerCase()}`;
    if (!u) throw new AppError(404, 'Usuario no encontrado');
    await grant(u.id, amount, `recarga manual por ${req.user.email}`);
    return { balance: await balance(u.id) };
  });
  app.get('/api/ajustes', async () => ({
    auth: authMode(), storage: storageMode(), pricing: await pricing(), rpm: (await getSetting('rpm')) || RD.DEFAULT_RPM, thresholds: { ...DEFAULT_THRESHOLDS, ...((await getSetting('thresholds')) || {}) },
    models: { ...gemini.MODELS, ...Object.fromEntries(await Promise.all(Object.keys(gemini.MODELS).map(async (k) => [k, (await getSetting(`model.${k}`)) || gemini.MODELS[k]]))) },
    services: { youtube: !!config.youtubeKey, gemini: !!config.geminiKey, elevenlabs: !!config.elevenKey, supabase: authMode() === 'supabase', ffmpeg: await ffmpegVersion() },
    ypp: YPP,
  }));
  app.put('/api/ajustes', async (req) => {
    admin(req);
    const b = req.body || {};
    if (b.pricing) await setSetting('pricing', { usdPerCredit: Number(b.pricing.usdPerCredit) || DEFAULT_PRICING.usdPerCredit, ops: b.pricing.ops || {} });
    if (b.rpm) await setSetting('rpm', b.rpm);
    if (b.thresholds) await setSetting('thresholds', b.thresholds);
    for (const [k, v] of Object.entries(b.models || {})) if (gemini.MODELS[k]) await setSetting(`model.${k}`, String(v));
    return { ok: true };
  });
  app.post('/api/ajustes/probar/:svc', async (req) => {
    const s = req.params.svc;
    if (s === 'youtube') { const [v] = await yt.videos(['jNQXAC9IVRw']); return { ok: !!v, detail: v ? `Conectado: «${v.title}» (${Number(v.views).toLocaleString('es')} vistas). Cuota usada hoy: ${await yt.quotaToday()}/${yt.QUOTA_PER_DAY}.` : 'Sin respuesta' }; }
    if (s === 'gemini') { const m = await gemini.listModels(); const want = await Promise.all(Object.keys(gemini.MODELS).map(async (k) => [k, (await getSetting(`model.${k}`)) || gemini.MODELS[k]])); return { ok: true, detail: `Clave válida (${m.length} modelos). ${want.map(([k, id]) => `${k}: ${m.includes(id) ? '✔' : '✘'} ${id}`).join(' · ')}` }; }
    if (s === 'voces') { const c = await VO.catalog(); return { ok: c.voices.length > 0, detail: `${c.voices.length} voces disponibles. ${c.errors.join(' ')}` }; }
    if (s === 'ffmpeg') { const v = await ffmpegVersion(); return { ok: !!v, detail: v || 'FFmpeg no encontrado' }; }
    throw new AppError(400, 'Servicio desconocido');
  });

  // ---------------------------------------------------------------- dashboard
  app.get('/api/dashboard', async (req) => {
    const u = req.user.id;
    const [stats] = await sql`select (select count(*)::int from projects where owner_id = ${u}) as projects,
      (select count(*)::int from projects where owner_id = ${u} and export_path is not null) as exported,
      (select count(*)::int from scenes s join projects p on p.id = s.project_id where p.owner_id = ${u} and s.image_status = 'lista') as images,
      (select count(*)::int from radar_searches where owner_id = ${u}) as searches,
      (select coalesce(-sum(delta), 0)::int from credit_ledger where user_id = ${u} and delta < 0 and created_at > now() - interval '30 days') as credits30`;
    const activity = await sql`select date_trunc('day', created_at)::date as day, count(*)::int as n from jobs where owner_id = ${u} and created_at > now() - interval '14 days' group by 1 order by 1`;
    return {
      stats, activity, credits: await balance(u), quota: { used: await yt.quotaToday(), limit: yt.QUOTA_PER_DAY },
      projects: (await P.list(req.user)).slice(0, 8),
      jobs: await sql`select j.id, j.kind, j.status, j.progress, j.message, j.created_at, p.title from jobs j left join projects p on p.id = j.project_id where j.owner_id = ${u} order by j.id desc limit 12`,
      radar: await sql`select s.id, s.kind, s.filters, s.created_at, (select count(*)::int from radar_items i where i.search_id = s.id and cardinality(i.categories) > 0) as hits from radar_searches s where owner_id = ${u} order by created_at desc limit 6`,
    };
  });
  app.get('/api/trabajos', async (req) => sql`select * from jobs where owner_id = ${req.user.id} order by id desc limit 100`);
  app.post('/api/trabajos/:id/reintentar', async (req) => {
    const [j] = await sql`select * from jobs where id = ${req.params.id} and owner_id = ${req.user.id} and status = 'error'`;
    if (!j) throw new AppError(404, 'Trabajo no encontrado o no fallido');
    return enqueue(j.kind, j.payload, { ownerId: j.owner_id, projectId: j.project_id });
  });

  // ---------------------------------------------------------------- estilos y plantillas
  app.get('/api/estilos', async (req) => styles.listStyles(req.user.id));
  app.post('/api/estilos', async (req) => {
    const b = req.body || {};
    if (!b.name || !b.description || !b.base) throw new AppError(400, 'Nombre, descripción y estilo base son obligatorios.');
    return styles.createStyle(req.user.id, b);
  });
  app.post('/api/estilos/:id/muestra', async (req) => {
    const s = await styles.getStyle(req.params.id);
    if (!s || (!s.builtin && s.owner_id !== req.user.id)) throw new AppError(404, 'Estilo no encontrado');
    if (s.builtin) admin(req);
    const { charge } = await import('./core/credits.js');
    const ch = await charge(req.user.id, 'imagen.generar', 1, { styleSample: s.id });
    try {
      const img = await gemini.image({ aspect: '16:9', prompt: `A representative example scene for the visual style "${s.name}": an original character in an evocative setting. ${styles.stylePrompt(s)}` });
      const key = `estilos/${s.id}-${Date.now()}.png`;
      const raw = scratch(`${key}.raw`); fs.writeFileSync(raw, img.buffer);
      const { ffmpeg } = await import('./services/ffmpeg.js');
      await ffmpeg(['-i', raw, '-vf', 'scale=640:-2', scratch(key)]); fs.rmSync(raw, { force: true });
      await put(key, scratch(key), 'image/png');
      await sql`update styles set sample_path = ${key} where id = ${s.id}`;
      return { sample_path: key };
    } catch (e) { await ch.refund(e.message); throw e; }
  });
  app.get('/api/plantillas', async () => TEMPLATES);

  // ---------------------------------------------------------------- proyectos
  app.get('/api/proyectos', async (req) => P.list(req.user));
  app.post('/api/proyectos', async (req) => P.create(req.user, req.body || {}));
  app.get('/api/proyectos/:id', async (req) => P.full(req.user, req.params.id));
  app.patch('/api/proyectos/:id', async (req) => P.update(req.user, req.params.id, req.body || {}));
  app.delete('/api/proyectos/:id', async (req) => { await P.own(req.user, req.params.id); await sql`delete from projects where id = ${req.params.id}`; return { ok: true }; });
  app.post('/api/proyectos/:id/guion', async (req) => P.generateScript(req.user, req.params.id, req.body || {}));
  app.post('/api/proyectos/:id/mejorar-idea', async (req) => P.improveIdea(req.user, req.params.id, req.body?.idea));
  app.post('/api/proyectos/:id/dividir', async (req) => P.requestSplit(req.user, req.params.id));
  app.post('/api/proyectos/:id/audio', async (req) => P.attachAudio(req.user, req.params.id, await file(req)));
  app.get('/api/proyectos/:id/estimacion', async (req) => { const p = await P.own(req.user, req.params.id); const [{ n }] = await sql`select count(*)::int as n from scenes where project_id = ${p.id}`; return P.estimate(p, req.query.recalcular ? null : n || null); });
  // reparto
  app.post('/api/proyectos/:id/reparto', async (req) => P.saveCharacter(req.user, req.params.id, req.body || {}));
  app.delete('/api/proyectos/:id/reparto/:cid', async (req) => { await P.deleteCharacter(req.user, req.params.id, req.params.cid); return { ok: true }; });
  app.post('/api/proyectos/:id/reparto/:cid/generar', async (req) => V.generateReference(req.user, req.params.id, req.params.cid));
  app.post('/api/proyectos/:id/reparto/:cid/subir', async (req) => V.uploadReference(req.user, req.params.id, req.params.cid, (await file(req)).buffer));
  app.post('/api/proyectos/:id/reparto/:cid/ampliar', async (req) => V.upscaleReference(req.user, req.params.id, req.params.cid));
  // escenas
  app.patch('/api/proyectos/:id/escenas/:sid', async (req) => P.updateScene(req.user, req.params.id, req.params.sid, req.body || {}));
  app.delete('/api/proyectos/:id/escenas/:sid', async (req) => { await P.deleteScene(req.user, req.params.id, req.params.sid); return { ok: true }; });
  app.post('/api/proyectos/:id/escenas/orden', async (req) => { await P.reorder(req.user, req.params.id, req.body?.ids || []); return { ok: true }; });
  app.post('/api/proyectos/:id/escenas/:sid/imagen', async (req) => V.uploadSceneImage(req.user, req.params.id, req.params.sid, (await file(req)).buffer));
  app.post('/api/proyectos/:id/flow', async (req) => V.flowPrompts(req.user, req.params.id, req.body || {}));
  app.post('/api/proyectos/:id/imagenes', async (req) => ({ queued: await V.requestImages(req.user, req.params.id, req.body?.sceneIds || null) }));
  app.post('/api/proyectos/:id/animar', async (req) => ({ queued: await V.requestAnimation(req.user, req.params.id, req.body?.sceneIds || [], req.body?.mode) }));
  app.post('/api/proyectos/:id/voz', async (req) => VO.requestVoice(req.user, req.params.id, req.body?.sceneIds || null));
  app.post('/api/proyectos/:id/producir', async (req) => PR.requestProduce(req.user, req.params.id, req.body || {}));
  app.post('/api/proyectos/:id/render', async (req) => R.requestRender(req.user, req.params.id, req.body || {}));
  app.get('/api/proyectos/:id/subtitulos/auto', async (req) => {
    const p = await P.own(req.user, req.params.id);
    const scenes = await sql`select * from scenes where project_id = ${p.id} order by idx`;
    return { cues: S.autoCues(R.timeline(scenes, p), Number(req.query.maxWords) || p.subtitles?.style?.maxWords || 6) };
  });
  app.get('/api/proyectos/:id/linea-tiempo', async (req) => { const p = await P.own(req.user, req.params.id); const scenes = await sql`select * from scenes where project_id = ${p.id} order by idx`; return R.timeline(scenes, p); });
  app.get('/api/subtitulos/opciones', async () => ({ fonts: S.availableFonts(), presets: S.PRESETS, animations: S.ANIMATIONS, defaults: S.DEFAULT_STYLE }));
  app.get('/api/opciones-edicion', async () => ({ transitions: P.TRANSITIONS, exports: Object.keys(R.EXPORT_PRESETS), rhythms: P.RHYTHMS }));

  // ---------------------------------------------------------------- voces y música
  app.get('/api/voces', async () => VO.catalog());
  app.post('/api/voces/previa', async (req) => ({ key: await VO.preview(req.user, req.body || {}) }));
  app.get('/api/musica', async (req) => M.listTracks(req.user.id));
  app.post('/api/musica', async (req) => { const f = await file(req); return M.uploadTrack(req.user.id, { filename: f.filename, buffer: f.buffer, ...f.fields }); });
  app.delete('/api/musica/:id', async (req) => { await sql`delete from music_tracks where id = ${req.params.id} and owner_id = ${req.user.id}`; return { ok: true }; });

  // ---------------------------------------------------------------- YouTube: análisis y radares
  app.get('/api/radar/opciones', async () => ({ languages: RD.LANGUAGES, niches: RD.NICHES, periods: Object.keys(RD.PERIODS), categories: CATEGORY_LABELS, monetization: GROUP_LABELS, thresholds: { ...DEFAULT_THRESHOLDS, ...((await getSetting('thresholds')) || {}) }, quota: { used: await yt.quotaToday(), limit: yt.QUOTA_PER_DAY } }));
  app.post('/api/radar/viral', async (req) => RD.viralRadar(req.user, { ...(req.body || {}), thresholds: { ...((await getSetting('thresholds')) || {}), ...(req.body?.thresholds || {}) } }));
  app.post('/api/radar/canales', async (req) => RD.channelRadar(req.user, req.body || {}));
  app.get('/api/radar/busquedas', async (req) => RD.history(req.user, req.query.kind));
  app.get('/api/radar/busquedas/:id', async (req) => RD.getSearch(req.user, req.params.id));
  app.post('/api/radar/busquedas/:id/actualizar', async (req) => RD.refreshSearch(req.user, req.params.id));
  app.post('/api/radar/hueco-espanol', async (req) => RD.spanishGap(String(req.body?.q || '')));
  app.post('/api/canales/analizar', async (req) => RD.analyzeChannel(req.user, req.body?.ref));
  app.post('/api/canales/:id/evidencia', async (req) => { await RD.addEvidence(req.user, req.params.id, req.body?.sourceUrl, req.body?.note); return { ok: true }; });
  app.post('/api/oportunidad', async (req) => createInspired(req.user, req.body || {}));
  // investigación semanal
  app.get('/api/semanal', async (req) => WK.listResearch(req.user));
  app.post('/api/semanal', async (req) => WK.saveResearch(req.user, req.body || {}));
  app.delete('/api/semanal/:id', async (req) => { await sql`delete from weekly_research where id = ${req.params.id} and owner_id = ${req.user.id}`; return { ok: true }; });
  app.post('/api/semanal/:id/ejecutar', async (req) => WK.runNow(req.user, req.params.id));
  app.get('/api/semanal/:id/informes', async (req) => WK.listReports(req.user, req.params.id));

  // ---------------------------------------------------------------- archivos (con control de acceso)
  app.get('/api/archivo', async (req, reply) => {
    const key = String(req.query.key || '');
    if (!key || key.includes('..')) throw new AppError(400, 'Clave no válida');
    const m = /^proyectos\/([0-9a-f-]{36})\//.exec(key);
    if (m) await P.own(req.user, m[1]);
    else if (key.startsWith('usuarios/') && !key.startsWith(`usuarios/${req.user.id}/`)) throw new AppError(403, 'Sin acceso');
    else if (!/^(usuarios|biblioteca|estilos)\//.test(key)) throw new AppError(403, 'Sin acceso');
    const f = await localPath(key);
    const size = fs.statSync(f).size;
    const type = MIME[path.extname(f).toLowerCase()] || 'application/octet-stream';
    reply.header('content-type', type).header('accept-ranges', 'bytes').header('cache-control', 'private, max-age=3600');
    if (req.query.descargar) reply.header('content-disposition', `attachment; filename="${path.basename(f)}"`);
    const r = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
    if (r) {
      const start = r[1] ? Number(r[1]) : size - Number(r[2]);
      const end = r[1] && r[2] ? Math.min(Number(r[2]), size - 1) : size - 1;
      reply.code(206).header('content-range', `bytes ${start}-${end}/${size}`).header('content-length', end - start + 1);
      return reply.send(fs.createReadStream(f, { start, end }));
    }
    reply.header('content-length', size);
    return reply.send(fs.createReadStream(f));
  });

  // ---------------------------------------------------------------- eventos en vivo
  app.get('/api/eventos', (req, reply) => {
    reply.raw.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
    reply.raw.write('retry: 3000\n\n');
    const on = (e) => { if (e.ownerId === req.user.id) reply.raw.write(`data: ${JSON.stringify(e)}\n\n`); };
    events.on('e', on);
    const ping = setInterval(() => reply.raw.write(': ping\n\n'), 25000);
    req.raw.on('close', () => { events.off('e', on); clearInterval(ping); });
  });

  // ---------------------------------------------------------------- interfaz compilada
  const dist = path.join(ROOT, 'web', 'dist');
  if (fs.existsSync(dist)) {
    await app.register(fstatic, { root: dist, prefix: '/' });
    app.setNotFoundHandler((req, reply) => (req.url.startsWith('/api/') ? reply.code(404).send({ error: 'Ruta no encontrada' }) : reply.sendFile('index.html')));
  }
  return app;
}
