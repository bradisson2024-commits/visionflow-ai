'use strict';
// E2E del puente Google Flow ↔ El Precio Oculto con la extensión REAL (extension-flow/) cargada en Chromium.
// Google Flow requiere cuenta y no es accesible en pruebas: el motor trabaja contra tests/fixtures/flow-fixture.html
// (fixture que imita la estructura del cuadro de prompts; NO es Flow). Sólo en una COPIA temporal de la extensión
// se añade la URL del fixture. Ejecutar: npm run test:e2e   (usa el puerto 8790: detén la app antes).
const { chromium } = require('playwright');
const { spawn, execFileSync } = require('child_process');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');

const ROOT = path.join(__dirname, '..');
const APP_PORT = 8790; // puerto que usa la extensión
const FIX_PORT = 5991;
const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const step = (m) => console.log('✓', m);

function prepareExtension() {
  const dir = tmp('epo-ext-');
  fs.cpSync(path.join(ROOT, 'extension-flow'), dir, { recursive: true });
  const man = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
  for (const cs of man.content_scripts) cs.matches.push('http://127.0.0.1/fixture/*');
  man.host_permissions.push('http://127.0.0.1/*');
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(man, null, 2));
  fs.appendFileSync(path.join(dir, 'config.js'), "\n// SOLO PRUEBAS\nYA_CONFIG.FLOW_MATCHES.push('http://127.0.0.1/fixture/*');\nYA_CONFIG.GENERATION_TIMEOUT_MS = 20000;\n");
  return dir;
}

async function main() {
  const DATA = tmp('epo-data-');
  // Proyecto con escenas planificadas (datos de prueba).
  const id = execFileSync(process.execPath, ['--input-type=module', '-e', `
    process.env.PROJECTS_DIR = ${JSON.stringify(DATA)};
    const { createProject, saveProject } = await import(${JSON.stringify(path.join(ROOT, 'lib/project.js'))});
    const p = createProject({ title: 'E2E Flow', channelTitle: 'c', url: 'u', thumbnail: '', dataSource: 'fixture' });
    p.script = { title: 'El negocio oculto (E2E)' };
    p.characters = [{ id: 'investigador', name: 'El Investigador', description: 'stick figure with a yellow fedora and red scarf' }];
    p.scenes = [1, 2, 3].map((n) => ({ n, id: 'escena_00' + n, narration: 'Frase ' + n + '.', visual: { description: 'd' + n, prompt: 'stickman scene number ' + n, characters: ['investigador'] }, image: null, review: null }));
    p.thumbnailPrompt = 'surprised stickman';
    saveProject(p);
    console.log(p.id);`]).toString().trim();

  const fixture = fs.readFileSync(path.join(__dirname, 'fixtures/flow-fixture.html'));
  const fix = http.createServer((req, res) => { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(fixture); }).listen(FIX_PORT, '127.0.0.1');
  const app = spawn(process.execPath, [path.join(ROOT, 'server.js')], { env: { ...process.env, PROJECTS_DIR: DATA, PORT: String(APP_PORT) }, stdio: 'ignore' });
  for (let i = 0; i < 60; i++) { try { await fetch(`http://127.0.0.1:${APP_PORT}/api/status`); break; } catch { await sleep(100); } }

  const extDir = prepareExtension();
  const CDP_PORT = 9334;
  const chrome = spawn(process.env.EPO_CHROME || chromium.executablePath(), ['--headless=new', '--no-sandbox', '--no-first-run', '--disable-features=DisableLoadExtensionCommandLineSwitch',
    `--user-data-dir=${tmp('epo-prof-')}`, `--remote-debugging-port=${CDP_PORT}`, `--disable-extensions-except=${extDir}`, `--load-extension=${extDir}`, '--window-size=420,1100', 'about:blank'], { stdio: 'ignore' });
  let browser;
  for (let i = 0; i < 100 && !browser; i++) { try { browser = await chromium.connectOverCDP(`http://127.0.0.1:${CDP_PORT}`); } catch { await sleep(150); } }
  const ctx = browser.contexts()[0];
  let ok = false;
  try {
    let sw = null;
    for (let i = 0; i < 60 && !sw; i++) {
      for (const w of ctx.serviceWorkers()) if ((await w.evaluate(() => chrome.runtime.getManifest().name).catch(() => '')).includes('El Precio Oculto')) sw = w;
      if (!sw) await sleep(250);
    }
    if (!sw) throw new Error('La extensión no se cargó');
    const extId = sw.url().split('/')[2];
    const flow = await ctx.newPage();
    await flow.goto(`http://127.0.0.1:${FIX_PORT}/fixture/flow-fixture.html`);
    const panel = await ctx.newPage();
    const errors = []; panel.on('pageerror', (e) => errors.push(e.message));
    await panel.goto(`chrome-extension://${extId}/sidepanel.html`);
    await panel.waitForFunction(() => document.querySelector('#flowPill .dot').className === 'dot ok', null, { timeout: 15000 });
    await panel.waitForFunction(() => document.querySelector('#appPill .dot').className === 'dot ok', null, { timeout: 15000 });
    await panel.waitForFunction((pid) => [...document.querySelectorAll('#epoProject option')].some((o) => o.value === pid), id, { timeout: 15000 });
    step('Panel conectado a la pestaña (fixture) y a la app El Precio Oculto; proyecto listado');

    // Fase 1: hoja de personajes (escena_000)
    await panel.selectOption('#epoProject', id);
    await panel.click('#epoLoad');
    await panel.waitForFunction(() => /Hoja de personajes/.test(document.getElementById('epoMsg').textContent));
    assert.strictEqual(await panel.inputValue('#project'), id);
    await panel.locator('#delay').fill('0');
    await panel.click('#startBtn');
    await panel.waitForFunction(() => document.getElementById('doneText').textContent.startsWith('1 / 1'), null, { timeout: 60000 });
    assert.ok(fs.existsSync(path.join(DATA, id, 'imagenes', 'personajes.png')), 'personajes.png guardada');
    assert.match(await panel.locator('#scenes li').first().textContent(), /^\s*000/);
    step('Fase 1: Flow genera la hoja de personajes → escena_000 → imagenes/personajes.png');

    // Fase 2: escenas pendientes + miniatura, con la hoja como personaje de referencia
    await flow.reload(); await sleep(800);
    await panel.click('#epoLoad');
    await panel.waitForFunction(() => /4 escenas/.test(document.getElementById('epoMsg').textContent));
    await panel.waitForSelector('#refThumb img');
    assert.strictEqual(await panel.textContent('#refName'), 'personajes.png');
    assert.strictEqual(await panel.textContent('#promptCount'), '4 prompts del proyecto');
    const expected = (await (await fetch(`http://127.0.0.1:${APP_PORT}/api/flow/queue/${id}`)).json()).items.map((i) => i.prompt);
    await panel.click('#startBtn');
    await panel.waitForFunction(() => document.getElementById('doneText').textContent.startsWith('4 / 4'), null, { timeout: 120000 });
    const log = await flow.evaluate(() => window.__log);
    assert.deepStrictEqual(log.prompts, expected, 'Flow recibe exactamente los prompts del proyecto, en orden');
    assert.ok(log.uploads >= 1 && log.attachments >= 1, 'hoja de personajes adjuntada como referencia');
    const nums = (await panel.locator('#scenes li b').allTextContents());
    assert.deepStrictEqual(nums, ['001', '002', '003', '900']);
    for (const f of ['escena_001.png', 'escena_002.png', 'escena_003.png', 'miniatura_base.png']) assert.ok(fs.existsSync(path.join(DATA, id, 'imagenes', f)), f);
    step('Fase 2: escenas 001–003 + miniatura (900) enviadas con su número real y devueltas a su escena; personaje adjuntado');

    // La app incorpora las imágenes: el paso «imágenes» se completa y ya no hay pendientes
    await fetch(`http://127.0.0.1:${APP_PORT}/api/projects/${id}/run`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ only: 'imagenes' }) });
    let p;
    for (let i = 0; i < 50; i++) { p = await (await fetch(`http://127.0.0.1:${APP_PORT}/api/projects/${id}`)).json(); if (!p.running && p.steps.imagenes.state !== 'en_curso') break; await sleep(200); }
    assert.strictEqual(p.steps.imagenes.state, 'completado', p.steps.imagenes.message);
    assert.deepStrictEqual(p.flow.pending, []);
    assert.ok(p.scenes.every((s) => s.image && s.image.provider === 'flow' && s.image.fileHash));
    step(`App: «${p.steps.imagenes.message}»`);

    // Pedir otra imagen para la escena 2 → vuelve a la cola, sólo esa
    const r = await fetch(`http://127.0.0.1:${APP_PORT}/api/projects/${id}/scenes/2/regenerate-image`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ description: 'el investigador señala un mapa' }) });
    assert.strictEqual(r.status, 200);
    await flow.reload(); await sleep(800);
    await panel.click('#epoRefresh'); await sleep(500);
    await panel.selectOption('#epoProject', id);
    await panel.click('#epoLoad');
    await panel.waitForFunction(() => /1 escenas/.test(document.getElementById('epoMsg').textContent));
    await panel.click('#startBtn');
    await panel.waitForFunction(() => document.getElementById('doneText').textContent.startsWith('1 / 1'), null, { timeout: 60000 });
    assert.match(await panel.locator('#scenes li b').first().textContent(), /002/);
    const q = await (await fetch(`http://127.0.0.1:${APP_PORT}/api/flow/queue/${id}`)).json();
    assert.strictEqual(q.items.length, 0);
    step('«Pedir otra a Flow» en la escena 2 → sólo esa vuelve a la cola y se reemplaza');
    assert.deepStrictEqual(errors, []);
    ok = true;
    console.log('\nE2E puente Google Flow OK');
  } catch (e) {
    console.error('FALLO:', e.stack || e.message);
  } finally {
    await browser?.close().catch(() => {}); chrome.kill(); app.kill(); fix.close();
    process.exitCode = ok ? 0 : 1;
  }
}
main();
