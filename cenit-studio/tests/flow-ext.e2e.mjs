// Prueba de la extensión «Cenit · Flow» con Chromium real, la app real y una página que imita a Google Flow
// (Google Flow real necesita una cuenta: aquí se sustituye por un doble servido en flow.google.com mediante enrutado).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
import { startFakes } from './fakes.js';

const fakes = await startFakes();
execFileSync('psql', ['-h', '127.0.0.1', '-U', 'postgres', '-qc', 'drop database if exists cenit_flow', '-c', 'create database cenit_flow'], { env: { ...process.env, PGPASSWORD: 'postgres' } });
Object.assign(process.env, fakes.env, { DATABASE_URL: 'postgres://postgres:postgres@127.0.0.1:5432/cenit_flow', LOCAL_JWT_SECRET: 'flow-e2e', STORAGE_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'cenit-flow-')), SUPABASE_URL: '' });
const { migrate } = await import('../server/db/migrate.js');
await migrate();
for (const m of ['projects', 'visuals']) await import(`../server/modules/${m}.js`);
const { sql, closeDb } = await import('../server/db/index.js');
const { buildApp } = await import('../server/app.js');
const app = await buildApp();
await app.listen({ port: 0, host: '127.0.0.1' });
const BASE = `http://localhost:${app.server.address().port}`;
const j = async (p, o = {}) => { const r = await fetch(BASE + p, { ...o, headers: { 'content-type': 'application/json', ...(o.headers || {}) } }); return r.json(); };

const { token } = await j('/api/auth/register', { method: 'POST', body: JSON.stringify({ email: 'flow@ejemplo.com', password: 'secreto123' }) });
const auth = { authorization: `Bearer ${token}` };
const [style] = await sql`select id from styles limit 1`;
const p = await j('/api/proyectos', { method: 'POST', headers: auth, body: JSON.stringify({ mode: 'idea', idea: 'faros abandonados', format: '9:16', style_id: style.id }) });
for (let i = 1; i <= 3; i++) await sql`insert into scenes(project_id, idx, narration, visual, image_prompt) values (${p.id}, ${i}, ${`El farero sube la escalera ${i}`}, 'faro', 'lighthouse keeper climbing stairs')`;
const [ch] = await sql`insert into characters(project_id, name, kind, description, confirmed) values (${p.id}, 'Farero', 'personaje', 'stickman con impermeable amarillo', true) returning id`;

// Página doble de Google Flow: cuadro de prompt + botón; al generar añade una imagen nueva servida desde su origen.
let n = 0;
const flowHtml = `<!doctype html><html><body style="background:#111;color:#eee"><input placeholder="Search" style="width:700px;height:40px">
<div style="position:fixed;bottom:20px;left:40px;width:800px"><div style="position:relative"><div class="ph" style="position:absolute;opacity:.5;pointer-events:none">What do you want to create?</div>
<div contenteditable="true" style="min-height:24px"></div></div><button aria-label="Create"><i>arrow_forward</i></button></div><div id="out"></div><script>
let k = 0; window.prompts = [];
const ed = document.querySelector('[contenteditable]');
ed.addEventListener('input', () => { document.querySelector('.ph').style.display = ed.innerText.trim() ? 'none' : ''; });
document.querySelector('button').onclick = () => { const t = ed.innerText.trim(); if (!t) return; window.prompts.push(t); ed.innerText = '';
  setTimeout(() => { const i = document.createElement('img'); i.src = '/fx/media/' + (++k) + '.png'; document.getElementById('out').prepend(i); }, 1200); };
</script></body></html>`;
const ext = path.resolve('extension-flow');
const ctx = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), 'cenit-prof-')), { channel: 'chromium', headless: true, args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`] });
await ctx.route('https://flow.google.com/**', async (route) => {
  const u = new URL(route.request().url());
  if (u.pathname.startsWith('/fx/media/')) {
    const f = path.join(os.tmpdir(), `flow-img-${++n}.png`);
    execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'lavfi', '-i', `color=c=0x${(0x224488 + n * 0x113355).toString(16).slice(-6)}:s=768x1344`, '-frames:v', '1', f]);
    return route.fulfill({ contentType: 'image/png', body: fs.readFileSync(f) });
  }
  return route.fulfill({ contentType: 'text/html', body: flowHtml });
});
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(BASE);
await page.evaluate((t) => localStorage.setItem('cenit.token', t), token);
await page.goto(`${BASE}/proyectos/${p.id}`);
await page.waitForFunction(() => document.documentElement.dataset.cenitFlow === '1', null, { timeout: 15000 });
await page.getByRole('button', { name: 'Todas en Flow' }).click();
const deadline = Date.now() + 90000;
let done = 0;
while (Date.now() < deadline) {
  [{ done }] = await sql`select count(*)::int as done from scenes where project_id = ${p.id} and image_status = 'lista'`;
  if (done === 3) break;
  await new Promise((r) => setTimeout(r, 1000));
}
console.log('escenas con imagen de Flow:', done, '/ 3');
await page.bringToFront();
await page.getByRole('button', { name: 'Flow', exact: true }).first().click(); // primer botón Flow = personaje
let ref = null;
for (let i = 0; i < 40 && !ref; i++) { [{ ref_path: ref }] = await sql`select ref_path from characters where id = ${ch.id}`; await new Promise((r) => setTimeout(r, 1000)); }
console.log('referencia del personaje:', ref ? 'sí' : 'no');
const flowPage = ctx.pages().find((x) => x.url().startsWith('https://flow.google.com'));
const prompts = flowPage ? await flowPage.evaluate(() => window.prompts) : [];
console.log('prompts recibidos por Flow:', prompts.length, '\n  ej.:', (prompts[0] || '').slice(0, 160));
const [img] = await sql`select image_path from scenes where project_id = ${p.id} and idx = 1`;
console.log('tamaño de la imagen guardada:', execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', path.join(process.env.STORAGE_DIR, img.image_path)]).toString().trim());
await page.screenshot({ path: process.env.SHOT || path.join(os.tmpdir(), 'flow.png'), fullPage: false });
console.log('errores de página:', errors.length ? errors : 'ninguno');
const ok = done === 3 && ref && prompts.length === 4 && !errors.length;
await ctx.close(); await app.close(); await closeDb(); fakes.server.close();
console.log(ok ? 'OK' : 'FALLO');
process.exit(ok ? 0 : 1);
