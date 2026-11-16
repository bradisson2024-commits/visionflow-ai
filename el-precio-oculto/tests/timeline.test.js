import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeTimeline, validateTimeline } from '../lib/timeline.js';

const mk = (durs, extra = {}) => durs.map((d, i) => ({ n: i + 1, id: `escena_${i + 1}`, audioDuration: d, sectionIndex: extra.sec?.[i] ?? 0, sfx: extra.sfx?.[i] ?? null }));

test('cada imagen cubre por completo su narración y no hay huecos', () => {
  const tl = computeTimeline(mk([3.2, 5.1, 2.4, 7.9], { sec: [0, 0, 1, 1], sfx: [null, null, null, 'revelacion'] }));
  assert.deepEqual(validateTimeline(tl), []);
  for (const [i, e] of tl.entries.entries()) {
    assert.ok(e.fullFrom <= e.start && e.fullUntil >= e.audioEnd, `escena ${e.n}`);
    if (i) assert.ok(e.visualStart >= tl.entries[i - 1].audioEnd, 'no aparece antes de tiempo');
  }
  assert.equal(tl.total, +(0.5 + 3.2 + 0.45 + 5.1 + 0.9 + 2.4 + 0.95 + 7.9 + 1.8).toFixed(3));
});

test('una sola escena', () => {
  const tl = computeTimeline(mk([4]));
  assert.deepEqual(validateTimeline(tl), []);
  assert.equal(tl.entries[0].clip, tl.total);
});

test('rechaza escenas sin audio', () => {
  assert.throws(() => computeTimeline(mk([2, 0])), /no tiene duración/);
});
