// E2E de la interfaz en Chromium: un usuario recorre la aplicación de verdad (PostgreSQL, FFmpeg y cola reales;
// YouTube y Gemini con los dobles locales de tests/fakes.js). Guarda capturas en E2E_SHOTS (o una carpeta temporal).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { startFakes } from './fakes.js';

const { chromium } = createRequire(import.meta.url)('playwright');
const SHOTS = process.env.E2E_SHOTS || fs.mkdtempSync(path.join(os.tmpdir(), 'cenit-shots-'));
const ok = (m) => console.log('✓', m);

execFileSync('su', ['postgres', '-c', 'dropdb --if-exists cenit_e2e; createdb cenit_e2e']);
const fakes = await startFakes();
Object.assign(process.env, fakes.env, { DATABASE_URL: 'postgres://postgres:postgres@127.0.0.1:5432/cenit_e2e', LOCAL_JWT_SECRET: 'e2e', STORAGE_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'cenit-e2e-')) });
const { migrate } = await import('../server/db/migrate.js');
await migrate();
for (const m of ['projects', 'visuals', 'voices', 'render', 'inspired', 'weekly']) await import(`../server/modules/${m}.js`);
const { startWorker, idle } = await import('../server/core/jobs.js');
const { buildApp } = await import('../server/app.js');
const app = await buildApp();
await app.listen({ port: 0, host: '127.0.0.1' });
await startWorker();
const BASE = `http://127.0.0.1:${app.server.address().port}`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 950 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
const shot = (name) => page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: true });
const waitText = (t, timeout = 60000) => page.getByText(t, { exact: false }).first().waitFor({ timeout });
let pass = false;
try {
  // Registro y entrada directa al entorno de trabajo
  await page.goto(BASE);
  await page.getByRole('button', { name: '¿No tienes cuenta? Crear una' }).click();
  await page.fill('input[type=email]', 'ana@ejemplo.com');
  await page.fill('input[type=password]', 'clave-segura-1');
  await shot('01-login');
  await page.getByRole('button', { name: 'Crear cuenta' }).click();
  await waitText('Crear nuevo vídeo');
  for (const item of ['Crear vídeo', 'Dashboard', 'Proyectos', 'Voces', 'Música', 'Ayuda', 'Ajustes', 'Radar Viral', 'Radar de Canales', 'Análisis de canales', 'Investigación semanal']) assert.ok(await page.locator('.nav a', { hasText: item }).count(), item);
  await waitText('Créditos disponibles');
  ok('Registro → abre directamente «Crear nuevo vídeo»; barra lateral completa y créditos visibles');

  // Crear vídeo: paso 1 (modo) y paso 2 (formato + estilo)
  for (const m of ['Desde Guion', 'Desde Idea', 'Desde URL', 'Desde Audio']) assert.ok(await page.getByText(m, { exact: true }).count(), m);
  await page.getByText('Desde Idea', { exact: true }).click();
  await page.fill('input[placeholder^="¿Por qué el cangrejo"]', '¿Por qué el cangrejo de los cocoteros sabe a langosta?');
  await shot('02-crear-paso1');
  await page.getByRole('button', { name: 'Continuar →' }).click();
  await waitText('Estilo visual');
  assert.equal(await page.locator('.style-card').count(), 14);
  await page.locator('.choice.fmt', { hasText: 'Vertical 9:16' }).click();
  await page.locator('.style-card', { hasText: 'Anime Japonés' }).click();
  await waitText('Activo');
  await shot('03-crear-paso2-estilos');
  await page.getByRole('button', { name: 'Crear proyecto' }).click();
  await waitText('Plantillas rápidas');
  ok('Crear vídeo: 4 modalidades, 3 formatos, 14 estilos con estilo activo → proyecto creado');

  // Editor · Contenido
  for (const t of ['Contenido', 'Voz', 'Subtítulos', 'Música', 'Edición']) assert.ok(await page.locator('.tabs button', { hasText: t }).count(), t);
  await waitText('Formato 9:16'); await waitText('Estilo: Anime Japonés');
  await page.locator('.chip', { hasText: 'Misterio' }).click();
  await page.getByRole('button', { name: 'Mejorar idea' }).click();
  await waitText('La respuesta está en lo que come');
  await page.getByRole('button', { name: '✨ Generar guion con IA' }).click();
  await waitText('Guion generado.');
  await waitText('palabras');
  await page.getByRole('button', { name: 'Dividir guion en escenas' }).click();
  await waitText('Escenas (5)', 90000);
  await waitText('Marta');
  await page.locator('.cast', { hasText: 'Marta' }).getByRole('button', { name: 'Confirmar' }).click();
  await page.locator('.cast', { hasText: 'Marta' }).getByRole('button', { name: 'Generar referencia' }).click();
  await page.locator('.cast', { hasText: 'Marta' }).locator('img').waitFor({ timeout: 60000 });
  await page.getByRole('button', { name: 'Generar todas' }).click();
  await page.waitForFunction(() => document.querySelectorAll('.scene .thumb img').length === 5, null, { timeout: 120000 });
  await shot('04-editor-contenido');
  // Prompt Img: regenerar sólo una imagen
  await page.locator('.scene').first().getByRole('button', { name: 'Prompt Img' }).click();
  await page.locator('.modal textarea').fill('Marta with her yellow raincoat at the lighthouse door');
  await page.getByRole('button', { name: 'Guardar y regenerar esta imagen' }).click();
  await waitText('Regenerando sólo esta imagen.');
  await page.locator('.scene').nth(1).getByRole('button', { name: 'Prompt anim' }).click();
  await page.getByRole('button', { name: /Movimiento de cámara/ }).click();
  await page.getByRole('button', { name: 'Animar esta escena' }).click();
  await waitText('Animación en cola.');
  await idle();
  ok('Contenido: plantilla, mejorar idea, guion IA, división en 5 escenas, reparto confirmado con referencia, generar todas, Prompt Img y Prompt anim');

  // Voz
  await page.locator('.tabs button', { hasText: 'Voz' }).click();
  await waitText('Catálogo de voces');
  await page.selectOption('.card select >> nth=0', 'gemini');
  await page.locator('.choice', { hasText: 'Charon' }).getByRole('button', { name: '▶ Vista previa' }).click();
  await page.locator('.choice', { hasText: 'Charon' }).locator('audio').waitFor({ timeout: 30000 });
  await page.locator('.choice', { hasText: 'Charon' }).getByRole('button', { name: 'Seleccionar' }).click();
  await waitText('Voz seleccionada');
  await page.getByRole('button', { name: 'Generar audio' }).click();
  await idle();
  await page.waitForFunction(() => document.querySelectorAll('table.t audio').length === 5, null, { timeout: 60000 });
  await shot('05-editor-voz');
  ok('Voz: catálogo, vista previa real, selección y narración de las 5 escenas');

  // Subtítulos
  await page.locator('.tabs button', { hasText: 'Subtítulos' }).click();
  await waitText('Estilo de subtítulos');
  await page.locator('.chip', { hasText: 'karaoke' }).click();
  await page.getByRole('button', { name: 'Generar automáticamente' }).click();
  await waitText('subtítulos sincronizados con la voz');
  await page.locator('table.t input:not([type=number])').first().fill('TEXTO EDITADO A MANO');
  await page.getByRole('button', { name: 'Guardar subtítulos' }).click();
  await waitText('Subtítulos guardados.');
  await shot('06-editor-subtitulos');
  ok('Subtítulos: estilo, generación automática sincronizada, edición manual y guardado');

  // Música
  await page.locator('.tabs button', { hasText: 'Música' }).click();
  await waitText('Música de fondo');
  await page.locator('.choice', { hasText: 'Misterio en la penumbra' }).getByRole('button', { name: 'Seleccionar' }).click();
  await page.getByRole('button', { name: '＋ Añadir efecto' }).click();
  await page.getByRole('button', { name: 'Guardar música y efectos' }).click();
  await waitText('Música guardada.');
  await shot('07-editor-musica');
  ok('Música: biblioteca, selección, efecto de sonido y guardado');

  // Edición y exportación
  await page.locator('.tabs button', { hasText: 'Edición' }).click();
  await waitText('Secuencia de escenas');
  await page.locator('table.t tbody tr').nth(2).locator('select').selectOption('deslizar');
  await page.getByRole('button', { name: 'Bajar' }).first().click();
  await page.getByRole('button', { name: 'Generar vista previa' }).click();
  await idle();
  await page.locator('video').first().waitFor({ timeout: 60000 });
  await page.getByRole('button', { name: 'Exportar MP4' }).click();
  await idle(600000);
  await page.getByRole('link', { name: '⬇ Descargar MP4' }).waitFor({ timeout: 60000 });
  const href = await page.getByRole('link', { name: '⬇ Descargar MP4' }).getAttribute('href');
  const mp4 = Buffer.from(await (await fetch(BASE + href)).arrayBuffer());
  assert.equal(mp4.subarray(4, 8).toString(), 'ftyp');
  await shot('08-editor-edicion');
  ok(`Edición: transición, orden, vista previa y exportación MP4 descargable (${(mp4.length / 1e6).toFixed(1)} MB)`);

  // Radar Viral → Crear vídeo inspirado
  await page.locator('.nav a', { hasText: 'Radar Viral' }).click();
  await page.fill('input[list=niches]', 'misterio');
  await page.locator('label', { hasText: 'Fecha de publicación' }).locator('select').selectOption('30d');
  await page.getByRole('button', { name: 'Buscar', exact: true }).click();
  await waitText('oportunidades');
  await waitText('Canal pequeño con vídeo gigante');
  await shot('09-radar-viral');
  await page.locator('.vcard', { hasText: 'El misterio del faro que nadie explica' }).getByRole('button', { name: 'Crear vídeo inspirado en esta oportunidad' }).click();
  await waitText('Hacerlo todo automáticamente hasta el MP4');
  await page.locator('.modal select >> nth=2').selectOption('gemini').catch(() => {});
  await page.locator('.modal .choice', { hasText: 'Kore' }).getByRole('button', { name: 'Seleccionar' }).click();
  await shot('10-crear-inspirado');
  await page.getByRole('button', { name: 'Crear vídeo', exact: true }).click();
  await waitText('Inspirado en:');
  await idle(600000);
  await page.reload();
  await page.locator('.tabs button', { hasText: 'Edición' }).click();
  await page.getByRole('link', { name: '⬇ Descargar MP4' }).waitFor({ timeout: 60000 });
  ok('Radar Viral: categorías explicadas → «Crear vídeo inspirado en esta oportunidad» → MP4 terminado');

  // Radar de Canales
  await page.locator('.nav a', { hasText: 'Radar de Canales' }).click();
  await page.fill('input[list=niches2]', 'misterio');
  await page.getByRole('button', { name: 'Buscar canales' }).click();
  await waitText('B · Señales públicas de monetización (1)');
  await waitText('Por qué es una oportunidad');
  await shot('11-radar-canales');
  ok('Radar de Canales: canal nuevo con grupo B y explicación');

  // Análisis de canal
  await page.locator('.nav a', { hasText: 'Análisis de canales' }).click();
  await page.fill('input.grow', '@misteriosnuevos');
  await page.getByRole('button', { name: 'Analizar' }).click();
  await waitText('Ingresos mensuales (ESTIMACIÓN)');
  await shot('12-analisis-canal');
  ok('Análisis de canal: estadísticas, estimación señalada, rendimiento y galería');

  // Investigación semanal
  await page.locator('.nav a', { hasText: 'Investigación semanal' }).click();
  await page.fill('input[placeholder^="misterios"]', 'misterio');
  await page.getByRole('button', { name: 'Programar' }).click();
  await waitText('Investigación programada.');
  await page.getByRole('button', { name: 'Ejecutar ahora' }).click();
  await idle();
  await page.getByRole('button', { name: 'Ver informes' }).click();
  await waitText('resultados nuevos verificados');
  await shot('13-semanal');
  ok('Investigación semanal: programar, ejecutar y ver informe con novedades');

  // Dashboard, Proyectos, Ajustes, Ayuda
  await page.locator('.nav a', { hasText: 'Dashboard' }).click(); await waitText('Proyectos recientes'); await shot('14-dashboard');
  await page.locator('.nav a', { hasText: 'Proyectos' }).click(); await waitText('Exportado'); await shot('15-proyectos');
  await page.locator('.nav a', { hasText: 'Ajustes' }).click(); await waitText('Créditos y tarifas');
  await page.locator('tr', { hasText: 'Google Gemini' }).getByRole('button', { name: 'Probar conexión real' }).click();
  await waitText('Clave válida'); await shot('16-ajustes');
  await page.locator('.nav a', { hasText: 'Ayuda' }).click(); await waitText('¿Cenit sabe si un canal está monetizado?');
  ok('Dashboard, Proyectos, Ajustes (prueba de conexión) y Ayuda');

  // Teléfono
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('.nav a', { hasText: 'Dashboard' }).evaluate((a) => a.click());
  await page.waitForTimeout(500);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'sin desbordamiento horizontal en móvil');
  await shot('17-movil');
  ok('Diseño adaptable a teléfono');

  assert.deepEqual(errors, []);
  pass = true;
  console.log(`\nE2E de la interfaz OK. Capturas en ${SHOTS}`);
} catch (e) {
  console.error('FALLO:', e.stack || e.message);
  await shot('fallo').catch(() => {});
  console.error('Errores de la página:', errors);
} finally {
  await browser.close(); await app.close(); fakes.server.close();
  const { closeDb } = await import('../server/db/index.js'); await closeDb();
  process.exit(pass ? 0 : 1);
}
