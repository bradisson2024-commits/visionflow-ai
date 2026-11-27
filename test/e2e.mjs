// Prueba de extremo a extremo a través de la interfaz real (Playwright + Chromium):
// abre Crear Video, escribe título y guion, elige 2D Stickman, voz y música, genera el video,
// verifica escenas/imágenes/consistencia de personajes/narración/música, reproduce,
// descarga el MP4 y lo vuelve a abrir desde Biblioteca.
// Los proveedores de IA se sustituyen por test/mock-providers.mjs (ver aviso en ese archivo).
import { spawn, execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TMP = path.join(ROOT, 'test', '.tmp');
fs.rmSync(TMP, { recursive: true, force: true });
fs.mkdirSync(TMP, { recursive: true });
const SHOTS = path.join(TMP, 'screenshots');
fs.mkdirSync(SHOTS, { recursive: true });

const MOCK = 5291, APP = 5290;
const mockUrl = `http://127.0.0.1:${MOCK}`;
const procs = [];
function start(cmd, args, env, ready) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { cwd: ROOT, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    procs.push(p);
    let out = '';
    const on = d => { out += d; process.stdout.write(`  [${path.basename(args.at(-1))}] ${d}`); if (out.includes(ready)) resolve(p); };
    p.stdout.on('data', on); p.stderr.on('data', on);
    p.on('exit', c => reject(new Error(`${args.join(' ')} terminó (${c})`)));
  });
}
const cleanup = () => procs.forEach(p => p.kill());
process.on('exit', cleanup);

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? '✔' : '✖'} ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) throw new Error('Falló: ' + name + ' ' + detail);
}

const SCRIPT = `Tomás salió de la oficina cuando ya era de noche. La calle estaba vacía y solo se oía el sonido de sus pasos sobre el asfalto mojado.

Caminó hasta la estación con las manos en los bolsillos, pensando en todo lo que había salido mal ese día. Había perdido el proyecto en el que llevaba meses trabajando.

En el andén, un anciano con un paraguas rojo le sonrió y se sentó a su lado. Le preguntó por qué parecía tan triste.

Cuando llegó el tren, Tomás se dio la vuelta para darle las gracias, pero el banco estaba vacío. Solo quedaba el paraguas rojo, apoyado contra la pared.`;

try {
  await start('node', ['test/mock-providers.mjs'], { MOCK_PORT: String(MOCK) }, 'mock providers on');
  await start('node', ['--disable-warning=ExperimentalWarning', 'server/src/index.js'], {
    PORT: String(APP), VIMO_DATA_DIR: path.join(TMP, 'data'),
    VIMO_ANTHROPIC_BASE_URL: mockUrl, VIMO_OPENAI_BASE_URL: mockUrl, VIMO_ELEVENLABS_BASE_URL: mockUrl,
    ANTHROPIC_API_KEY: '', OPENAI_API_KEY: '', ELEVENLABS_API_KEY: '',
  }, 'Vimo escuchando');

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  page.on('pageerror', e => console.log('  [browser error]', e.message));
  const base = `http://127.0.0.1:${APP}`;

  // ---- Claves API (se introducen por la interfaz) ----
  await page.goto(base + '/#/claves');
  for (const label of ['Anthropic (Claude)', 'OpenAI', 'ElevenLabs']) {
    const card = page.locator('.card.section', { has: page.locator('b', { hasText: new RegExp(`^${label.replace(/[()]/g, '\\$&')}$`) }) });
    await card.locator('input[type=password]').fill('test-key-' + label.length);
    await card.getByRole('button', { name: 'Guardar' }).click();
    await card.getByText('Configurada').waitFor();
    await card.getByRole('button', { name: 'Probar conexión' }).click();
    await card.getByText('Conexión correcta.').waitFor();
  }
  check('Claves API guardadas y probadas desde la interfaz', true);

  // Esta prueba cubre los proveedores de pago (la gratuita está en e2e-free.mjs): música con ElevenLabs.
  await fetch(`http://127.0.0.1:${APP}/api/settings`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ music_provider: 'elevenlabs' }) });

  // ---- 1–4. Crear Video ----
  await page.goto(base + '/#/crear');
  await page.getByRole('heading', { name: 'Crear Video' }).waitFor();
  const navTexts = await page.locator('.nav-item span').allTextContents();
  check('Panel lateral con los 11 módulos en orden', JSON.stringify(navTexts) === JSON.stringify(['Crear Video', 'Biblioteca', 'Personajes', 'Extensión', 'Avatares', 'Voces', 'Música IA', 'Demo', 'Claves API', 'Licencia', 'Ajustes']), navTexts.join(', '));
  await page.getByPlaceholder('Ej.: El hombre que caminaba solo').fill('El último tren (prueba)');
  await page.getByPlaceholder(/Escribe o pega aquí el guion/).fill(SCRIPT);
  const counter = await page.locator('.section-title .right').filter({ hasText: 'palabras' }).innerText();
  check('Contador de palabras del guion', /\b10\d\b|\b9\d\b/.test(counter), counter.replace(/\n/g, ' '));
  const cards = await page.locator('.catalog .style-card').count();
  check('Catálogo con 38 tarjetas de estilo', cards === 38, `${cards}`);
  await page.locator('.style-card', { hasText: 'Terror' }).click();
  await page.locator('.style-card', { hasText: '2D Stickman' }).first().click();
  const selected = await page.locator('.style-card.selected .name').innerText();
  check('Estilo 2D Stickman seleccionado (contorno dorado)', selected === '2D Stickman', selected);
  await page.screenshot({ path: path.join(SHOTS, '01-crear-video.png'), fullPage: true });

  // Voz: OpenAI TTS → Nova
  await page.getByRole('button', { name: /Elegir voz|Alloy|Voz de prueba/ }).first().click();
  await page.locator('.modal .seg button', { hasText: 'OpenAI TTS' }).click();
  await page.locator('.modal .list-row', { hasText: 'Nova' }).getByRole('button', { name: 'Usar' }).click();
  await page.getByRole('button', { name: /Nova/ }).waitFor();
  // Música IA: Suspenso
  await page.getByRole('button', { name: 'Más opciones' }).click();
  await page.locator('.seg button', { hasText: 'Música IA' }).click();
  await page.locator('select').filter({ has: page.locator('option', { hasText: 'Suspenso' }) }).selectOption('suspenso');
  await page.getByRole('button', { name: 'Crear video', exact: true }).click();

  // ---- 5–10. Generación con progreso real ----
  await page.waitForURL(/#\/proyecto\//);
  const projectId = page.url().split('/').pop();
  const seenStages = new Set();
  const t0 = Date.now();
  while (Date.now() - t0 < 300_000) {
    const label = await page.locator('.stage.current').innerText().catch(() => null);
    if (label) seenStages.add(label.trim());
    if (await page.locator('video.player').count()) break;
    if (await page.getByText('La generación se detuvo').count()) throw new Error('La generación falló: ' + await page.locator('.alert').first().innerText());
    if (seenStages.size === 3) await page.screenshot({ path: path.join(SHOTS, '02-progreso.png') });
    await page.waitForTimeout(250);
  }
  check('Progreso por etapas visible durante la generación', seenStages.size >= 2, [...seenStages].join(' → '));
  await page.locator('video.player').waitFor();
  check('Video finalizado', await page.locator('.chip.ok', { hasText: 'Terminado' }).count() === 1);
  await page.screenshot({ path: path.join(SHOTS, '03-proyecto-terminado.png'), fullPage: true });

  // ---- Verificaciones sobre los datos reales del proyecto ----
  const p = await (await fetch(`${base}/api/projects/${projectId}`)).json();
  const calls = await (await fetch(`${mockUrl}/__calls`)).json();
  check('Guion dividido en escenas', p.scenes.length >= 4, `${p.scenes.length} escenas`);
  const joined = p.scenes.map(s => s.narration).join(' ').replace(/\s+/g, ' ');
  check('Narración de las escenas = guion completo y en orden', joined === SCRIPT.replace(/\s+/g, ' ').trim());
  const ok = p.scenes.every(s => s.narration && s.visual_description && s.shot && s.emotion && s.location && s.image_prompt && s.est_duration > 0);
  check('Cada escena tiene narración, descripción, lugar, emoción, encuadre, prompt y duración', ok);
  const imgCalls = calls.filter(c => c.kind === 'image');
  const sceneImgCalls = imgCalls.filter(c => c.prompt?.includes('SCENE: '));
  const hashes = p.scenes.map(s => crypto.createHash('md5').update(fs.readFileSync(path.join(TMP, 'data', 'media', decodeURIComponent(s.image_url.split('?')[0].replace('/media/', ''))))).digest('hex'));
  check('Una imagen distinta por escena (sin repetir)', new Set(hashes).size === p.scenes.length, `${new Set(hashes).size}/${p.scenes.length}`);
  const promptMatches = p.scenes.every(s => sceneImgCalls.some(c => c.prompt.includes(`SCENE: ${s.image_prompt}`) && c.prompt.includes('2D stickman illustration')));
  check('El prompt de cada imagen contiene su escena + el bloque de estilo 2D Stickman', promptMatches);
  const tomasScenes = p.scenes.filter(s => s.characters.includes('tomas'));
  const refCalls = sceneImgCalls.filter(c => c.prompt.includes('Tomás:'));
  check('Consistencia: referencia de personaje creada y enviada en sus escenas',
    imgCalls.some(c => c.prompt?.includes('CHARACTER REFERENCE SHEET') && c.prompt.includes('Tomás')) && refCalls.length === tomasScenes.length && refCalls.every(c => c.refs >= 1),
    `${tomasScenes.length} escenas con Tomás, ${refCalls.filter(c => c.refs >= 1).length} con imagen de referencia adjunta`);
  const sameDesc = refCalls.every(c => c.prompt.includes('Tomás: stickman man, messy black hair, mustard yellow scarf, grey coat'));
  check('Consistencia: misma ficha visual del personaje en todas sus escenas', sameDesc);
  const tts = calls.filter(c => c.kind === 'tts');
  check('Narración generada por escena con la voz elegida', tts.length === p.scenes.length && tts.every(c => c.voice === 'nova'), `${tts.length} llamadas TTS, voz ${tts[0]?.voice}`);
  check('Música IA generada', calls.some(c => c.kind === 'music') && !!p.music_url);

  // ---- MP4 real ----
  const dl = page.waitForEvent('download');
  await page.getByRole('link', { name: 'Descargar MP4' }).click();
  const download = await dl;
  const mp4 = path.join(TMP, 'descarga.mp4');
  await download.saveAs(mp4);
  const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type,codec_name,width,height:format=duration', '-of', 'json', mp4]));
  const v = probe.streams.find(s => s.codec_type === 'video'), a = probe.streams.find(s => s.codec_type === 'audio');
  const dur = Number(probe.format.duration);
  const expected = p.scenes.reduce((x, s) => x + s.duration, 0);
  check('MP4 descargado con video H.264 1920x1080 y audio AAC', v?.codec_name === 'h264' && v.width === 1920 && v.height === 1080 && a?.codec_name === 'aac', `${download.suggestedFilename()} ${(fs.statSync(mp4).size / 1e6).toFixed(1)} MB`);
  check('Duración del video = suma de escenas (narración sincronizada)', Math.abs(dur - expected) < 0.25, `${dur.toFixed(2)} s vs ${expected.toFixed(2)} s`);
  // Reproducción en el navegador.
  const played = await page.evaluate(async () => {
    const vid = document.querySelector('video.player');
    vid.muted = true;
    await vid.play();
    await new Promise(r => setTimeout(r, 1500));
    return { t: vid.currentTime, w: vid.videoWidth, d: vid.duration };
  });
  check('El video se reproduce en la aplicación', played.t > 0.5 && played.w === 1920, `t=${played.t.toFixed(2)} s, ${played.w}px, ${played.d.toFixed(1)} s`);

  // ---- 13–14. Guardado y Biblioteca ----
  await page.goto(base + '/#/biblioteca');
  const card = page.locator('.proj', { hasText: 'El último tren (prueba)' });
  await card.waitFor();
  check('Proyecto guardado en la base de datos y listado en Biblioteca', await card.locator('.chip.ok').count() === 1);
  await page.screenshot({ path: path.join(SHOTS, '04-biblioteca.png'), fullPage: true });
  await card.locator('.thumb').click();
  await page.locator('video.player').waitFor();
  check('Proyecto reabierto desde Biblioteca con su video', (await page.locator('.scene').count()) === p.scenes.length);

  // Personajes detectados guardados para reutilizar.
  await page.goto(base + '/#/personajes');
  await page.getByText('Tomás').first().waitFor();
  check('Personajes detectados guardados en «Personajes» con su referencia', await page.locator('.card.section img').count() >= 1);
  await page.screenshot({ path: path.join(SHOTS, '05-personajes.png'), fullPage: true });

  // Persistencia tras reiniciar el servidor: los datos siguen ahí.
  const before = await (await fetch(`${base}/api/projects`)).json();
  check('Proyectos persistidos', before.length === 1 && before[0].video_url);

  // Extensión: continuar el video y re-renderizar.
  await page.goto(base + '/#/extension');
  await page.locator('select').selectOption(projectId);
  await page.getByPlaceholder('Escribe cómo continúa la historia…').fill('Tomás subió al tren con el paraguas rojo en la mano. Por la ventana, la ciudad brillaba como nunca.');
  await page.getByRole('button', { name: 'Extender video' }).click();
  await page.waitForURL(/#\/proyecto\//);
  const t1 = Date.now();
  let ext;
  while (Date.now() - t1 < 180_000) {
    ext = await (await fetch(`${base}/api/projects/${projectId}`)).json();
    if (!ext.job && ext.status === 'done' && ext.scenes.length > p.scenes.length) break;
    if (ext.status === 'failed') throw new Error(ext.error);
    await new Promise(r => setTimeout(r, 500));
  }
  check('Extensión: escenas añadidas y video re-renderizado', ext.scenes.length > p.scenes.length && ext.duration > p.duration, `${p.scenes.length} → ${ext.scenes.length} escenas, ${p.duration.toFixed(1)} → ${ext.duration.toFixed(1)} s`);

  // Pantallas secundarias cargan sin errores.
  for (const r of ['voces', 'musica', 'avatares', 'demo', 'licencia', 'ajustes']) {
    await page.goto(base + '/#/' + r);
    await page.locator('.page-title').waitFor();
  }
  await page.goto(base + '/#/musica');
  await page.locator('.list-row').first().waitFor();
  await page.screenshot({ path: path.join(SHOTS, '06-musica.png'), fullPage: true });
  check('Pantallas Voces, Música IA, Avatares, Demo, Licencia y Ajustes cargan', true);

  await browser.close();
  console.log(`\n${results.filter(r => r.ok).length}/${results.length} comprobaciones superadas. Capturas en ${SHOTS}`);
  fs.writeFileSync(path.join(TMP, 'results.json'), JSON.stringify(results, null, 2));
  cleanup();
  process.exit(0);
} catch (e) {
  console.error('\nPRUEBA FALLIDA:', e.message);
  cleanup();
  process.exit(1);
}
