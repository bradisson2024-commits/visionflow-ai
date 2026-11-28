// Prueba de extremo a extremo de la configuración GRATUITA, a través de la interfaz real:
//   Guion/escenas: Ollama · Imágenes: ComfyUI · Voz: Piper · Música: compositor local · Render: FFmpeg
//
// QUÉ ES REAL Y QUÉ NO:
//   - REAL: Piper (se instala desde GitHub con el botón de la app y sintetiza voz en español con un
//     modelo de voz real), el compositor de música local, FFmpeg y todo el código de Vimo.
//   - SIMULADO (test/mock-providers.mjs): las respuestas de Ollama y ComfyUI, porque en el entorno de
//     pruebas no hay red hacia Hugging Face/Ollama ni GPU. El simulado VALIDA que el flujo enviado a
//     ComfyUI sea un grafo correcto (nodos, entradas obligatorias, enlaces) y devuelve tarjetas con el
//     texto de la escena en lugar de imágenes de IA.
import { spawn, execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TMP = path.join(ROOT, 'test', '.tmp-free');
const CACHE = path.join(ROOT, 'test', '.cache');
fs.rmSync(TMP, { recursive: true, force: true });
fs.mkdirSync(path.join(TMP, 'screenshots'), { recursive: true });
fs.mkdirSync(CACHE, { recursive: true });
const SHOTS = path.join(TMP, 'screenshots');

// Voz real de Piper en español (publicada en GitHub por el proyecto Piper).
const VOICE_TGZ = path.join(CACHE, 'voice-es-mls_10246-low.tar.gz');
if (!fs.existsSync(path.join(CACHE, 'es-mls_10246-low.onnx'))) {
  execFileSync('curl', ['-sSL', '-o', VOICE_TGZ, 'https://github.com/rhasspy/piper/releases/download/v0.0.2/voice-es-mls_10246-low.tar.gz']);
  execFileSync('tar', ['-xzf', VOICE_TGZ, '-C', CACHE]);
}

const MOCK = 5293, APP = 5292;
const mockUrl = `http://127.0.0.1:${MOCK}`;
const procs = [];
function start(args, env, ready) {
  return new Promise((resolve, reject) => {
    const p = spawn('node', args, { cwd: ROOT, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    procs.push(p);
    let out = '';
    const on = d => { out += d; if (out.includes(ready)) resolve(p); };
    p.stdout.on('data', on); p.stderr.on('data', d => { on(d); process.stderr.write('  [srv] ' + d); });
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
  await start(['test/mock-providers.mjs'], { MOCK_PORT: String(MOCK), PIPER_VOICE_SRC: CACHE }, 'mock providers on');
  await start(['--disable-warning=ExperimentalWarning', 'server/src/index.js'], {
    PORT: String(APP), VIMO_DATA_DIR: path.join(TMP, 'data'), VIMO_PIPER_VOICES_URL: `${mockUrl}/piper-voices/`,
    ANTHROPIC_API_KEY: '', OPENAI_API_KEY: '', ELEVENLABS_API_KEY: '', GEMINI_API_KEY: '', REPLICATE_API_TOKEN: '', GROQ_API_KEY: '',
  }, 'Vimo escuchando');
  const base = `http://127.0.0.1:${APP}`;
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  page.on('pageerror', e => console.log('  [browser error]', e.message));

  // ---- Modo gratuito activado de fábrica: no se usan ni se muestran servicios que piden saldo ----
  const def = (await (await fetch(base + '/api/settings')).json()).values;
  check('De fábrica: modo gratuito y proveedores gratis (Gemini, ComfyUI, Piper, música local)', def.free_only === 'on' && def.llm_provider === 'gemini' && def.image_provider === 'comfyui' && def.tts_provider === 'piper' && def.music_provider === 'local');
  // Aunque se guarde un proveedor de pago, en modo gratuito nunca se usa.
  await fetch(base + '/api/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ llm_provider: 'anthropic', image_provider: 'openai' }) });
  const forced = (await (await fetch(base + '/api/settings')).json()).values;
  check('En modo gratuito un proveedor de pago guardado se sustituye por el gratis', forced.llm_provider === 'gemini' && forced.image_provider === 'comfyui');
  await page.goto(base + '/#/claves');
  await page.locator('.card.section b', { hasText: 'Google Gemini' }).waitFor();
  check('Claves de pago (Anthropic, OpenAI, Replicate) ocultas en modo gratuito', await page.locator('.card.section b', { hasText: /^(Anthropic \(Claude\)|OpenAI|Replicate)$/ }).count() === 0);

  // ---- Ajustes: un clic para la configuración gratuita; luego Ollama para el guion ----
  await page.goto(base + '/#/ajustes');
  const llmOpts = await page.locator('label.field', { hasText: 'Proveedor' }).first().locator('option').allTextContents();
  check('El selector de proveedor no ofrece opciones de pago', !llmOpts.some(o => /de pago/.test(o)), llmOpts.join(' | '));
  await page.getByRole('button', { name: 'Usar configuración gratuita' }).click();
  await page.getByText('Configuración gratuita aplicada').waitFor();
  const sel = label => page.locator('label.field', { hasText: label }).locator('select');
  const inp = label => page.locator('label.field', { hasText: label }).locator('input');
  await sel('Proveedor').first().selectOption('ollama');
  await inp('Dirección de Ollama').fill(mockUrl);
  await inp('Dirección de ComfyUI').fill(mockUrl);
  await page.getByRole('button', { name: 'Guardar ajustes' }).click();
  await page.getByText('Ajustes guardados').waitFor();
  await page.reload();
  await inp('Modelo de Ollama').waitFor();
  await page.locator('.hint', { hasText: '2 disponibles en el servicio' }).first().waitFor();
  await page.getByRole('button', { name: /Stable Diffusion 1.5/ }).click();
  await page.waitForTimeout(400);
  const settings = (await (await fetch(base + '/api/settings')).json()).values;
  check('Configuración gratuita: Ollama + ComfyUI + Piper + música local', settings.llm_provider === 'ollama' && settings.image_provider === 'comfyui' && settings.tts_provider === 'piper' && settings.music_provider === 'local');
  check('Ajustes lee los modelos reales del servicio (Ollama) y aplica el preajuste SD 1.5', settings.comfyui_preset === 'sd15' && settings.comfyui_width === '912');
  await page.screenshot({ path: path.join(SHOTS, '01-ajustes-gratis.png'), fullPage: true });

  // ---- Claves API → Servicios locales: estado real e instalación de Piper ----
  await page.goto(base + '/#/claves');
  await page.locator('.list-row', { hasText: 'Voz' }).getByText('Piper no está instalado').waitFor();
  check('El estado muestra claramente lo que falta (Piper no instalado)', true);
  await page.getByRole('button', { name: /Instalar Piper/ }).click();
  await page.getByText('Piper instalado').waitFor({ timeout: 180_000 });
  check('Piper instalado desde la interfaz (descarga real desde GitHub)', true);

  // ---- Voces → Piper: descargar una voz en español y elegirla ----
  await page.goto(base + '/#/voces');
  await page.locator('.seg button', { hasText: 'Piper (gratis)' }).click();
  const row = page.locator('.list-row', { hasText: 'mls_10246' });
  await row.getByRole('button', { name: 'Descargar' }).click();
  await row.getByRole('button', { name: 'Usar' }).waitFor({ timeout: 180_000 });
  await row.locator('.icon-btn').first().click(); // escucha previa real
  await page.waitForFunction(() => performance.getEntriesByType('resource').some(r => r.name.includes('/media/voices/piper_')), null, { timeout: 60_000 });
  check('Previsualización de voz generada en vivo con Piper', true);
  await row.getByRole('button', { name: 'Usar' }).click();
  await page.getByText(/Voz por defecto: mls_10246/).first().waitFor();
  await page.screenshot({ path: path.join(SHOTS, '02-voces-piper.png'), fullPage: true });

  await page.goto(base + '/#/claves');
  await page.locator('.chip.ok', { hasText: 'Todo listo' }).waitFor({ timeout: 20_000 });
  check('Todos los servicios gratuitos conectados («Todo listo»)', true);
  await page.screenshot({ path: path.join(SHOTS, '03-servicios.png'), fullPage: true });

  // ---- Crear Video: generar guion con IA (Ollama), sugerir títulos, luego el guion de prueba ----
  await page.goto(base + '/#/crear');
  await page.getByRole('button', { name: 'Escribir con IA' }).click();
  await page.locator('.modal input').first().fill('El último tren');
  await page.getByRole('button', { name: 'Generar guion' }).click();
  await page.getByText('Guion generado').waitFor();
  const gen = await page.locator('textarea.script').inputValue();
  check('Guion generado con IA local (Ollama)', gen.includes('generado localmente'), gen.slice(0, 60));
  await page.getByPlaceholder('Ej.: El hombre que caminaba solo').fill('El último tren');
  await page.getByRole('button', { name: 'Sugerir títulos' }).click();
  await page.getByRole('button', { name: 'Título de prueba 2' }).click();
  check('Títulos sugeridos con IA y aplicados', await page.getByPlaceholder('Ej.: El hombre que caminaba solo').inputValue() === 'Título de prueba 2');
  await page.getByPlaceholder('Ej.: El hombre que caminaba solo').fill('El último tren (gratis)');
  await page.locator('textarea.script').fill(SCRIPT);
  await page.locator('.style-card', { hasText: '2D Stickman' }).first().click();
  check('Voz Piper preseleccionada en la narración', await page.getByRole('button', { name: /mls_10246/ }).count() === 1);
  await page.getByRole('button', { name: 'Más opciones' }).click();
  await page.locator('.seg button', { hasText: 'Música IA' }).click();
  await page.locator('select').filter({ has: page.locator('option', { hasText: 'Suspenso' }) }).selectOption('suspenso');
  await page.screenshot({ path: path.join(SHOTS, '04-crear-video.png'), fullPage: true });
  await page.getByRole('button', { name: 'Crear video', exact: true }).click();

  await page.waitForURL(/#\/proyecto\//);
  const id = page.url().split('/').pop();
  const t0 = Date.now();
  while (Date.now() - t0 < 600_000) {
    if (await page.locator('video.player').count()) break;
    if (await page.getByText('La generación se detuvo').count()) throw new Error('Falló: ' + await page.locator('.alert').first().innerText());
    if (Date.now() - t0 > 1500 && !fs.existsSync(path.join(SHOTS, '05-progreso.png'))) await page.screenshot({ path: path.join(SHOTS, '05-progreso.png') });
    await page.waitForTimeout(300);
  }
  await page.locator('video.player').waitFor();
  await page.screenshot({ path: path.join(SHOTS, '06-terminado.png'), fullPage: true });

  const p = await (await fetch(`${base}/api/projects/${id}`)).json();
  const calls = await (await fetch(`${mockUrl}/__calls`)).json();
  const last = await (await fetch(`${base}/api/projects/${id}`)).json();
  check('Comprobación previa de servicios registrada', (last.last_job?.log || []).some(l => l.includes('✓ Imágenes: ComfyUI')));
  check('Escenas creadas por Ollama con salida estructurada (JSON Schema)', p.scenes.length >= 4 && calls.some(c => c.provider === 'ollama' && c.schema));
  const comfy = calls.filter(c => c.provider === 'comfyui');
  check('ComfyUI recibió flujos válidos (nodos, entradas y enlaces correctos)', comfy.length >= p.scenes.length && comfy.every(c => !c.errors.length), `${comfy.length} trabajos`);
  check('Prompt compacto con estilo 2D Stickman + escena + personaje', p.scenes.every(s => comfy.some(c => c.prompt?.startsWith('2D stickman illustration') && c.prompt.includes(s.image_prompt))));
  check('Mismas fichas de personaje en sus escenas', comfy.filter(c => c.prompt?.includes('Tomás:')).every(c => c.prompt.includes('Tomás: stickman man, messy black hair, mustard yellow scarf, grey coat')));
  const seeds = comfy.filter(c => !c.prompt.includes('reference sheet')).map(c => c.seed);
  check('Semillas estables por proyecto (consistencia) y tamaño SD 1.5', new Set(seeds).size === seeds.length && comfy.every(c => c.size === '912x512' || c.size === '640x640'), comfy.map(c => c.size).join(','));
  check('Narración real de Piper en cada escena', p.scenes.every(s => s.audio_url && s.audio_duration > 1), p.scenes.map(s => s.audio_duration.toFixed(1) + 's').join(', '));
  const tracks = await (await fetch(`${base}/api/music`)).json();
  check('Música compuesta localmente (gratis)', tracks.some(t => t.source === 'local') && !!p.music_url);

  const dl = page.waitForEvent('download');
  await page.getByRole('link', { name: 'Descargar MP4' }).click();
  const mp4 = path.join(TMP, 'video.mp4');
  await (await dl).saveAs(mp4);
  const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type,codec_name,width,height:format=duration', '-of', 'json', mp4]));
  const v = probe.streams.find(s => s.codec_type === 'video'), a = probe.streams.find(s => s.codec_type === 'audio');
  const dur = Number(probe.format.duration), expected = p.scenes.reduce((x, s) => x + s.duration, 0);
  check('MP4 válido descargado (H.264 1920x1080 + AAC)', v?.codec_name === 'h264' && v.width === 1920 && a?.codec_name === 'aac', `${(fs.statSync(mp4).size / 1e6).toFixed(1)} MB`);
  check('Duración = suma de escenas (voz sincronizada con imágenes)', Math.abs(dur - expected) < 0.25, `${dur.toFixed(2)} s`);
  const vol = execFileSync('ffmpeg', ['-hide_banner', '-i', mp4, '-af', 'volumedetect', '-vn', '-f', 'null', '-'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  void vol;
  const volOut = String(execFileSync('sh', ['-c', `ffmpeg -hide_banner -i "${mp4}" -af volumedetect -vn -f null - 2>&1 | grep mean_volume`]));
  const mean = Number(volOut.match(/mean_volume: (-?[\d.]+)/)[1]);
  check('El audio del video tiene voz y música (no es silencio)', mean > -35, `volumen medio ${mean} dB`);
  const played = await page.evaluate(async () => { const vid = document.querySelector('video.player'); vid.muted = true; await vid.play(); await new Promise(r => setTimeout(r, 1500)); return vid.currentTime; });
  check('El video se reproduce en la app', played > 0.5, `t=${played.toFixed(2)} s`);
  await page.goto(base + '/#/biblioteca');
  await page.locator('.proj', { hasText: 'El último tren (gratis)' }).locator('.chip.ok').waitFor();
  check('Guardado en Biblioteca', true);
  // Regenerar una escena individual con ComfyUI.
  await page.goto(base + '/#/proyecto/' + id);
  const before = comfy.length;
  await page.locator('.scene').nth(1).locator('.icon-btn[title="Regenerar imagen"]').click();
  await page.locator('.alert.warn', { hasText: 'Hay cambios que aún no están en el video' }).waitFor({ timeout: 60_000 });
  const after = (await (await fetch(`${mockUrl}/__calls`)).json()).filter(c => c.provider === 'comfyui').length;
  check('Regenerar una escena individual con ComfyUI', after === before + 1);
  await page.goto(base + '/#/musica');
  await page.locator('.list-row').first().waitFor();
  await page.screenshot({ path: path.join(SHOTS, '07-musica.png'), fullPage: true });

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
