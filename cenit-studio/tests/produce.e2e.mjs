// «Terminar vídeo»: con las imágenes hechas, un botón genera voz, subtítulos y música y exporta el MP4.
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import { execFileSync } from 'node:child_process'; import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
import { startFakes } from './fakes.js';
const fakes = await startFakes();
execFileSync('psql', ['-h', '127.0.0.1', '-U', 'postgres', '-qc', 'drop database if exists cenit_prod', '-c', 'create database cenit_prod'], { env: { ...process.env, PGPASSWORD: 'postgres' } });
Object.assign(process.env, fakes.env, { DATABASE_URL: 'postgres://postgres:postgres@127.0.0.1:5432/cenit_prod', LOCAL_JWT_SECRET: 'p', STORAGE_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'cenit-prod-')), SUPABASE_URL: '' });
await (await import('../server/db/migrate.js')).migrate();
for (const m of ['projects', 'visuals', 'voices', 'render', 'produce']) await import(`../server/modules/${m}.js`);
const { sql, closeDb } = await import('../server/db/index.js');
const { startWorker } = await import('../server/core/jobs.js');
const app = await (await import('../server/app.js')).buildApp(); await app.listen({ port: 0, host: '127.0.0.1' }); await startWorker();
const B = `http://127.0.0.1:${app.server.address().port}`;
const j = async (p, o = {}) => (await fetch(B + p, { ...o, headers: { 'content-type': 'application/json', ...(o.headers || {}) } })).json();
const { token } = await j('/api/auth/register', { method: 'POST', body: JSON.stringify({ email: 'p@e.com', password: 'secreto123' }) });
const [st] = await sql`select id from styles limit 1`;
const p = await j('/api/proyectos', { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: JSON.stringify({ mode: 'idea', idea: 'faros', format: '16:9', style_id: st.id }) });
const img = path.join(os.tmpdir(), 'prod.png');
for (let i = 1; i <= 3; i++) {
  execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'lavfi', '-i', `color=c=0x${(0x335577 * i).toString(16).slice(-6)}:s=1280x720`, '-frames:v', '1', img]);
  const [s] = await sql`insert into scenes(project_id, idx, narration, visual, image_prompt) values (${p.id}, ${i}, ${`El viejo farero subió la escalera número ${i} mientras la tormenta golpeaba el cristal.`}, 'faro', 'lighthouse') returning id`;
  const fd = new FormData(); fd.append('file', new Blob([fs.readFileSync(img)], { type: 'image/png' }), 'i.png');
  await fetch(`${B}/api/proyectos/${p.id}/escenas/${s.id}/imagen`, { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: fd });
}
const browser = await chromium.launch(); const page = await browser.newPage({ viewport: { width: 1300, height: 900 }, deviceScaleFactor: 2 });
const errs = []; page.on('pageerror', (e) => errs.push(e.message));
await page.goto(B); await page.evaluate((t) => localStorage.setItem('cenit.token', t), token);
await page.goto(`${B}/proyectos/${p.id}`);
await page.getByRole('button', { name: '▶ Terminar vídeo' }).scrollIntoViewIfNeeded();
await page.screenshot({ path: (process.env.SHOT || '/tmp/prod.png').replace('.png', '-boton.png') });
await page.getByRole('button', { name: '▶ Terminar vídeo' }).click();
const tabs = new Set();
const t0 = Date.now();
while (Date.now() - t0 < 240000) {
  const on = await page.locator('.tabs button.on').textContent().catch(() => ''); if (on) tabs.add(on);
  if (await page.getByRole('link', { name: '⬇ Descargar MP4' }).first().isVisible().catch(() => false)) break;
  await new Promise((r) => setTimeout(r, 400));
}
const [pp] = await sql`select export_path, voice, music, subtitles from projects where id = ${p.id}`;
const info = pp.export_path ? JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type,width,height:format=duration', '-of', 'json', path.join(process.env.STORAGE_DIR, pp.export_path)]).toString()) : null;
await page.evaluate(() => window.scrollTo(0, 0)); await page.screenshot({ path: process.env.SHOT || path.join(os.tmpdir(), 'prod.png') });
console.log('pestañas recorridas:', [...tabs].join(' → '));
console.log('voz:', pp.voice?.provider, pp.voice?.voiceId, '| música:', !!pp.music?.trackId, '| subtítulos:', pp.subtitles?.enabled);
console.log('MP4:', info ? `${info.streams.map((s) => s.codec_type + (s.width ? ` ${s.width}x${s.height}` : '')).join(', ')} · ${Number(info.format.duration).toFixed(1)} s` : 'no');
console.log('errores:', errs.length ? errs : 'ninguno');
const ok = info && info.streams.some((s) => s.codec_type === 'audio') && info.streams.some((s) => s.width === 1920) && !errs.length && tabs.has('Edición');
await browser.close(); await app.close(); await closeDb(); fakes.server.close();
console.log(ok ? 'OK' : 'FALLO'); process.exit(ok ? 0 : 1);
