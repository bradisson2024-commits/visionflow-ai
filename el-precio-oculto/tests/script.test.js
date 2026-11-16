import { test } from 'node:test';
import assert from 'node:assert/strict';
import { splitSentences, splitIntoScenes, scenesCoverScript, factCheck, stripRefs, overlapWithOriginal } from '../lib/script.js';
import { cleanTranscript, quoteInText } from '../lib/analysis.js';
import { parseJsonLoose } from '../lib/llm.js';
import { speakable } from '../lib/tts.js';
import { parseVideoId, isoDurationToSeconds } from '../lib/youtube.js';

test('divide oraciones sin romper cifras ni referencias', () => {
  const s = splitSentences('En 1956 abrió el primer local [F2]. Costaba 1.500 dólares. ¿Por qué? Porque sí.');
  assert.deepEqual(s, ['En 1956 abrió el primer local [F2].', 'Costaba 1.500 dólares.', '¿Por qué?', 'Porque sí.']);
});

test('las escenas reproducen el guion completo, en orden, sin perder texto', () => {
  const sections = [
    { name: 'Gancho', paragraphs: ['Millones de personas entran cada día a un restaurante de comida rápida. Creen que el negocio son las hamburguesas. Pero hay algo más.'] },
    { name: 'Desarrollo', paragraphs: ['La empresa compra el terreno donde está cada local [F1]. Después se lo alquila al franquiciado, que paga cada mes. Así, aunque venda pocas hamburguesas, el alquiler sigue llegando, mes tras mes, sin importar cómo vaya la cocina ni cuántos clientes entren por la puerta principal del local.'] },
  ];
  const scenes = splitIntoScenes(sections);
  assert.ok(scenesCoverScript(sections, scenes));
  scenes.forEach((s, i) => { assert.equal(s.n, i + 1); assert.ok(s.narration.length > 0); });
  assert.ok(scenes.every((s) => s.narration.split(' ').length <= 40));
  assert.ok(scenes.some((s) => s.sources.includes('F1')));
});

test('detecta cifras sin fuente y referencias inexistentes', () => {
  const r = factCheck([{ paragraphs: ['Vende 70 millones al día. Abrió en 1955 [F1]. Gana mucho [F9].'] }], ['F1']);
  assert.deepEqual(r.unsupported, ['Vende 70 millones al día.']);
  assert.equal(r.badRefs[0].ref, 'F9');
});

test('coincidencia literal con el original', () => {
  const a = 'uno dos tres cuatro cinco seis siete ocho nueve diez';
  assert.equal(overlapWithOriginal(a, a), 1);
  assert.equal(overlapWithOriginal(a, 'algo totalmente distinto que no comparte nada de nada aquí'), 0);
});

test('utilidades', () => {
  assert.equal(stripRefs('Hola [F1, F2]. Adiós [F3].'), 'Hola. Adiós.');
  assert.equal(cleanTranscript('1\n00:00:01,000 --> 00:00:02,000\nHola <i>mundo</i>\n\n2\n00:00:02,000 --> 00:00:03,000\nadiós'), 'Hola mundo adiós');
  assert.ok(quoteInText('el negocio real son los terrenos', 'Dicen que el negocio real son los terrenos, no la comida.'));
  assert.ok(!quoteInText('esto nunca se dijo en el video original', 'Otra cosa completamente diferente.'));
  assert.deepEqual(parseJsonLoose('```json\n{"a":[1,2]}\n``` fin'), { a: [1, 2] });
  assert.equal(speakable('Sube un 30% [F2] & baja'), 'Sube un 30 por ciento y baja');
  assert.equal(parseVideoId('https://youtu.be/dQw4w9WgXcQ?t=3'), 'dQw4w9WgXcQ');
  assert.equal(parseVideoId('https://www.youtube.com/shorts/dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
  assert.equal(isoDurationToSeconds('PT9M41S'), 581);
});
