// Prueba de la extensión «Cenit · Flow» 2.0 con Chromium real, la app real y dos dobles «difíciles» de Google Flow
// (el Flow real necesita una cuenta). Los dobles sólo aceptan teclado y ratón reales (isTrusted), esconden el editor
// en un shadow DOM y prohíben descargar la imagen ya mostrada (obliga a capturarla). El segundo doble no tiene nada
// reconocible: la extensión debe pedir los clics de calibración (los hace la prueba como un usuario).
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
const j = async (p, o = {}) => (await fetch(BASE + p, { ...o, headers: { 'content-type': 'application/json', ...(o.headers || {}) } })).json();
const { token } = await j('/api/auth/register', { method: 'POST', body: JSON.stringify({ email: 'flow@ejemplo.com', password: 'secreto123' }) });
const auth = { authorization: `Bearer ${token}` };
const [style] = await sql`select id from styles limit 1`;
async function project() {
  const p = await j('/api/proyectos', { method: 'POST', headers: auth, body: JSON.stringify({ mode: 'idea', idea: 'faros', format: '9:16', style_id: style.id }) });
  for (let i = 1; i <= 3; i++) await sql`insert into scenes(project_id, idx, narration, visual, image_prompt) values (${p.id}, ${i}, ${`El farero sube ${i}`}, 'faro', ${`lighthouse keeper climbing stairs number ${i}`})`;
  return p;
}

// --- dobles de Google Flow
const common = `let k = 0; window.prompts = []; window.untrusted = 0;
function generate(t) { if (!t.trim()) return; window.prompts.push(t.trim()); ed().textContent = '';
  const bar = document.createElement('div'); bar.setAttribute('role', 'progressbar'); bar.style.cssText = 'width:200px;height:6px;background:#4af'; document.getElementById('out').prepend(bar);
  setTimeout(() => { bar.remove(); const i = document.createElement('img'); i.src = '/fx/media/' + (++k) + '.png'; i.style.width = '240px'; document.getElementById('out').prepend(i); }, 1500); }`;
const flowA = `<!doctype html><html><body style="background:#111;color:#eee;margin:0"><input placeholder="Search" style="width:700px;height:40px"><div id="out"></div>
<iframe src="https://www.google.com/recaptcha/enterprise/anchor?k=x" title="reCAPTCHA" style="width:256px;height:60px;position:fixed;bottom:-200px;right:0"></iframe><prompt-bar style="position:fixed;bottom:20px;left:40px;width:800px;display:block"></prompt-bar><script>
customElements.define('prompt-bar', class extends HTMLElement { connectedCallback() { const r = this.attachShadow({ mode: 'open' });
  r.innerHTML = '<div><div class="ph" style="position:absolute;opacity:.5;pointer-events:none">¿Qué quieres crear?</div><div contenteditable style="min-height:24px;padding:4px"></div></div><button aria-label="Crear"><i>arrow_forward</i></button>'; } });
const ed = () => document.querySelector('prompt-bar').shadowRoot.querySelector('[contenteditable]');
${common}
setTimeout(() => {
  ed().addEventListener('beforeinput', (e) => { if (!e.isTrusted) { e.preventDefault(); window.untrusted++; } });
  ed().addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.isTrusted) { e.preventDefault(); generate(ed().textContent); } });
  document.querySelector('prompt-bar').shadowRoot.querySelector('button').addEventListener('click', (e) => { if (!e.isTrusted) { window.untrusted++; return; } generate(ed().textContent); });
}, 50);
</script></body></html>`;
// Doble B: sin texto de ayuda, editor que sólo se vuelve editable al pulsarlo, botón sin texto y Enter ignorado.
const flowB = `<!doctype html><html><body style="background:#111;color:#eee;margin:0"><div id="out"></div>
<div style="position:fixed;bottom:20px;left:40px;width:800px"><div id="box" style="min-height:30px;border:1px solid #555;padding:4px"></div><span id="go" style="display:inline-block;width:30px;height:30px;background:#4a8;cursor:pointer"></span></div><script>
const ed = () => document.getElementById('box');
${common}
ed().addEventListener('mousedown', (e) => { if (e.isTrusted) ed().contentEditable = 'true'; });
ed().addEventListener('beforeinput', (e) => { if (!e.isTrusted) { e.preventDefault(); window.untrusted++; } });
document.getElementById('go').addEventListener('click', (e) => { if (e.isTrusted) generate(ed().textContent); });
</script></body></html>`;

const ext = path.resolve('extension-flow');
const ctx = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), 'cenit-prof-')), { channel: 'chromium', headless: true, viewport: { width: 1280, height: 860 }, args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`] });
let flowHtml = flowA;
const served = new Map();
let fid = 0;
await ctx.route('https://flow.google.com/**', async (route) => {
  const u = new URL(route.request().url());
  if (u.pathname.startsWith('/fx/media/')) {
    const n = (served.get(u.pathname) || 0) + 1;
    served.set(u.pathname, n);
    if (n > 1) return route.fulfill({ status: 403, body: 'prohibido' }); // sólo se puede mostrar, no volver a descargar
    const f = path.join(os.tmpdir(), `flow-img-${++fid}.png`);
    execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'lavfi', '-i', `color=c=0x${(0x224488 + fid * 0x113355).toString(16).slice(-6)}:s=768x1344`, '-vf', 'drawbox=x=100:y=200:w=300:h=300:color=white:t=fill', '-frames:v', '1', f]);
    return route.fulfill({ contentType: 'image/png', body: fs.readFileSync(f) });
  }
  return route.fulfill({ contentType: 'text/html', body: flowHtml });
});
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(BASE);
await page.evaluate((t) => localStorage.setItem('cenit.token', t), token);
const doneCount = async (pid) => (await sql`select count(*)::int as n from scenes where project_id = ${pid} and image_status = 'lista'`)[0].n;
async function waitDone(pid, n, onTick) { const t0 = Date.now(); while (Date.now() - t0 < 120000) { if (await doneCount(pid) === n) return true; await onTick?.(); await new Promise((r) => setTimeout(r, 700)); } return false; }

// ---------- Escenario A: todo automático
const pA = await project();
await page.goto(`${BASE}/proyectos/${pA.id}`);
await page.waitForFunction(() => document.documentElement.dataset.cenitFlow === '1', null, { timeout: 15000 });
await page.getByRole('button', { name: 'Crear todas en Flow (auto)' }).click();
const okA = await waitDone(pA.id, 3);
const fA = ctx.pages().find((x) => x.url().startsWith('https://flow.google.com'));
const infoA = fA ? await fA.evaluate(() => ({ prompts: window.prompts, untrusted: window.untrusted })) : {};
const [img] = await sql`select image_path from scenes where project_id = ${pA.id} and idx = 1`;
const size = img?.image_path ? execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', path.join(process.env.STORAGE_DIR, img.image_path)]).toString().trim() : '-';
console.log(`A · automático: ${await doneCount(pA.id)}/3 escenas · prompts en Flow: ${infoA.prompts?.length} · eventos falsos rechazados: ${infoA.untrusted} · imagen guardada ${size}`);
await fA?.close();

// ---------- Escenario B: hay que enseñarle el cuadro y la flecha (calibración con clics de usuario)
flowHtml = flowB;
served.clear();
await ctx.serviceWorkers()[0]?.evaluate(() => chrome.storage.local.clear());
const pB = await project();
await page.bringToFront();
await page.goto(`${BASE}/proyectos/${pB.id}`);
await page.waitForFunction(() => document.documentElement.dataset.cenitFlow === '1');
await page.getByRole('button', { name: 'Crear todas en Flow (auto)' }).click();
let clicks = 0;
const okB = await waitDone(pB.id, 3, async () => {
  const f = ctx.pages().find((x) => x.url().startsWith('https://flow.google.com'));
  const msg = f ? await f.evaluate(() => document.getElementById('cenit-flow-status')?.textContent || '').catch(() => '') : '';
  if (/Qué quieres crear/.test(msg) && clicks === 0) { await f.click('#box'); clicks++; }
  if (/flecha →/.test(msg) && clicks === 1) { await f.click('#go'); clicks++; }
});
const fB = ctx.pages().find((x) => x.url().startsWith('https://flow.google.com'));
const infoB = fB ? await fB.evaluate(() => ({ prompts: window.prompts })) : {};
console.log(`B · con calibración: ${await doneCount(pB.id)}/3 escenas · clics de usuario: ${clicks} · prompts en Flow: ${infoB.prompts?.length} (sin duplicados: ${new Set(infoB.prompts).size === infoB.prompts?.length})`);
await page.bringToFront();
await page.screenshot({ path: process.env.SHOT || path.join(os.tmpdir(), 'flow.png') });
console.log('errores de página:', errors.length ? errors : 'ninguno');
const ok = okA && okB && clicks === 2 && size === '1080,1920' && infoA.prompts?.length === 3 && infoB.prompts?.length === 3 && !errors.length;
await ctx.close(); await app.close(); await closeDb(); fakes.server.close();
console.log(ok ? 'OK' : 'FALLO');
process.exit(ok ? 0 : 1);
