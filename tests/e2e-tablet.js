'use strict';
// Prueba del Editor para tablet (tablet/editor-tablet.html) en Chromium con vista de tablet:
// carga imágenes, audio y texto, reparte, reproduce, crea el MP4 con WebCodecs y lo valida con FFprobe.
// La librería mp4-muxer se sirve desde node_modules o la ruta YA_MP4MUXER (el CDN no es accesible en pruebas).
const { chromium } = require('playwright');
const { execFileSync } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { makeMedia, tmpDir } = require('./helpers');

const MUXER = process.env.YA_MP4MUXER;
const PORT = 5992;
const SHOTS = process.env.YA_SHOTS || tmpDir('ya-shots-');
const step = m => console.log('✓', m);

(async () => {
  if (!MUXER || !fs.existsSync(MUXER)) { console.error('Define YA_MP4MUXER con la ruta a mp4-muxer@5.1.3/build/mp4-muxer.js'); process.exit(2); }
  const page = fs.readFileSync(path.join(__dirname, '../tablet/editor-tablet.html'), 'utf8');
  // Mismo esqueleto que añade la publicación
  const html = `<!doctype html><html><head><meta charset=utf8><meta name=viewport content="width=device-width,initial-scale=1,viewport-fit=cover"></head><body>${page}</body></html>`;
  const srv = http.createServer((q, r) => { r.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); r.end(html); }).listen(PORT, '127.0.0.1');
  const M = makeMedia(tmpDir('ya-media-'));
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1, hasTouch: true, isMobile: false });
  await ctx.route('https://cdn.jsdelivr.net/npm/mp4-muxer@5.1.3/build/mp4-muxer.js', r => r.fulfill({ body: fs.readFileSync(MUXER), contentType: 'text/javascript' }));
  // Simulación del capability "downloads" del visor: guarda lo que la página entrega.
  await ctx.addInitScript(() => {
    window.__saved = null;
    window.claude = { use: async n => n === 'downloads' ? { save: async ({ filename, data }) => { window.__saved = { filename, bytes: Array.from(new Uint8Array(await data.arrayBuffer())) }; return { status: 'saved' }; } } : null };
  });
  const p = await ctx.newPage();
  const errors = []; p.on('pageerror', e => errors.push(e.message));
  let ok = false;
  try {
    await p.goto(`http://127.0.0.1:${PORT}/`);
    await p.getByText('Tus imágenes + tu voz = tu video listo para YouTube').waitFor();
    assert.ok(await p.locator('#viewerEmpty').isVisible());
    await p.setInputFiles('#filesInput', M.imgs);
    await p.waitForFunction(() => document.getElementById('imgCount').textContent === '4 imágenes');
    assert.deepStrictEqual(await p.evaluate(() => window.__editor.state.images.map(i => i.name)), ['escena_001.png', 'escena_002.png', 'escena_003.png', 'escena_004.png']);
    step('Imágenes sueltas (selección múltiple): 4, en orden');
    await p.setInputFiles('#audioInput', M.m4a);
    await p.waitForFunction(() => document.getElementById('audioState').textContent === 'Cargado ✓');
    assert.match(await p.textContent('#audioDur'), /2\.0\d s/);
    await p.setInputFiles('#audioInput', M.audio);
    await p.waitForFunction(() => /6\.0\d s/.test(document.getElementById('audioDur').textContent));
    step('Audio M4A y MP3 con duración real');
    // 📄 CARGAR ARCHIVO TXT con un archivo real de Windows (ANSI), saltos CRLF y líneas vacías
    const ansiTxt = path.join(tmpDir('ya-txt-'), 'escenas_narracion.txt');
    fs.writeFileSync(ansiTxt, Buffer.from('Había una vez un niño.\r\n\r\nCantó una canción junto al río.\r\n   \r\nLa señal llegó al amanecer.\r\nY así terminó la historia de Juan.\r\n', 'latin1'));
    assert.ok(await p.getByRole('button', { name: '📄 CARGAR ARCHIVO TXT' }).isVisible());
    await p.setInputFiles('#textInput', ansiTxt);
    await p.waitForFunction(() => /4 líneas/.test(document.getElementById('textInfo').textContent));
    assert.match(await p.textContent('#textMsg'), /✓ «escenas_narracion\.txt» cargado: 4 líneas → escenas 001 a 004\. \(codificación Windows-1252/);
    assert.match(await p.locator('#textPreview li').nth(1).textContent(), /Escena 002\s*Cantó una canción junto al río\.\s*→ imagen: escena_002\.png/);
    assert.strictEqual(await p.locator('#textPreview li').count(), 4);
    // Archivo que no es de texto → error claro, el texto anterior se conserva
    await p.setInputFiles('#textInput', M.imgs[0]);
    await p.waitForFunction(() => /no es un archivo de texto/.test(document.getElementById('textMsg').textContent));
    assert.match(await p.inputValue('#sceneText'), /señal llegó/);
    step('📄 CARGAR ARCHIVO TXT en el Editor: archivo ANSI real con tildes/ñ → 4 escenas numeradas y asociadas a sus imágenes; archivo no válido → mensaje');
    await p.click('#distributeBtn');
    assert.match(await p.textContent('#distMsg'), /APROXIMADA/);
    await p.fill('#sceneText', '[00:00] a\n[00:01] b\n[00:03] c\n[00:04.5] d');
    await p.click('#distributeBtn');
    assert.match(await p.textContent('#distMsg'), /marcas de tiempo reales/);
    assert.deepStrictEqual((await p.evaluate(() => window.__editor.state.durations)).slice(0, 3), [1, 2, 1.5]);
    step('Repartir con el audio: aproximado por texto y con marcas reales');
    await p.fill('#allDur', '1.5'); await p.click('#applyAllBtn');
    assert.strictEqual(await p.textContent('#galTitle'), 'Escenas — 4 imágenes — 0:06.0');
    await p.locator('.card').nth(2).click();
    assert.strictEqual(await p.textContent('#tCur'), '0:03.0');
    assert.ok(await p.locator('.card').nth(2).evaluate(e => e.classList.contains('sel')));
    const px = await p.evaluate(() => [...document.getElementById('canvas').getContext('2d').getImageData(20, 20, 1, 1).data]);
    assert.ok(px[2] > 150 && px[0] < 60, 'visor muestra escena 3 (azul) ' + px);
    await p.click('#playBtn'); await p.waitForTimeout(1200); await p.click('#pauseBtn');
    assert.ok(await p.evaluate(() => window.__editor.curTime) > 3.8);
    step('Aplicar a todas, tarjeta con borde rojo, visor y reproducción');
    await p.selectOption('#qualitySel', '720p');
    await p.click('#exportBtn');
    await p.waitForFunction(() => window.__editor.job && window.__editor.job.state !== 'running', null, { timeout: 120000 });
    const job = await p.evaluate(() => window.__editor.job);
    assert.strictEqual(job.state, 'done', JSON.stringify(job.steps.filter(s => s.status === 'error')));
    assert.ok(job.steps.every(s => s.status === 'done'));
    await p.screenshot({ path: path.join(SHOTS, 'tablet-exportado.png') });
    await p.click('#saveBtn');
    await p.waitForFunction(() => window.__saved);
    const saved = await p.evaluate(() => window.__saved);
    assert.match(saved.filename, /^video_.*\.mp4$/);
    assert.match(await p.textContent('#saveNotice'), /Guardado/);
    const out = path.join(SHOTS, 'tablet-video.mp4');
    fs.writeFileSync(out, Buffer.from(saved.bytes));
    const info = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_name,width,height,nb_frames:format=duration', '-of', 'json', out]));
    const v = info.streams.find(s => s.codec_name === 'h264');
    const a = info.streams.find(s => s.codec_name === 'aac' || s.codec_name === 'opus');
    assert.ok(v && a, JSON.stringify(info));
    assert.strictEqual(v.width, 1280); assert.strictEqual(v.height, 720);
    assert.ok(Math.abs(Number(info.format.duration) - 6) < 0.15, info.format.duration);
    execFileSync('ffmpeg', ['-v', 'error', '-xerror', '-i', out, '-f', 'null', '-']);
    const pix = execFileSync('ffmpeg', ['-v', 'error', '-ss', '2.25', '-i', out, '-frames:v', '1', '-vf', 'crop=4:4:20:20,scale=1:1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']);
    assert.ok(pix[1] > 100 && pix[0] < 60, 'escena 2 verde en 2.25 s: ' + [...pix]);
    step(`MP4 creado en el navegador y validado con FFprobe: H.264 1280x720 + ${a.codec_name}, ${Number(info.format.duration).toFixed(2)} s, decodificación completa sin errores`);
    // Vista vertical de tablet / móvil sin scroll horizontal
    for (const w of [800, 400]) {
      await p.setViewportSize({ width: w, height: 1200 });
      assert.ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'sin scroll horizontal a ' + w);
    }
    await p.screenshot({ path: path.join(SHOTS, 'tablet-vertical.png'), fullPage: true });
    step('Vista vertical de tablet y móvil sin desbordamiento');
    assert.deepStrictEqual(errors, []);
    ok = true;
    console.log(`\nEditor para tablet E2E OK. Capturas y video en ${SHOTS}`);
  } catch (e) {
    console.error('FALLO:', e.stack || e.message, errors);
    await p.screenshot({ path: path.join(SHOTS, 'tablet-fallo.png') }).catch(() => {});
  } finally { await browser.close(); srv.close(); process.exitCode = ok ? 0 : 1; }
})();
