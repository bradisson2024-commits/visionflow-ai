'use strict';
// Prueba de extremo a extremo del Editor RaulitoShow IA en Chromium real (Playwright).
const { chromium } = require('playwright');
const { spawn, execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { makeMedia, tmpDir } = require('./helpers');

const PORT = 5800 + Math.floor(Math.random() * 100);
const BASE = `http://127.0.0.1:${PORT}`;
const SHOTS = process.env.YA_SHOTS || tmpDir('ya-shots-');

(async () => {
  const DATA = tmpDir('ya-data-');
  const mediaDir = tmpDir('ya-media-');
  const M = makeMedia(path.join(mediaDir, 'mis_imagenes'));
  fs.writeFileSync(path.join(mediaDir, 'mis_imagenes', 'notas.txt'), 'no es imagen');
  const srv = spawn(process.execPath, [path.join(__dirname, '../app/server.js')], { env: { ...process.env, YA_DATA_DIR: DATA, YA_PORT: String(PORT) }, stdio: 'inherit' });
  for (let i = 0; i < 50; i++) { try { await fetch(BASE + '/api/status'); break; } catch { await new Promise(r => setTimeout(r, 100)); } }
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  const step = m => console.log('✓', m);
  try {
    // Pantalla principal
    await page.goto(BASE + '/');
    await page.getByText('FFmpeg listo').waitFor();
    assert.ok(await page.getByRole('heading', { name: 'RaulitoShow IA' }).isVisible());
    assert.ok(await page.getByRole('heading', { name: 'Editor de videos' }).isVisible());
    await page.fill('#newName', 'Video E2E');
    await page.click('#createBtn');
    await page.getByText('Proyecto "Video E2E" creado').waitFor();
    await page.screenshot({ path: path.join(SHOTS, 'inicio.png') });
    step('Pantalla principal con las dos herramientas y creación de proyecto');

    await page.goto(BASE + '/editor?project=Video_E2E');
    await page.getByText('Tus imágenes + tu voz = tu video listo para YouTube').waitFor();

    // 1. Carpeta de imágenes (incluye un .txt que debe ignorarse)
    await page.setInputFiles('#folderInput', path.join(mediaDir, 'mis_imagenes'));
    await page.waitForFunction(() => document.getElementById('imgCount').textContent === '4 imágenes');
    const status = await page.textContent('#imgStatus');
    assert.match(status, /4 imágenes copiadas/);
    assert.match(status, /ignorados/);
    assert.strictEqual(await page.locator('#thumbs img').count(), 4);
    assert.strictEqual(await page.locator('.card').count(), 4);
    assert.strictEqual(await page.textContent('#galTitle'), 'Escenas — 4 imágenes — 0:16.0');
    const order = await page.evaluate(() => window.__editor.state.images.map(i => i.file));
    assert.deepStrictEqual(order, ['escena_001.png', 'escena_002.png', 'escena_003.png', 'escena_004.png']);
    step('Carga de carpeta: 4 imágenes, orden conservado, archivos no-imagen ignorados');

    // Imágenes sueltas se añaden
    await page.setInputFiles('#filesInput', M.imgs[0]);
    await page.waitForFunction(() => document.getElementById('imgCount').textContent === '5 imágenes');
    step('Elegir imágenes sueltas añade a la lista');
    // Volver a 4 cargando la carpeta otra vez (sustituye)
    await page.setInputFiles('#folderInput', path.join(mediaDir, 'mis_imagenes'));
    await page.waitForFunction(() => document.getElementById('imgCount').textContent === '4 imágenes');

    // Aplicar a todas
    await page.fill('#allDur', '2.5');
    await page.click('#applyAllBtn');
    assert.strictEqual(await page.textContent('#galTitle'), 'Escenas — 4 imágenes — 0:10.0');
    assert.match(await page.locator('.card').nth(3).textContent(), /Inicio 0:07\.5.*Duración 2\.50 s/s);
    assert.strictEqual(await page.getAttribute('#timeline', 'max'), '10');
    step('Todas duran 2.5 s → Aplicar a todas actualiza tarjetas, total y línea de tiempo');

    // Repartir sin audio → aviso
    await page.click('#distributeBtn');
    assert.match(await page.textContent('#distMsg'), /Carga primero el audio/);

    // 2. Audio
    await page.setInputFiles('#audioInput', M.audio);
    await page.waitForFunction(() => document.getElementById('audioState').textContent === 'Cargado ✓');
    assert.match(await page.textContent('#audioDur'), /6\.0\d s/);
    assert.strictEqual(await page.textContent('#audioName'), 'voz.mp3');
    const audioDur = await page.evaluate(() => new Promise(r => { const a = document.getElementById('audioPlayer'); if (a.readyState >= 1) r(a.duration); else a.onloadedmetadata = () => r(a.duration); }));
    assert.ok(Math.abs(audioDur - 6) < 0.1);
    step('Audio MP3 cargado: nombre, duración real (6 s) y reproductor');

    // Repartir con el audio sin texto → reparto igual
    await page.click('#distributeBtn');
    assert.match(await page.textContent('#distMsg'), /Reparto igual: 4 escenas de 1\.5\d s/);
    assert.match(await page.textContent('#galTitle'), /0:06\.0/);

    // 3. Texto → distribución aproximada
    await page.setInputFiles('#textInput', M.txt);
    await page.waitForFunction(() => document.getElementById('sceneText').value.includes('zorro'));
    assert.match(await page.textContent('#textInfo'), /4 líneas/);
    await page.click('#distributeBtn');
    assert.match(await page.textContent('#distMsg'), /APROXIMADA/);
    const d = await page.evaluate(() => window.__editor.state.durations);
    assert.ok(d[1] > d[0] && d[1] > d[2], 'la línea larga recibe más tiempo: ' + d);
    assert.ok(Math.abs(d.reduce((a, b) => a + b, 0) - 6.04) < 0.1);
    step('Texto de escenas (.txt) → Repartir con el audio: distribución APROXIMADA indicada');

    // Texto con marcas de tiempo reales
    await page.fill('#sceneText', '[00:00] Había una vez\n[00:01] un zorro\n[00:03] que llegó al río\n[00:04.5] fin');
    assert.match(await page.textContent('#textInfo'), /marcas de tiempo reales/);
    await page.click('#distributeBtn');
    assert.match(await page.textContent('#distMsg'), /marcas de tiempo reales/);
    const d2 = await page.evaluate(() => window.__editor.state.durations);
    assert.deepStrictEqual(d2.slice(0, 3), [1, 2, 1.5]);
    step('Marcas de tiempo reales usadas para sincronizar');

    // Seleccionar tarjeta → borde rojo, visor y posición
    await page.locator('.card').nth(2).click();
    assert.ok(await page.locator('.card').nth(2).evaluate(e => e.classList.contains('sel') && getComputedStyle(e).borderColor === 'rgb(229, 57, 53)'));
    assert.strictEqual(await page.inputValue('#timeline'), '3');
    assert.strictEqual(await page.textContent('#tCur'), '0:03.0');
    assert.match(await page.textContent('#caption'), /que llegó al río/);
    const px = await page.evaluate(() => { const c = document.getElementById('canvas'); const p = c.getContext('2d').getImageData(20, 20, 1, 1).data; return [...p]; });
    assert.ok(px[2] > 150 && px[0] < 60, 'el visor muestra la escena 3 (azul): ' + px);
    await page.screenshot({ path: path.join(SHOTS, 'editor.png') });
    step('Tarjeta seleccionada: borde rojo, visor con la escena, tiempo actualizado');

    // Reproducción real
    await page.locator('.card').nth(0).click();
    await page.click('#playBtn');
    await page.waitForTimeout(1500);
    const t1 = await page.evaluate(() => window.__editor.curTime);
    assert.ok(t1 > 1 && t1 < 2.2, 'avanza el tiempo: ' + t1);
    assert.strictEqual(await page.evaluate(() => window.__editor.selected), 1);
    await page.click('#pauseBtn');
    const tp = await page.evaluate(() => window.__editor.curTime);
    await page.waitForTimeout(500);
    assert.strictEqual(await page.evaluate(() => window.__editor.curTime), tp);
    // Arrastrar la línea de tiempo
    await page.locator('#timeline').fill('5');
    assert.strictEqual(await page.evaluate(() => window.__editor.selected), 3);
    step('Reproducir / Pausar / línea de tiempo funcionan y cambian de escena');

    // 4. Crear MP4
    await page.selectOption('#qualitySel', '720p');
    await page.click('#exportBtn');
    await page.getByText('Video guardado en:').waitFor({ timeout: 120000 });
    const outPath = (await page.textContent('#exportResult code')).trim();
    assert.ok(fs.existsSync(outPath));
    assert.strictEqual(await page.locator('#exportSteps li.done').count(), 9);
    const vd = await page.evaluate(() => new Promise(r => { const v = document.querySelector('#exportResult video'); if (v.readyState >= 1) r([v.duration, v.videoWidth]); else v.onloadedmetadata = () => r([v.duration, v.videoWidth]); }));
    assert.ok(Math.abs(vd[0] - 6) < 0.15 && vd[1] === 1280, 'video final reproducible en el navegador: ' + vd);
    const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_name:format=duration', '-of', 'json', outPath]));
    assert.deepStrictEqual(probe.streams.map(s => s.codec_name).sort(), ['aac', 'h264']);
    await page.screenshot({ path: path.join(SHOTS, 'exportado.png') });
    step('CREAR VIDEO MP4: 9 pasos completados, archivo validado y reproducible: ' + outPath);

    // Persistencia: recargar y mantener estado
    await page.reload();
    await page.waitForFunction(() => document.getElementById('imgCount').textContent === '4 imágenes');
    assert.strictEqual(await page.textContent('#audioName'), 'voz.mp3');
    assert.strictEqual(await page.inputValue('#qualitySel'), '720p');
    step('El proyecto conserva imágenes, audio, texto y ajustes al recargar');

    // Resultados de RaulitoShow IA → Editor
    await fetch(`${BASE}/api/flow/save?project=Video_E2E&name=escena_010.png`, { method: 'POST', body: fs.readFileSync(M.imgs[3]) });
    await fetch(`${BASE}/api/flow/save?project=Video_E2E&name=escena_009.png`, { method: 'POST', body: fs.readFileSync(M.imgs[1]) });
    await page.click('#useFlowBtn');
    await page.waitForFunction(() => document.getElementById('imgCount').textContent === '2 imágenes');
    assert.deepStrictEqual(await page.evaluate(() => window.__editor.state.images.map(i => i.file)), ['escena_009.png', 'escena_010.png']);
    step('Usar resultados de RaulitoShow IA carga las escenas guardadas desde Flow, en orden');

    // Vista móvil sin desbordamiento horizontal
    await page.setViewportSize({ width: 390, height: 844 });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    assert.ok(!overflow, 'sin scroll horizontal en móvil');

    assert.deepStrictEqual(errors, []);
    console.log(`\nEditor E2E OK. Capturas en ${SHOTS}`);
  } catch (e) {
    await page.screenshot({ path: path.join(SHOTS, 'fallo.png') }).catch(() => {});
    console.error('FALLO:', e.message, errors);
    process.exitCode = 1;
  } finally {
    await browser.close();
    srv.kill();
    fs.rmSync(DATA, { recursive: true, force: true });
  }
})();
