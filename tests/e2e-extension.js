'use strict';
// Prueba de extremo a extremo de RaulitoShow IA: la extensión REAL cargada en Chromium.
// Como Google Flow requiere cuenta y no es accesible desde el entorno de pruebas, el motor se
// ejercita contra tests/fixtures/flow-fixture.html (fixture de pruebas, NO es Flow). Para ello se
// copia la extensión a una carpeta temporal y SOLO en esa copia se añade la URL del fixture.
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { makeMedia, tmpDir } = require('./helpers');

const APP_PORT = 5317; // puerto fijo de la app usado por la extensión
const FIX_PORT = 5990;
const SHOTS = process.env.YA_SHOTS || tmpDir('ya-shots-');
const step = m => console.log('✓', m);
const sleep = ms => new Promise(r => setTimeout(r, ms));

function prepareExtension() {
  const dir = tmpDir('ya-ext-');
  fs.cpSync(path.join(__dirname, '../extension'), dir, { recursive: true });
  const man = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
  for (const cs of man.content_scripts) cs.matches.push('http://127.0.0.1/fixture/*');
  man.host_permissions.push('http://127.0.0.1/*');
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(man, null, 2));
  fs.appendFileSync(path.join(dir, 'config.js'), `\n// SOLO PRUEBAS\nYA_CONFIG.FLOW_MATCHES.push('http://127.0.0.1/fixture/*');\nYA_CONFIG.GENERATION_TIMEOUT_MS = 20000;\n`);
  return dir;
}

let fixtureImg = null;
// Extensión de pruebas que, como algunos "descargadores de imágenes", renombra TODAS las descargas.
function prepareRenamer() {
  const dir = tmpDir('ya-renamer-');
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ manifest_version: 3, name: 'Renombrador de pruebas', version: '1.0', permissions: ['downloads'], background: { service_worker: 'bg.js' } }));
  fs.writeFileSync(path.join(dir, 'bg.js'), "chrome.downloads.onDeterminingFilename.addListener((item, suggest) => suggest({ filename: crypto.randomUUID() + '.png' }));");
  return dir;
}

function fixtureServer() {
  const html = fs.readFileSync(path.join(__dirname, 'fixtures/flow-fixture.html'));
  return http.createServer((req, res) => {
    // Imágenes "de otro dominio" (localhost, sin cabeceras CORS ni permiso de la extensión)
    if (req.url.startsWith('/img/')) { res.writeHead(200, { 'Content-Type': 'image/png' }); return res.end(fixtureImg); }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(html);
  }).listen(FIX_PORT, '127.0.0.1');
}

async function startApp(DATA) {
  const srv = spawn(process.execPath, [path.join(__dirname, '../app/server.js')], { env: { ...process.env, YA_DATA_DIR: DATA, YA_PORT: String(APP_PORT) }, stdio: 'ignore' });
  for (let i = 0; i < 50; i++) { try { await fetch(`http://127.0.0.1:${APP_PORT}/api/status`); return srv; } catch { await sleep(100); } }
  throw new Error('la app no arrancó (¿puerto 5317 ocupado?)');
}

(async () => {
  const DATA = tmpDir('ya-data-');
  const DL = tmpDir('ya-downloads-');
  const media = makeMedia(tmpDir('ya-media-'));
  fixtureImg = fs.readFileSync(media.imgs[3]);
  const extDir = prepareExtension();
  const renamerDir = prepareRenamer();
  const fix = fixtureServer();
  let app = await startApp(DATA);
  // Chromium se lanza directamente (no con launchPersistentContext) para que las descargas de
  // chrome.downloads se comporten como en un Chrome normal (Playwright renombra las descargas).
  const profile = tmpDir('ya-profile-');
  fs.mkdirSync(path.join(profile, 'Default'), { recursive: true });
  fs.writeFileSync(path.join(profile, 'Default', 'Preferences'), JSON.stringify({ download: { default_directory: DL, prompt_for_download: false } }));
  const CDP_PORT = 9333;
  const chrome = spawn(process.env.YA_CHROME || chromium.executablePath(), ['--headless=new', '--no-sandbox', '--no-first-run', '--disable-features=DisableLoadExtensionCommandLineSwitch',
    `--user-data-dir=${profile}`, `--remote-debugging-port=${CDP_PORT}`, `--disable-extensions-except=${renamerDir},${extDir}`, `--load-extension=${renamerDir},${extDir}`,
    '--window-size=420,1100', 'about:blank'], { stdio: 'ignore' });
  let browser;
  for (let i = 0; i < 100 && !browser; i++) { try { browser = await chromium.connectOverCDP(`http://127.0.0.1:${CDP_PORT}`); } catch { await sleep(150); } }
  const ctx = browser.contexts()[0];
  // Playwright intercepta y renombra descargas: se devuelve el control a Chrome (comportamiento normal).
  await (await browser.newBrowserCDPSession()).send('Browser.setDownloadBehavior', { behavior: 'default' });
  let ok = false;
  try {
    // Identificar el service worker de NUESTRA extensión por el nombre de su manifiesto.
    let sw = null;
    for (let i = 0; i < 60 && !sw; i++) {
      for (const w of ctx.serviceWorkers()) {
        const name = await w.evaluate(() => chrome.runtime.getManifest().name).catch(() => '');
        if (name.startsWith('YOUTUBE AUTOMATIZADO')) { sw = w; break; }
      }
      if (!sw) await sleep(250);
    }
    if (!sw) throw new Error('La extensión no se cargó');
    const extId = sw.url().split('/')[2];

    const flow = await ctx.newPage();
    await flow.goto(`http://127.0.0.1:${FIX_PORT}/fixture/flow-fixture.html`);
    const panel = await ctx.newPage();
    await panel.goto(`chrome-extension://${extId}/sidepanel.html`);
    const panelErrors = []; panel.on('pageerror', e => panelErrors.push(e.message));

    await panel.waitForFunction(() => document.querySelector('#flowPill .dot').className === 'dot ok', null, { timeout: 15000 });
    await panel.waitForFunction(() => document.querySelector('#appPill .dot').className === 'dot ok');
    step('Panel RaulitoShow IA conectado a la pestaña y a la app');

    // Estado y controles por defecto
    assert.strictEqual(await panel.inputValue('#startAt'), '1');
    assert.strictEqual(await panel.getAttribute('#delay', 'min'), '0');
    assert.strictEqual(await panel.getAttribute('#delay', 'max'), '14');
    assert.ok(await panel.getByText('Modelo: el que tengas elegido en Flow').isVisible());

    // 1. Personaje
    await panel.setInputFiles('#refInput', media.imgs[0]);
    await panel.waitForSelector('#refThumb img');
    assert.strictEqual(await panel.textContent('#refName'), 'escena_001.png');
    // 2. Formato
    await panel.click('#aspectSeg button[data-v="9:16"]');
    await panel.click('#outputsSeg button[data-v="x2"]');
    assert.strictEqual(await panel.locator('#aspectSeg .on').textContent(), '9:16');
    assert.strictEqual(await panel.locator('#outputsSeg .on').textContent(), 'x2');
    // 3. Prompts desde .txt
    const txt = path.join(tmpDir('ya-p-'), 'prompts.txt');
    fs.writeFileSync(txt, 'un zorro en el bosque\n\nel zorro cruza el río AGENTE\nel zorro duerme\nel zorro despierta\n');
    await panel.setInputFiles('#txtInput', txt);
    await panel.waitForFunction(() => document.getElementById('promptCount').textContent === '4 prompts');
    await panel.fill('#prompts', (await panel.inputValue('#prompts')) + 'quinta escena\n');
    assert.strictEqual(await panel.textContent('#promptCount'), '5 prompts');
    step('Personaje, formato 9:16 / x2 y prompts (.txt + edición) con contador 5');
    await panel.fill('#prefix', 'Estilo acuarela,');
    await panel.fill('#startAt', '2');
    await panel.locator('#delay').fill('2');
    assert.strictEqual(await panel.textContent('#delayText'), 'Pausa entre prompts: 2 s');
    await panel.fill('#project', 'cuento zorro');
    await panel.check('#autoConfirm');

    // Escena de inicio > nº de prompts → validación
    await panel.fill('#startAt', '9');
    await panel.click('#startBtn');
    assert.match(await panel.textContent('#msg'), /mayor que el número de prompts/);
    await panel.fill('#startAt', '2');

    // INICIAR
    await panel.click('#startBtn');
    await panel.waitForFunction(() => document.querySelectorAll('#scenes li').length === 4);
    assert.match(await panel.locator('#scenes li').first().textContent(), /002/);
    await panel.waitForFunction(() => /En proceso/.test(document.getElementById('scenes').textContent));
    step('INICIAR: 4 escenas (desde la 2) y estado "En proceso"');
    await panel.waitForFunction(() => /Tiempo restante estimado/.test(document.getElementById('etaText').textContent), null, { timeout: 30000 });
    await panel.screenshot({ path: path.join(SHOTS, 'raulitoshow-en-marcha.png'), fullPage: true });
    step('Tiempo restante estimado aparece tras la primera escena real');
    await panel.waitForFunction(() => document.getElementById('doneText').textContent.startsWith('4 / 4'), null, { timeout: 90000 });
    const log = await flow.evaluate(() => window.__log);
    assert.deepStrictEqual(log.prompts, ['Estilo acuarela, el zorro cruza el río AGENTE', 'Estilo acuarela, el zorro duerme', 'Estilo acuarela, el zorro despierta', 'Estilo acuarela, quinta escena']);
    assert.strictEqual(log.aspect, '9:16'); assert.strictEqual(log.outputs, 'x2');
    assert.strictEqual(log.uploads, 1, 'personaje subido por la ventana de imágenes sin abrir el selector de archivos');
    assert.strictEqual(log.attachments, 1, 'personaje adjuntado (Flow lo conserva en el cuadro)');
    assert.strictEqual(log.confirmations, 1, 'confirmación automática al agente');
    for (let i = 1; i < log.submitTimes.length; i++) assert.ok(log.submitTimes[i] - log.submitTimes[i - 1] >= 2000, 'ritmo seguro respetado');
    const files = fs.readdirSync(path.join(DATA, 'proyectos', 'cuento_zorro', 'flow')).sort();
    assert.deepStrictEqual(files, ['escena_002.png', 'escena_002_2.png', 'escena_003.png', 'escena_003_2.png', 'escena_004.png', 'escena_004_2.png', 'escena_005.png', 'escena_005_2.png']);
    const sig = fs.readFileSync(path.join(DATA, 'proyectos', 'cuento_zorro', 'flow', 'escena_003.png')).subarray(0, 8).toString('hex');
    assert.strictEqual(sig, '89504e470d0a1a0a');
    assert.strictEqual(await panel.textContent('#etaText'), 'Terminado');
    step('4 escenas completadas: prefijo aplicado, 9:16/x2 seleccionados en el menú, personaje subido y adjuntado automáticamente (+ → subir), agente confirmado, pausas ≥ 2 s');
    step('Guardado real como escena_002…escena_005 (x2 → _2) en el proyecto: ' + files.join(', '));

    // Pausa y reanudación (conserva el progreso)
    await flow.reload(); await sleep(800);
    await panel.fill('#prompts', 'p uno\np dos\np tres');
    await panel.fill('#startAt', '1');
    await panel.fill('#prefix', '');
    await panel.click('#outputsSeg button[data-v="x1"]');
    await panel.locator('#delay').fill('4');
    await panel.click('#startBtn');
    await panel.waitForFunction(() => document.getElementById('doneText').textContent.startsWith('1 / 3'), null, { timeout: 30000 });
    await panel.click('#pauseBtn');
    await panel.waitForFunction(() => /En pausa/.test(document.getElementById('scenes').textContent), null, { timeout: 15000 });
    const before = (await flow.evaluate(() => window.__log.prompts.length));
    await sleep(5000);
    assert.strictEqual(await flow.evaluate(() => window.__log.prompts.length), before, 'no se envían prompts en pausa');
    assert.match(await panel.textContent('#doneText'), /^1 \/ 3/);
    await panel.screenshot({ path: path.join(SHOTS, 'raulitoshow-pausa.png'), fullPage: true });
    await panel.click('#pauseBtn');
    await panel.waitForFunction(() => document.getElementById('doneText').textContent.startsWith('3 / 3'), null, { timeout: 60000 });
    assert.deepStrictEqual(await flow.evaluate(() => window.__log.prompts), ['p uno', 'p dos', 'p tres']);
    assert.strictEqual(await flow.evaluate(() => window.__log.outputs), 'x1');
    step('Pausa: no envía nada mientras está en pausa; Reanudar continúa sin repetir escenas');

    // CAPTCHA → pausa con intervención humana; error de Flow → escena en Error y continúa
    await flow.reload(); await sleep(800);
    await panel.fill('#prompts', 'escena CAPTCHA\nescena FALLA\nescena final');
    await panel.locator('#delay').fill('0');
    await panel.click('#startBtn');
    await panel.waitForFunction(() => /CAPTCHA/.test(document.getElementById('msg').textContent) && document.getElementById('pauseBtn').textContent === '▶', null, { timeout: 30000 });
    step('CAPTCHA detectado: el proceso se detiene y pide intervención humana');
    await flow.evaluate(() => document.getElementById('cap').remove());
    await panel.click('#pauseBtn');
    await panel.waitForFunction(() => { const t = document.getElementById('doneText').textContent; return t.startsWith('2 / 3') && /1 con error/.test(t); }, null, { timeout: 60000 });
    assert.match(await panel.locator('#scenes li').nth(1).textContent(), /Error.*Flow informó: Generation failed/s);
    assert.match(await panel.locator('#scenes li').nth(2).textContent(), /Completada/);
    await panel.screenshot({ path: path.join(SHOTS, 'raulitoshow-error.png'), fullPage: true });
    assert.ok(await panel.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'el panel no se desborda horizontalmente');
    step('Error informado por la página → escena en "Error" y la cola continúa');

    // 📄 CARGAR ARCHIVO TXT: archivo real en Windows-1252 (Bloc de notas), CRLF, líneas vacías, 60 prompts
    await flow.reload(); await sleep(800);
    const lines60 = Array.from({ length: 60 }, (_, i) => `Escena ${i + 1}: canción del niño junto al río, señal Nº ${i + 1}`);
    const ansi = path.join(tmpDir('ya-txt-'), 'guion_ansi.txt');
    fs.writeFileSync(ansi, Buffer.from(lines60.map((l, i) => (i % 10 === 0 ? '\r\n   \r\n' : '') + l).join('\r\n') + '\r\n', 'latin1'));
    await panel.setInputFiles('#txtInput', ansi);
    await panel.waitForFunction(() => document.getElementById('promptCount').textContent === '60 prompts');
    assert.strictEqual(await panel.textContent('#promptRange'), 'Escenas 001–060');
    assert.match(await panel.textContent('#txtMsg'), /✓ «guion_ansi\.txt» cargado: 60 prompts → escenas 001 a 060\. \(codificación Windows-1252/);
    assert.match(await panel.locator('#promptPreview li').first().textContent(), /Prompt 001 — Escena 001\s*Escena 1: canción del niño junto al río, señal Nº 1/);
    assert.match(await panel.locator('#promptPreview li').nth(59).textContent(), /Prompt 060 — Escena 060/);
    // Arrastrar y soltar otro .txt (UTF-8) reemplaza el anterior
    await panel.evaluate(() => {
      const dt = new DataTransfer(); dt.items.add(new File(['primera línea\n\nsegunda línea ñ\n'], 'arrastrado.txt', { type: 'text/plain' }));
      document.getElementById('prompts').dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
    });
    await panel.waitForFunction(() => document.getElementById('promptCount').textContent === '2 prompts');
    assert.match(await panel.textContent('#txtMsg'), /«arrastrado\.txt» cargado: 2 prompts → escenas 001 a 002\.$/);
    // Archivo que no es .txt → mensaje de error, no cambia nada
    await panel.evaluate(() => {
      const dt = new DataTransfer(); dt.items.add(new File(['x'], 'foto.png', { type: 'image/png' }));
      document.getElementById('prompts').dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
    });
    await panel.waitForFunction(() => /no es un archivo \.txt/.test(document.getElementById('txtMsg').textContent));
    assert.strictEqual(await panel.textContent('#promptCount'), '2 prompts');
    // Volver al de 60, editar una línea a mano y empezar en la escena 59: el motor recibe exactamente esas líneas
    await panel.setInputFiles('#txtInput', ansi);
    await panel.waitForFunction(() => document.getElementById('promptCount').textContent === '60 prompts');
    const edited = (await panel.inputValue('#prompts')).replace('señal Nº 60', 'señal Nº 60 (editada)');
    await panel.fill('#prompts', edited);
    await panel.fill('#prefix', ''); await panel.fill('#startAt', '59'); await panel.locator('#delay').fill('0');
    await panel.click('#outputsSeg button[data-v="x1"]');
    await panel.click('#startBtn');
    await panel.waitForFunction(() => document.getElementById('doneText').textContent.startsWith('2 / 2'), null, { timeout: 60000 });
    assert.deepStrictEqual(await flow.evaluate(() => window.__log.prompts.slice(-2)), [lines60[58], lines60[59] + ' (editada)']);
    assert.match(await panel.locator('#scenes li').first().textContent(), /^\s*059/);
    await panel.fill('#startAt', '1');
    step('📄 CARGAR ARCHIVO TXT: archivo ANSI real con tildes/ñ, CRLF y líneas vacías → 60 prompts (001–060), mensaje, arrastrar y soltar, reemplazo, editar y empezar en la 59 → el motor envía el texto exacto');

    // Imágenes servidas desde otro dominio sin CORS: fetch falla ("Failed to fetch") → descarga con el gestor de Chrome
    await flow.goto(`http://127.0.0.1:${FIX_PORT}/fixture/flow-fixture.html?xo=1`); await sleep(800);
    await panel.fill('#prompts', 'imagen de otro dominio');
    await panel.fill('#project', 'otro_dominio');
    await panel.click('#startBtn');
    await panel.waitForFunction(() => document.getElementById('doneText').textContent.startsWith('1 / 1'), null, { timeout: 40000 });
    const xoWhere = await panel.locator('#scenes li .f').first().textContent();
    assert.match(xoWhere, /YOUTUBE_AUTOMATIZADO[\\/]otro_dominio[\\/]escena_001\.png$/);
    assert.ok(fs.existsSync(xoWhere) && fs.readFileSync(xoWhere).subarray(0, 4).toString('hex') === '89504e47', 'PNG real descargado');
    step('Imagen servida desde otro dominio sin CORS ("Failed to fetch"): descargada igualmente, con su nombre escena_NNN aunque otra extensión renombra las descargas → ' + xoWhere);
    await panel.fill('#project', 'cuento zorro');

    // Sin la app → se guarda en Descargas/YOUTUBE_AUTOMATIZADO/<proyecto>/
    app.kill(); await sleep(500);
    await flow.reload(); await sleep(800);
    await panel.fill('#prompts', 'solo una');
    await panel.click('#startBtn');
    await panel.waitForFunction(() => document.getElementById('doneText').textContent.startsWith('1 / 1'), null, { timeout: 30000 });
    const where = await panel.locator('#scenes li .f').first().textContent();
    assert.match(where, /YOUTUBE_AUTOMATIZADO[\\/]cuento_zorro[\\/]escena_001\.png$/);
    assert.ok(fs.existsSync(where), 'archivo descargado en ' + where);
    step('Sin la app: guardado en Descargas → ' + where);

    assert.deepStrictEqual(panelErrors, []);
    ok = true;
    console.log(`\nRaulitoShow IA E2E OK. Capturas en ${SHOTS}`);
  } catch (e) {
    console.error('FALLO:', e.stack || e.message);
    for (const p of ctx.pages()) await p.screenshot({ path: path.join(SHOTS, `fallo-${Math.random().toString(36).slice(2, 6)}.png`), fullPage: true }).catch(() => {});
  } finally {
    await browser.close().catch(() => {}); chrome.kill();
    fix.close(); app.kill();
    process.exitCode = ok ? 0 : 1;
  }
})();
