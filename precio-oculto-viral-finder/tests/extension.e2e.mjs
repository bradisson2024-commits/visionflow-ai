// E2E de la extensión «EPO · Conector Flow» cargada de verdad en Chromium.
// Google Flow necesita cuenta: la extensión trabaja contra tests/flow-fixture.html (página de pruebas, NO es Flow).
// Sólo en una copia temporal de la extensión se añade la URL de esa página. Servicios externos: doble de pruebas.
// Ejecutar: npm run test:extension
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { startFakes } from './fake-services.js';

const { chromium } = createRequire(import.meta.url)('playwright');

const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ok = (m) => console.log('✓', m);

const fakes = await startFakes();
Object.assign(process.env, fakes.env, { EPO_DATA_DIR: tmp('epo-e2e-'), IMAGE_ENGINE: 'flow' });
const { openDb } = await import('../server/db/index.js');
const jobs = await import('../server/core/jobs.js');
await import('../server/modules/production.js');
const { createServer } = await import('../server/app.js');
openDb(); jobs.startWorker();
const app = createServer().listen(0, '127.0.0.1');
await new Promise((r) => app.once('listening', r));
const APP = `http://127.0.0.1:${app.address().port}`;
const api = async (p, o = {}) => { const r = await fetch(APP + p, { ...o, headers: { 'content-type': 'application/json' } }); const j = await r.json(); if (!r.ok) throw new Error(j.error); return j; };

const fixture = fs.readFileSync(new URL('./flow-fixture.html', import.meta.url));
const fix = http.createServer((q, s) => { s.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); s.end(fixture); }).listen(0, '127.0.0.1');
await new Promise((r) => fix.once('listening', r));
const FIX = `http://127.0.0.1:${fix.address().port}/fixture/`;

// copia de la extensión con la página de pruebas añadida
const ext = tmp('epo-ext-');
fs.cpSync(new URL('../extension', import.meta.url), ext, { recursive: true });
const man = JSON.parse(fs.readFileSync(path.join(ext, 'manifest.json')));
man.content_scripts[0].matches.push('http://127.0.0.1/fixture/*');
fs.writeFileSync(path.join(ext, 'manifest.json'), JSON.stringify(man));
fs.writeFileSync(path.join(ext, 'panel.js'), fs.readFileSync(path.join(ext, 'panel.js'), 'utf8').replace("const FLOW_URLS = ['https://flow.google.com/*', 'https://labs.google/fx/*'];", "const FLOW_URLS = ['https://flow.google.com/*', 'https://labs.google/fx/*', 'http://127.0.0.1/fixture/*'];"));

const chrome = spawn(chromium.executablePath(), ['--headless=new', '--no-sandbox', '--no-first-run', '--disable-features=DisableLoadExtensionCommandLineSwitch', `--user-data-dir=${tmp('epo-prof-')}`,
  '--remote-debugging-port=9341', `--disable-extensions-except=${ext}`, `--load-extension=${ext}`, 'about:blank'], { stdio: 'ignore' });
let browser;
for (let i = 0; i < 100 && !browser; i++) { try { browser = await chromium.connectOverCDP('http://127.0.0.1:9341'); } catch { await sleep(150); } }
let pass = false;
try {
  const ctx = browser.contexts()[0];
  let sw;
  for (let i = 0; i < 80 && !sw; i++) {
    for (const w of ctx.serviceWorkers()) if ((await w.evaluate(() => chrome.runtime.getManifest().name).catch(() => '')) === 'EPO · Conector Flow') sw = w;
    if (!sw) await sleep(250);
  }
  assert.ok(sw, 'la extensión no cargó');
  const extId = sw.url().split('/')[2];

  // Proyecto real en modo Flow, detenido esperando imágenes
  await api('/api/busquedas', { method: 'POST', body: JSON.stringify({ query: 'negocio del cine' }) });
  const { execFileSync } = await import('node:child_process');
  const png = path.join(process.env.EPO_DATA_DIR, 'ref.png');
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', new URL('../web/img/detective.svg', import.meta.url).pathname, '-vf', 'scale=384:-1', png]);
  await fetch(`${APP}/api/mascota/referencia`, { method: 'POST', body: fs.readFileSync(png) });
  const p = await api('/api/proyectos', { method: 'POST', body: JSON.stringify({ videoId: 'abcdefghijk' }) });
  await jobs.drain();
  const before = await api(`/api/proyectos/${p.id}`);
  assert.equal(before.status, 'necesita_accion');
  const queue = (await api(`/api/flow/proyectos/${p.id}`)).items;
  ok(`Proyecto en modo Flow esperando ${queue.length} imágenes (${before.scenes.length} escenas + miniatura)`);

  const flow = await ctx.newPage();
  await flow.goto(FIX);
  const panel = await ctx.newPage();
  const errors = [];
  panel.on('pageerror', (e) => errors.push(e.message));
  await panel.goto(`chrome-extension://${extId}/panel.html`);
  await panel.fill('#appUrl', APP);
  await panel.dispatchEvent('#appUrl', 'change');
  await panel.waitForFunction((id) => [...document.querySelectorAll('#project option')].some((o) => o.value === String(id)), p.id, { timeout: 15000 });
  await panel.selectOption('#project', String(p.id));
  await panel.waitForFunction((n) => document.querySelectorAll('#items li').length === n, queue.length);
  await panel.waitForFunction(() => document.getElementById('sFlow').className === 'dot ok' && document.getElementById('sApp').className === 'dot ok', null, { timeout: 15000 });
  ok('Panel conectado a la app y a la pestaña; cola cargada');

  await panel.locator('#gap').fill('2');
  await panel.click('#start');
  await panel.waitForFunction((n) => document.getElementById('summary').textContent.startsWith(`${n} de ${n}`), queue.length, { timeout: 240000 });
  const seen = await flow.evaluate(() => window.__seen);
  assert.deepEqual(seen, queue.map((q) => q.prompt), 'la página recibe exactamente los prompts del proyecto, en orden');
  assert.equal(await flow.evaluate(() => window.__refs), 1, 'mascota adjuntada como referencia');
  assert.equal((await api(`/api/flow/proyectos/${p.id}`)).items.length, 0);
  ok(`${queue.length} imágenes generadas en la página y devueltas a su escena; mascota adjuntada`);

  await api(`/api/proyectos/${p.id}/producir`, { method: 'POST', body: '{}' });
  await jobs.drain();
  const after = await api(`/api/proyectos/${p.id}`);
  assert.equal(after.status, 'terminado', JSON.stringify(after.stages.filter((s) => s.state !== 'hecho')));
  ok('Producción completada: MP4 exportado y verificado con imágenes llegadas desde la extensión');

  // Un bloqueo (CAPTCHA) detiene la cola y lo explica
  await api(`/api/proyectos/${p.id}/escenas/1/rehacer`, { method: 'POST', body: JSON.stringify({ instruccion: 'CAPTCHA' }) });
  await flow.reload();
  await panel.click('#reload'); await sleep(800);
  await panel.selectOption('#project', String(p.id));
  await panel.waitForFunction(() => document.querySelectorAll('#items li').length === 1);
  await panel.click('#start');
  await panel.waitForFunction(() => /CAPTCHA/.test(document.getElementById('hint').textContent), null, { timeout: 60000 });
  ok('CAPTCHA detectado: la extensión se detiene y pide intervención humana');
  assert.deepEqual(errors, []);
  pass = true;
  console.log('\nE2E de la extensión: OK');
} catch (e) {
  console.error('FALLO:', e.stack || e.message);
} finally {
  await browser?.close().catch(() => {});
  chrome.kill(); app.close(); fix.close(); fakes.server.close();
  process.exit(pass ? 0 : 1);
}
