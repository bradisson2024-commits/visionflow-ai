// Puente con Google Flow: cola de escenas, guardado escena_NNN → escena correcta, reintentos. Las imágenes son fixtures.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.PROJECTS_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'epo-flow-'));
const { createProject, saveProject, loadProject, projectPath } = await import('../lib/project.js');
const { flowQueue, saveFlowResult, flowSummary, flowTxt, fileHash, scenePending } = await import('../lib/flow.js');
const { ffmpeg } = await import('../lib/media.js');

async function png(color, w = 1376, h = 768) {
  const f = path.join(process.env.PROJECTS_DIR, `${color}-${w}.png`);
  await ffmpeg(['-f', 'lavfi', '-i', `color=c=${color}:s=${w}x${h}`, '-frames:v', '1', f]);
  return fs.readFileSync(f);
}

function fixtureProject() {
  const p = createProject({ title: 'Prueba Flow', channelTitle: 'c', url: 'u', thumbnail: '', dataSource: 'fixture' });
  p.characters = [{ id: 'investigador', name: 'El Investigador', description: 'stick figure with a yellow hat and red scarf' }];
  p.scenes = [1, 2, 3].map((n) => ({ n, id: `escena_00${n}`, narration: `Frase ${n}.`, visual: { description: `cosa ${n}`, prompt: `a stickman doing thing ${n}\nsecond line`, characters: ['investigador'] }, image: null, review: null }));
  p.thumbnailPrompt = 'surprised stickman';
  saveProject(p);
  return p;
}

test('primero la hoja de personajes, luego las escenas y la miniatura', async () => {
  const p = fixtureProject();
  let q = flowQueue(p);
  assert.equal(q.phase, 'personajes');
  assert.deepEqual(q.items.map((i) => i.n), [0]);
  await saveFlowResult(p.id, 'escena_000.png', await png('white'));
  assert.ok(fs.existsSync(projectPath(p.id, 'imagenes', 'personajes.png')));
  q = flowQueue(loadProject(p.id));
  assert.equal(q.phase, 'escenas');
  assert.deepEqual(q.items.map((i) => i.n), [1, 2, 3, 900]);
  assert.ok(q.items.every((i) => !/\n/.test(i.prompt)), 'un prompt por línea');
  assert.match(q.items[0].prompt, /yellow hat and red scarf/);
  assert.ok(q.refUrl.endsWith('/imagenes/personajes.png'));
  assert.equal(flowTxt(p).trim().split('\n').length, 3);
});

test('cada resultado vuelve a su escena, normalizado a 1920x1080', async () => {
  const p = fixtureProject();
  await saveFlowResult(p.id, 'escena_002.jpg', await png('red'));
  await saveFlowResult(p.id, 'escena_002_2.png', await png('blue')); // variante x2: no sustituye
  const { probe } = await import('../lib/media.js');
  const v = (await probe(projectPath(p.id, 'imagenes', 'escena_002.png'))).streams[0];
  assert.equal(`${v.width}x${v.height}`, '1920x1080');
  const sum = flowSummary(loadProject(p.id));
  assert.equal(sum.received, 1);
  assert.deepEqual(sum.pending, [1, 3]);
});

test('una escena marcada para corregir vuelve a la cola hasta que llega otra imagen', async () => {
  const p = fixtureProject();
  for (const n of [1, 2, 3]) await saveFlowResult(p.id, `escena_00${n}.png`, await png(['red', 'green', 'blue'][n - 1]));
  const pr = loadProject(p.id);
  const s = pr.scenes[1];
  s.review = { state: 'corregir', imageHash: fileHash(projectPath(p.id, 'imagenes', 'escena_002.png')) };
  saveProject(pr);
  assert.equal(scenePending(pr, s).pending, true);
  await saveFlowResult(p.id, 'escena_002.png', await png('yellow'));
  assert.equal(scenePending(loadProject(p.id), loadProject(p.id).scenes[1]).pending, false);
});

test('rechaza nombres y escenas que no existen, y archivos que no son imagen', async () => {
  const p = fixtureProject();
  await assert.rejects(saveFlowResult(p.id, 'foto.png', Buffer.from('x')), /escena_NNN/);
  await assert.rejects(saveFlowResult(p.id, 'escena_045.png', await png('red')), /no existe/);
  await assert.rejects(saveFlowResult('2026-01-01-no-existe-000000', 'escena_001.png', await png('red')), /No existe el proyecto/);
  await assert.rejects(saveFlowResult(p.id, 'escena_001.png', Buffer.from('no soy una imagen')), /no es una imagen/);
  assert.equal(fs.existsSync(projectPath(p.id, 'imagenes', 'escena_001.png')), false);
});
