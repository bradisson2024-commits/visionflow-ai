'use strict';
const test = require('node:test');
const assert = require('node:assert');
const T = require('../app/public/timing.js');
const { outputSize } = require('../app/lib/exporter.js');

test('texto por líneas', () => {
  const p = T.parseSceneText('uno\n\n dos \ntres\n');
  assert.strictEqual(p.mode, 'lines');
  assert.deepStrictEqual(p.lines, ['uno', 'dos', 'tres']);
});

test('texto vacío', () => assert.strictEqual(T.parseSceneText('  \n').mode, 'none'));

test('SRT con marcas reales', () => {
  const p = T.parseSceneText('1\n00:00:00,000 --> 00:00:02,500\nHola\n\n2\n00:00:02,500 --> 00:00:06,000\nAdiós mundo\n');
  assert.strictEqual(p.mode, 'timed');
  assert.deepStrictEqual(p.cues.map(c => c.start), [0, 2.5]);
  assert.deepStrictEqual(p.lines, ['Hola', 'Adiós mundo']);
});

test('líneas con [mm:ss]', () => {
  const p = T.parseSceneText('[00:00] a\n[00:03.5] b\n[0:07] c');
  assert.strictEqual(p.mode, 'timed');
  assert.deepStrictEqual(p.cues.map(c => c.start), [0, 3.5, 7]);
});

test('reparto igual sin texto', () => {
  const r = T.distribute(4, 10, T.parseSceneText(''));
  assert.strictEqual(r.method, 'igual');
  assert.strictEqual(r.approximate, false);
  assert.deepStrictEqual(r.durations, [2.5, 2.5, 2.5, 2.5]);
});

test('reparto aproximado por longitud de texto, suma exacta', () => {
  const r = T.distribute(3, 9, T.parseSceneText('aa\naaaa\naaaaaa'));
  assert.strictEqual(r.method, 'aproximada');
  assert.strictEqual(r.approximate, true);
  assert.deepStrictEqual(r.durations, [1.5, 3, 4.5]);
  assert.match(r.message, /APROXIMADA/);
});

test('reparto con marcas de tiempo', () => {
  const r = T.distribute(3, 10, T.parseSceneText('[00:00] a\n[00:03] b\n[00:07] c'));
  assert.strictEqual(r.method, 'marcas');
  assert.deepStrictEqual(r.durations, [3, 4, 3]);
});

test('marcas con distinto número de imágenes → avisa y no las usa', () => {
  const r = T.distribute(2, 10, T.parseSceneText('[00:00] a\n[00:03] b\n[00:07] c'));
  assert.notStrictEqual(r.method, 'marcas');
  assert.match(r.warning, /no se pueden usar las marcas/);
  assert.strictEqual(T.total(r.durations), 10);
});

test('sin audio → error claro', () => assert.throws(() => T.distribute(3, 0), /audio/));

test('inicios, total y escena en tiempo', () => {
  const d = [2, 3, 1.5];
  assert.deepStrictEqual(T.starts(d), [0, 2, 5]);
  assert.strictEqual(T.total(d), 6.5);
  assert.strictEqual(T.sceneAt(d, 0), 0);
  assert.strictEqual(T.sceneAt(d, 2.0), 1);
  assert.strictEqual(T.sceneAt(d, 6.4), 2);
  assert.strictEqual(T.fmt(65.25), '1:05.3');
});

test('resolución de salida según la proporción', () => {
  assert.deepStrictEqual(outputSize(1280, 720, '1080p'), { W: 1920, H: 1080 });
  assert.deepStrictEqual(outputSize(720, 1280, '1080p'), { W: 1080, H: 1920 });
  assert.deepStrictEqual(outputSize(1000, 1000, '720p'), { W: 720, H: 720 });
  assert.deepStrictEqual(outputSize(1024, 768, '1080p'), { W: 1440, H: 1080 });
});
