import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sentences, stripRefs, refsIn, auditFacts, copiedRatio, quoteFound, cleanTranscript } from '../server/modules/textkit.js';
import { scoreVideo } from '../server/modules/opportunities.js';
import { buildTimeline, checkTimeline } from '../server/modules/timeline.js';
import { cutScenes, sameText } from '../server/modules/scriptwriter.js';
import { parseDuration, videoIdFrom } from '../server/services/youtube.js';
import { extractJson } from '../server/services/gemini.js';

test('oraciones: respeta cifras, abreviaturas y referencias', () => {
  assert.deepEqual(sentences('Costó 1.500 dólares en EE.UU. según el Sr. Pérez [2]. ¿Por qué? Nadie lo sabe.'),
    ['Costó 1.500 dólares en EE.UU. según el Sr. Pérez [2].', '¿Por qué?', 'Nadie lo sabe.']);
  assert.equal(stripRefs('Dato [1, 3]. Otro [2].'), 'Dato. Otro.');
  assert.deepEqual(refsIn('a [1, 3] b [2]'), [1, 3, 2]);
});

test('auditoría de datos: cifras sin fuente y fuentes inexistentes', () => {
  const r = auditFacts(['Vende 70 millones al día. Abrió en 1955 [1]. Gana más [9].'], 3);
  assert.deepEqual(r.missing, ['Vende 70 millones al día.']);
  assert.deepEqual(r.invalid, ['Gana más [9].']);
});

test('copia literal y citas', () => {
  const t = 'uno dos tres cuatro cinco seis siete ocho nueve';
  assert.equal(copiedRatio(t, t), 1);
  assert.equal(copiedRatio(t, 'nada que ver con el texto anterior en absoluto'), 0);
  assert.ok(quoteFound('el negocio real son los terrenos', 'Dicen que el negocio real son los terrenos, no la comida.'));
  assert.ok(!quoteFound('esto jamás se dijo en el video', 'Otra cosa distinta.'));
  assert.equal(cleanTranscript('1\n00:00:01,000 --> 00:00:02,000\nHola <b>mundo</b>\n\n2\n00:00:02,000 --> 00:00:03,000\nadiós'), 'Hola mundo adiós');
});

test('oportunidad: atípico rápido y sin competencia puntúa alto; lo contrario, bajo', () => {
  const now = Date.parse('2026-11-16T00:00:00Z');
  const hot = scoreVideo({ title: 'El negocio secreto de los aeropuertos', views: 900000, likes: 40000, comments: 3000, published_at: '2026-11-06T00:00:00Z' }, 50000, { count: 1, sample: 25 }, now);
  const cold = scoreVideo({ title: 'Vlog de mi día', views: 2000, likes: 10, comments: 1, published_at: '2026-08-01T00:00:00Z' }, 900000, { count: 12, sample: 25 }, now);
  assert.equal(hot.level, 'alta');
  assert.equal(cold.level, 'baja');
  assert.ok(hot.reasons.some((r) => /18\.0×/.test(r)));
  assert.equal(hot.metrics.viewsPerDay, 90000);
});

test('línea de tiempo: cada imagen cubre toda su narración y los fundidos caen en las pausas', () => {
  const sc = [3.1, 4.2, 2.5, 5.0].map((a, i) => ({ n: i + 1, audio_sec: a, part: i < 2 ? 'A' : 'B', sfx: i === 3 ? 'revelacion' : null }));
  const tl = buildTimeline(sc);
  assert.deepEqual(checkTimeline(tl), []);
  for (const [i, it] of tl.items.entries()) {
    assert.ok(it.fullFrom <= it.speechStart && it.fullUntil >= it.speechEnd);
    if (i) assert.ok(it.showFrom >= tl.items[i - 1].speechEnd);
  }
  assert.equal(tl.total, +(0.6 + 3.1 + 0.4 + 4.2 + 0.8 + 2.5 + 1.0 + 5.0 + 2.0).toFixed(3));
  assert.throws(() => buildTimeline([{ n: 1, audio_sec: 0 }]), /no tiene audio/);
});

test('escenas: reproducen el guion exacto, en orden', () => {
  const parts = [
    { name: 'Gancho', paragraphs: ['Millones de personas entran cada día a un restaurante pensando en hamburguesas. Pero el negocio está en otra parte.'] },
    { name: 'Desarrollo', paragraphs: ['La empresa compra el terreno donde está cada local [1]. Luego se lo alquila al franquiciado, que paga cada mes, venda mucho o venda poco, llueva o haga sol, durante muchísimos años seguidos sin falta.'] },
  ];
  const sc = cutScenes(parts);
  assert.ok(sameText(parts, sc));
  sc.forEach((s, i) => assert.equal(s.n, i + 1));
  assert.ok(sc.every((s) => s.narration.split(' ').length <= 38));
  assert.ok(sc.some((s) => s.sources.includes(1)));
});

test('utilidades de YouTube y Gemini', () => {
  assert.equal(parseDuration('PT1H2M3S'), 3723);
  assert.equal(parseDuration('PT45S'), 45);
  assert.equal(videoIdFrom('https://youtu.be/dQw4w9WgXcQ?t=1'), 'dQw4w9WgXcQ');
  assert.equal(videoIdFrom('https://www.youtube.com/shorts/dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
  assert.deepEqual(extractJson('```json\n{"a": [1]}\n```'), { a: [1] });
});
