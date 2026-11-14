'use strict';
// Prueba de RaulitoShow IA para tablet (marcador) en Chromium con vista de tablet táctil.
// Se ejecuta el código del marcador (tablet/raulitoshow.bookmarklet.txt) dentro de
// tests/fixtures/flow-fixture.html (FIXTURE DE PRUEBAS, no es Google Flow), servido con una CSP
// estricta y Trusted Types, como las páginas de Google.
const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { makeMedia, tmpDir } = require('./helpers');

const PORT = 5993;
const SHOTS = process.env.YA_SHOTS || tmpDir('ya-shots-');
const step = m => console.log('✓', m);
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const bm = fs.readFileSync(path.join(__dirname, '../tablet/raulitoshow.bookmarklet.txt'), 'utf8').trim();
  assert.ok(bm.startsWith('javascript:'));
  const code = decodeURIComponent(bm.slice('javascript:'.length));
  // El fixture usa su propio script en línea: se le da un nonce; todo lo demás queda bloqueado.
  const fixture = fs.readFileSync(path.join(__dirname, 'fixtures/flow-fixture.html'), 'utf8').replace('<script>', '<script nonce="n0nce">');
  const srv = http.createServer((q, r) => {
    r.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8',
      'Content-Security-Policy': "script-src 'nonce-n0nce'; style-src 'self' 'unsafe-inline'; require-trusted-types-for 'script'; object-src 'none'" });
    r.end(fixture);
  }).listen(PORT, '127.0.0.1');
  const M = makeMedia(tmpDir('ya-media-'));
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, hasTouch: true, acceptDownloads: true });
  const p = await ctx.newPage();
  const errors = []; p.on('pageerror', e => errors.push(e.message));
  const tt = []; p.on('console', m => { if (/TrustedHTML|Trusted Type|Content Security Policy/i.test(m.text())) tt.push(m.text()); });
  const downloads = []; p.on('download', d => downloads.push(d.suggestedFilename()));
  const runBookmarklet = () => p.evaluate(c => { (0, eval)(c); }, code);
  const panel = sel => p.locator(`#raulitoshow-ia-panel >> ${sel}`);
  let ok = false;
  try {
    await p.goto(`http://127.0.0.1:${PORT}/fixture`);
    await runBookmarklet();
    await panel('h2:has-text("Personaje de referencia")').waitFor();
    assert.ok(await panel('text=Modelo: el que tengas elegido en Flow').isVisible());
    await p.waitForFunction(() => document.getElementById('raulitoshow-ia-panel').shadowRoot.querySelector('.pill .dot').className === 'dot ok');
    step('Marcador abre el panel RaulitoShow IA dentro de la página (CSP estricta + Trusted Types) y detecta el cuadro de prompts');

    await panel('input[type=file][accept^="image"]').setInputFiles(M.imgs[0]);
    await panel('.thumb img').waitFor();
    await panel('.seg button[data-v="9:16"]').click();
    await panel('.seg button[data-v="x2"]').click();
    const txt = path.join(tmpDir('ya-p-'), 'prompts.txt');
    fs.writeFileSync(txt, 'un zorro en el bosque\nel zorro cruza el río AGENTE\nel zorro duerme\n');
    await panel('input[accept^=".txt"]').setInputFiles(txt);
    await p.waitForFunction(() => document.getElementById('raulitoshow-ia-panel').shadowRoot.querySelector('.count').textContent === '3 prompts');
    await panel('input[type=text]').fill('Estilo acuarela,');
    await panel('input[type=number]').fill('2');
    await panel('input[type=range]').fill('2');
    await panel('label.check:has-text("Confirmar automáticamente") input').check();
    step('Personaje, 9:16 / x2, prompts desde .txt (contador 3), prefijo, escena inicial 2, ritmo 2 s');

    await panel('button.start').click();
    await p.waitForFunction(() => /^2 \/ 2/.test(document.getElementById('raulitoshow-ia-panel').shadowRoot.querySelector('.row.small span').textContent), null, { timeout: 60000 });
    const log = await p.evaluate(() => window.__log);
    assert.deepStrictEqual(log.prompts, ['Estilo acuarela, el zorro cruza el río AGENTE', 'Estilo acuarela, el zorro duerme']);
    assert.strictEqual(log.aspect, '9:16'); assert.strictEqual(log.outputs, 'x2');
    assert.strictEqual(log.uploads, 1); assert.strictEqual(log.attachments, 1); assert.strictEqual(log.confirmations, 1);
    assert.ok(log.submitTimes[1] - log.submitTimes[0] >= 2000);
    await sleep(500);
    assert.deepStrictEqual(downloads.sort(), ['escena_002.png', 'escena_002_2.png', 'escena_003.png', 'escena_003_2.png']);
    await p.screenshot({ path: path.join(SHOTS, 'bookmarklet-tablet.png') });
    step('Escenas 2–3 completadas en la página: prefijo, ajustes, personaje adjuntado, agente confirmado, ritmo ≥ 2 s');
    step('Descargas reales: ' + downloads.join(', '));

    // Recarga a mitad: se conserva y queda en pausa; reabrir el marcador; pausa/reanudar
    await panel('textarea').fill('p uno\np dos\np tres');
    await panel('input[type=number]').fill('1');
    await panel('.seg button[data-v="x1"]').click();
    await panel('input[type=text]').fill('');
    await panel('input[type=range]').fill('3');
    await panel('button.start').click();
    await panel('button.start').click(); // segunda pulsación confirma descartar la anterior (ya terminada no lo pide)
    await p.waitForFunction(() => /^1 \/ 3/.test(document.getElementById('raulitoshow-ia-panel').shadowRoot.querySelector('.row.small span').textContent), null, { timeout: 30000 });
    await panel('button.pause').click();
    await p.waitForFunction(() => /En pausa/.test(document.getElementById('raulitoshow-ia-panel').shadowRoot.querySelector('ol').textContent), null, { timeout: 15000 });
    const sent = await p.evaluate(() => window.__log.prompts.length);
    await sleep(4000);
    assert.strictEqual(await p.evaluate(() => window.__log.prompts.length), sent);
    await p.reload();
    await runBookmarklet();
    await panel('text=1 / 3 escenas completadas').waitFor();
    assert.strictEqual(await panel('textarea').inputValue(), 'p uno\np dos\np tres');
    await panel('button.pause').click();
    await p.waitForFunction(() => /^3 \/ 3/.test(document.getElementById('raulitoshow-ia-panel').shadowRoot.querySelector('.row.small span').textContent), null, { timeout: 60000 });
    assert.deepStrictEqual(await p.evaluate(() => window.__log.prompts), ['p dos', 'p tres']);
    step('Pausa sin envíos; tras recargar Flow y reabrir el marcador conserva prompts y progreso; Reanudar termina sin repetir');

    // Minimizar y volver a abrir
    await panel('button.min').click();
    assert.ok(await panel('button.fab').isVisible());
    await panel('button.fab').click();
    assert.ok(await panel('h2:has-text("Personaje de referencia")').isVisible());
    await runBookmarklet(); // pulsar el marcador otra vez alterna el panel
    assert.ok(await panel('button.fab').isVisible());
    await runBookmarklet();
    step('Minimizar / abrir y volver a pulsar el marcador alterna el panel');

    // CAPTCHA y error
    await p.reload(); await runBookmarklet();
    await panel('textarea').fill('escena CAPTCHA\nescena FALLA\nescena final');
    await panel('input[type=range]').fill('0');
    await panel('button.start').click();
    await p.waitForFunction(() => /CAPTCHA/.test(document.getElementById('raulitoshow-ia-panel').shadowRoot.querySelector('.msg').textContent), null, { timeout: 30000 });
    await p.evaluate(() => document.getElementById('cap').remove());
    await panel('button.pause').click();
    await p.waitForFunction(() => /^2 \/ 3 escenas completadas · 1 con error/.test(document.getElementById('raulitoshow-ia-panel').shadowRoot.querySelector('.row.small span').textContent), null, { timeout: 60000 });
    step('CAPTCHA → pausa con intervención humana; error de la página → escena en Error y sigue');

    // Límite de uso de Flow (tarjeta "Failed — You've reached your usage limit") → pausa, no gasta las escenas
    await p.reload(); await runBookmarklet();
    await panel('textarea').fill('escena LIMITE\nescena TARJETA_FALLO\nescena despues');
    await panel('button.start').click();
    await p.waitForFunction(() => /límite de uso/.test(document.getElementById('raulitoshow-ia-panel').shadowRoot.querySelector('.msg').textContent), null, { timeout: 30000 });
    const sentAtLimit = await p.evaluate(() => window.__log.prompts.length);
    await sleep(3000);
    assert.strictEqual(await p.evaluate(() => window.__log.prompts.length), sentAtLimit, 'no sigue enviando tras el límite');
    assert.match(await panel('ol li').first().textContent(), /En pausa/);
    await panel('button.pause').click();   // "más tarde": reanudar reenvía la escena del límite
    await p.waitForFunction(() => /^2 \/ 3 escenas completadas · 1 con error/.test(document.getElementById('raulitoshow-ia-panel').shadowRoot.querySelector('.row.small span').textContent), null, { timeout: 60000 });
    assert.match(await panel('ol li').nth(1).textContent(), /Error.*Flow no pudo generar esta escena: Something went wrong/s);
    step('Límite de uso de Flow → pausa con aviso y sin gastar escenas; Reanudar reenvía la escena; tarjeta "Failed" → Error y sigue');

    // Vista vertical (tablet en vertical / móvil)
    await p.setViewportSize({ width: 600, height: 960 });
    assert.ok(await p.evaluate(() => document.getElementById('raulitoshow-ia-panel').shadowRoot.querySelector('.wrap').getBoundingClientRect().width <= innerWidth));
    await p.screenshot({ path: path.join(SHOTS, 'bookmarklet-vertical.png') });

    assert.deepStrictEqual(tt, [], 'sin violaciones de CSP / Trusted Types');
    assert.deepStrictEqual(errors, []);
    ok = true;
    console.log(`\nRaulitoShow IA (tablet) E2E OK. Capturas en ${SHOTS}`);
  } catch (e) {
    console.error('FALLO:', e.stack || e.message, errors, tt);
    await p.screenshot({ path: path.join(SHOTS, 'bookmarklet-fallo.png') }).catch(() => {});
  } finally { await browser.close(); srv.close(); process.exitCode = ok ? 0 : 1; }
})();
