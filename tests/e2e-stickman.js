'use strict';
// Prueba del Motor Stickman del Editor para tablet (tablet/editor-tablet.html).
// La respuesta de Claude se SUSTITUYE por una respuesta de prueba (doble de pruebas claramente marcado):
// esta prueba no puede llamar al Claude real. Comprueba todo lo demás de verdad: envío de imágenes por
// lotes, validación y aplicación del orden, sincronización con PAUSAS REALES de un audio, clips de video
// con su movimiento original, correcciones manuales y exportación MP4 validada con FFprobe.
const { chromium } = require('playwright');
const { execFileSync } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { tmpDir } = require('./helpers');

const MUXER = process.env.YA_MP4MUXER;
const PORT = 5997;
const SHOTS = process.env.YA_SHOTS || tmpDir('ya-shots-');
const step = m => console.log('✓', m);
const ff = args => execFileSync('ffmpeg', ['-loglevel', 'error', '-y', ...args]);

(async () => {
  if (!MUXER || !fs.existsSync(MUXER)) { console.error('Define YA_MP4MUXER'); process.exit(2); }
  const dir = tmpDir('ya-stick-');
  // Nombres desordenados, como los que salen de Flow
  const imgA = path.join(dir, 'a7f3c2.png'), imgB = path.join(dir, '0b91e4.png'), clip = path.join(dir, 'zz_clip.mp4');
  ff(['-f', 'lavfi', '-i', 'color=c=blue:s=640x360', '-frames:v', '1', imgA]);
  ff(['-f', 'lavfi', '-i', 'color=c=red:s=640x360', '-frames:v', '1', imgB]);
  // Clip animado de 2 s: una caja blanca que se desplaza (movimiento real que debe conservarse)
  ff(['-f', 'lavfi', '-i', 'color=c=black:s=640x360:d=2:r=30', '-vf', "drawbox=x='20+t*250':y=130:w=100:h=100:color=white:t=fill", '-c:v', 'libx264', '-pix_fmt', 'yuv420p', clip]);
  // Voz de 8 s con pausas reales en 2.0–2.6 s y 5.0–5.5 s
  const voz = path.join(dir, 'voz.wav');
  ff(['-f', 'lavfi', '-i', "aevalsrc='0.5*sin(2*PI*220*t)*(between(t,0,2)+between(t,2.6,5)+between(t,5.5,8))':s=44100:d=8", voz]);
  // Narración: longitudes engañosas (por longitud de texto los cortes caerían lejos de las pausas)
  const lines = ['El stickman azul camina.', 'De repente descubre una caja misteriosa en el camino, se sorprende muchísimo y no sabe qué hacer con ella.', 'Huye corriendo.'];
  const txt = path.join(dir, 'narracion.txt'); fs.writeFileSync(txt, lines.join('\n'));

  const page = fs.readFileSync(path.join(__dirname, '../tablet/editor-tablet.html'), 'utf8');
  const html = `<!doctype html><html><head><meta charset=utf8><meta name=viewport content="width=device-width,initial-scale=1,viewport-fit=cover"><style>[hidden]{display:none!important}</style></head><body>${page}</body></html>`;
  const srv = http.createServer((q, r) => { r.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); r.end(html); }).listen(PORT, '127.0.0.1');
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  await ctx.route('https://cdn.jsdelivr.net/npm/mp4-muxer@5.1.3/build/mp4-muxer.js', r => r.fulfill({ body: fs.readFileSync(MUXER), contentType: 'text/javascript' }));
  // DOBLE DE PRUEBAS de la capacidad "sample" (Claude) y "downloads" del visor.
  await ctx.addInitScript(() => {
    window.__calls = []; window.__saved = null;
    // img_1 = 0b91e4.png, img_2 = a7f3c2.png, img_3 = zz_clip.mp4 (orden por nombre, que NO es el de la historia)
    const describe = { img_2: { accion_principal: 'camina por el camino', personajes: [{ color: 'azul', accion: 'caminar', pose: 'paso adelante' }], resumen: 'Stickman azul caminando' },
      img_1: { accion_principal: 'se sorprende ante una caja', personajes: [{ color: 'azul', accion: 'sorprenderse', pose: 'brazos arriba' }], objetos: ['caja'], resumen: 'Stickman azul sorprendido junto a una caja' },
      img_3: { accion_principal: 'corre huyendo', personajes: [{ color: 'azul', accion: 'correr', pose: 'piernas abiertas' }], resumen: 'Stickman azul corriendo' } };
    const sample = async () => ({ text: '' });
    sample.limits = async () => ({ maxInputBytes: 200000, images: { maxCount: 2, maxBytes: 5e6, mediaTypes: ['image/jpeg', 'image/png'] } });
    sample.json = async (prompt, opts = {}) => {
      window.__calls.push({ prompt, images: opts.images ? opts.images.length : 0, types: opts.images ? opts.images.map(b => b.type) : [] });
      if (opts.images) { const ids = [...prompt.matchAll(/id "(img_\d+)"/g)].map(m => m[1]); return ids.map(id => ({ id, ...describe[id] })); }
      // Orden narrativo de prueba: caminar (img_2) → sorprenderse (img_1) → correr (img_3)
      return { personajes: [{ id: 'P1', color: 'azul', descripcion: 'protagonista' }],
        escenas: [{ imagen: 'img_2', desde: 1, hasta: 1, accion: 'caminar', personajes: ['P1'], confianza: 0.9, motivo: 'camina' },
          { imagen: 'img_1', desde: 2, hasta: 2, accion: 'sorprenderse ante la caja', personajes: ['P1'], confianza: 0.85, motivo: 'descubre la caja' },
          { imagen: 'img_3', desde: 3, hasta: 3, accion: 'correr', personajes: ['P1'], confianza: 0.4, motivo: 'huye' }] };
    };
    window.claude = { use: async n => n === 'sample' ? sample : n === 'downloads' ? { save: async ({ filename, data }) => { window.__saved = { filename, bytes: Array.from(new Uint8Array(await data.arrayBuffer())) }; return { status: 'saved' }; } } : null };
  });
  const p = await ctx.newPage();
  const errors = []; p.on('pageerror', e => errors.push(e.message));
  let ok = false;
  try {
    await p.goto(`http://127.0.0.1:${PORT}/`);
    // Cargados en orden "por nombre": 0b91e4 (rojo), a7f3c2 (azul), zz_clip (video) → ids img_1..img_3 en ese orden
    await p.setInputFiles('#filesInput', [imgA, imgB, clip]);
    await p.waitForFunction(() => document.getElementById('imgCount').textContent === '3 imágenes');
    assert.match(await p.textContent('#imgStatus'), /2 imágenes y 1 clips de video/);
    const loaded = await p.evaluate(() => window.__editor.state.images.map(i => [i.id, i.name, i.kind]));
    assert.deepStrictEqual(loaded, [['img_1', '0b91e4.png', 'image'], ['img_2', 'a7f3c2.png', 'image'], ['img_3', 'zz_clip.mp4', 'video']]);
    assert.ok(Math.abs((await p.evaluate(() => window.__editor.state.durations[2])) - 2) < 0.1, 'el clip toma su duración real');
    step('Imágenes y clip de video Stickman cargados (el clip con su duración real de 2 s)');

    await p.setInputFiles('#audioInput', voz);
    await p.waitForFunction(() => document.getElementById('audioState').textContent === 'Cargado ✓');
    await p.setInputFiles('#textInput', txt);
    await p.waitForFunction(() => /3 líneas/.test(document.getElementById('textInfo').textContent));

    // Motor Stickman
    await p.click('#aiBtn');
    await p.waitForFunction(() => /✓ Historia ordenada/.test(document.getElementById('aiStatus').textContent), null, { timeout: 30000 });
    const calls = await p.evaluate(() => window.__calls);
    assert.deepStrictEqual(calls.map(c => c.images), [2, 1, 0], 'imágenes enviadas por lotes según el límite de la vista, y luego el orden');
    assert.ok(calls.slice(0, 2).every(c => c.types.every(t => t === 'image/jpeg')));
    assert.match(calls[1].prompt, /fotograma de un clip de video/);
    assert.match(calls[2].prompt, /2\. De repente descubre una caja/);
    assert.match(calls[2].prompt, /Stickman azul sorprendido junto a una caja/);
    step('Orden por la historia (no por el nombre de archivo). Análisis: imágenes enviadas a Claude por lotes (fotograma para el clip) y narración + descripciones para ordenar');

    const st = await p.evaluate(() => ({ names: window.__editor.state.images.map(i => i.name), slots: window.__editor.state.slots, durs: window.__editor.state.durations, dist: window.__editor.state.dist }));
    assert.deepStrictEqual(st.names, ['a7f3c2.png', '0b91e4.png', 'zz_clip.mp4'], 'reordenado por la historia, no por el nombre');
    assert.deepStrictEqual(st.slots, [{ desde: 1, hasta: 1 }, { desde: 2, hasta: 2 }, { desde: 3, hasta: 3 }]);
    const starts = [0, st.durs[0], st.durs[0] + st.durs[1]];
    assert.ok(Math.abs(starts[1] - 2.3) < 0.15 && Math.abs(starts[2] - 5.25) < 0.15, 'cortes en las pausas reales: ' + starts);
    assert.ok(Math.abs(st.durs.reduce((a, b) => a + b, 0) - 8) < 0.05);
    assert.match(st.dist.message, /2 de 2 cambios de escena caen en pausas reales/);
    assert.match(await p.textContent('#aiChars'), /P1 · azul/);
    step(`Sincronización con la voz: cambios de escena en ${starts[1].toFixed(2)} s y ${starts[2].toFixed(2)} s (pausas reales 2.0–2.6 y 5.0–5.5), no donde diría la longitud del texto`);

    // Información de la escena seleccionada
    await p.locator('.card').nth(1).click();
    const info = await p.textContent('#sceneInfo');
    assert.match(info, /Acción: sorprenderse ante la caja/);
    assert.match(info, /Personajes: P1 \(azul\)/);
    assert.match(info, /Frase narrada \(línea 2\): De repente descubre una caja/);
    assert.match(info, /Inicio 0:02\.\d\d/);
    assert.match(await p.textContent('#caption'), /De repente descubre una caja/);
    await p.locator('.card').nth(2).click();
    assert.match(await p.textContent('#sceneInfo'), /clip de video de 2\.\d\d s \(movimiento original\)/);
    assert.match(await p.textContent('#sceneInfo'), /los últimos .* se muestra su último fotograma/);
    assert.match(await p.textContent('#sceneInfo'), /coincidencia 40%/);
    step('Cada escena muestra imagen, acción, personajes, frase narrada, inicio, fin, duración y la coincidencia de la IA');

    // Corrección manual: mover la escena 1 a la derecha → cambian las imágenes, la narración se queda en su sitio
    await p.locator('.card').nth(0).click();
    await p.click('#moveR');
    assert.deepStrictEqual(await p.evaluate(() => window.__editor.state.images.map(i => i.name)), ['0b91e4.png', 'a7f3c2.png', 'zz_clip.mp4']);
    assert.match(await p.textContent('#caption'), /De repente descubre una caja/);
    await p.click('#moveL');
    await p.locator('.card').nth(0).click();
    await p.fill('#durEdit', '2.4'); await p.dispatchEvent('#durEdit', 'change');
    assert.strictEqual(await p.evaluate(() => window.__editor.state.durations[0]), 2.4);
    await p.click('#distributeBtn');   // volver a sincronizar con la voz
    step('Correcciones: mover escenas (la frase narrada se queda en su posición) y editar duraciones');

    // Exportar
    await p.selectOption('#qualitySel', '720p');
    await p.click('#exportBtn');
    await p.waitForFunction(() => window.__editor.job && window.__editor.job.state !== 'running', null, { timeout: 120000 });
    const job = await p.evaluate(() => window.__editor.job);
    assert.strictEqual(job.state, 'done', JSON.stringify(job.steps.filter(s => s.status === 'error')));
    assert.match(job.steps[4].detail, /1 clip con su movimiento original/);
    await p.screenshot({ path: path.join(SHOTS, 'stickman-editor.png') });
    await p.click('#saveBtn');
    await p.waitForFunction(() => window.__saved);
    const out = path.join(SHOTS, 'stickman-video.mp4');
    fs.writeFileSync(out, Buffer.from(await p.evaluate(() => window.__saved.bytes)));
    const dur = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', out]).toString());
    assert.ok(Math.abs(dur - 8) < 0.15, 'duración ' + dur);
    // ¿Puede este navegador leer fotogramas de video? (en servidores sin decodificación de video salen negros)
    const canDecode = await p.evaluate(async () => {
      const im = window.__editor.state.images.find(i => i.kind === 'video'); const v = im.video;
      await new Promise(r => { v.onseeked = r; v.currentTime = 1; setTimeout(r, 2000); });
      const c = document.createElement('canvas'); c.width = 64; c.height = 36; const x = c.getContext('2d'); x.drawImage(v, 0, 0, 64, 36);
      const d = x.getImageData(0, 0, 64, 36).data; let mx = 0; for (let i = 0; i < d.length; i += 4) mx = Math.max(mx, d[i]); return mx > 100;
    });
    if (!canDecode) {
      console.log('⚠ NO VERIFICADO EN ESTE ENTORNO: este Chromium devuelve fotogramas de video negros (sin decodificación de video), así que aquí no se puede comprobar el movimiento del clip en el MP4. Debe comprobarse en Chrome normal.');
    } else {
    // El clip conserva su movimiento: la caja blanca está en sitios distintos en dos instantes de su escena
    const xAt = t => { const raw = execFileSync('ffmpeg', ['-v', 'error', '-ss', String(t), '-i', out, '-frames:v', '1', '-vf', 'scale=128:72,format=gray', '-f', 'rawvideo', '-']);
      let sx = 0, n = 0; for (let y = 0; y < 72; y++) for (let x = 0; x < 128; x++) if (raw[y * 128 + x] > 200) { sx += x; n++; } return n ? sx / n : -1; };
    const v0 = starts[2] + 0.2, v1 = starts[2] + 1.6;
    const x0 = xAt(v0), x1 = xAt(v1);
    assert.ok(x0 > 0 && x1 > 0 && x1 - x0 > 20, `movimiento original del clip: x ${x0.toFixed(1)} → ${x1.toFixed(1)}`);
    const xHold1 = xAt(starts[2] + 2.3), xHold2 = xAt(7.8);
    assert.ok(Math.abs(xHold1 - xHold2) < 1.5, 'tras acabar el clip se mantiene el último fotograma (sin inventar movimiento)');
    step(`MP4 de 8 s: el clip conserva su movimiento (caja de x=${x0.toFixed(0)} a x=${x1.toFixed(0)}) y luego se queda quieto en su último fotograma`);
    }
    step(`MP4 de ${dur.toFixed(2)} s exportado y validado con FFprobe (imágenes con cámara digital + clip de video)`);

    assert.deepStrictEqual(errors, []);
    ok = true;
    console.log(`\nMotor Stickman E2E OK. Capturas en ${SHOTS}`);
  } catch (e) {
    console.error('FALLO:', e.stack || e.message, errors);
    await p.screenshot({ path: path.join(SHOTS, 'stickman-fallo.png') }).catch(() => {});
  } finally { await browser.close(); srv.close(); process.exitCode = ok ? 0 : 1; }
})();
