// Montaje y verificación reales con FFmpeg. Las imágenes y los tonos de audio son FIXTURES de prueba generados aquí
// (no se presentan como contenido del canal): sirven para comprobar sincronización, orden, mezcla y verificación.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ffmpeg } from '../lib/media.js';
import { computeTimeline } from '../lib/timeline.js';
import { buildNarrationTrack, buildMusicBed, renderVideo } from '../lib/render.js';
import { verifyProject } from '../lib/verify.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'epo-test-'));
const COLORS = ['0xC8272D', '0xF2C230', '0x1B1B1B', '0x2F7D3A'];
const scenes = [2.2, 3.1, 2.6, 2.9].map((d, i) => ({ n: i + 1, id: `escena_00${i + 1}`, audioDuration: d, sectionIndex: i < 2 ? 0 : 1, sfx: i === 2 ? 'revelacion' : i === 1 ? 'whoosh' : null, review: { state: 'aprobada_manual' }, audio: { durationSec: d, wordsPerSec: 2.5 } }));
const img = (s) => path.join(dir, `${s.id}.png`);
const wav = (s) => path.join(dir, `${s.id}.wav`);

test('monta un MP4 sincronizado que supera la verificación', { timeout: 240000 }, async () => {
  for (const [i, s] of scenes.entries()) {
    // ilustración de prueba distinta por escena: fondo crema con una figura en distinta posición/color
    await ffmpeg(['-f', 'lavfi', '-i', 'color=c=0xF3E9D2:s=1920x1080', '-vf', `drawbox=x=${200 + i * 380}:y=${200 + (i % 2) * 300}:w=420:h=420:color=${COLORS[i]}:t=fill,drawbox=x=100:y=900:w=${300 * (i + 1)}:h=60:color=black:t=fill`, '-frames:v', '1', img(s)]);
    // «voz» de prueba: tono modulado con la duración exacta de la escena
    await ffmpeg(['-f', 'lavfi', '-i', `sine=f=${220 + i * 60}:d=${s.audioDuration}`, '-af', 'volume=0.5,tremolo=f=4:d=0.6', '-ar', '44100', '-ac', '1', wav(s)]);
  }
  const tl = computeTimeline(scenes);
  const files = { video: path.join(dir, 'video.mp4'), narration: path.join(dir, 'narracion.wav'), bed: path.join(dir, 'cama.wav') };
  await buildNarrationTrack({ scenes, timeline: tl, wavOf: wav, outFile: files.narration });
  const bed = await buildMusicBed({ timeline: tl, narrationFile: files.narration, workDir: dir, seed: 1, outFile: files.bed });
  assert.equal(bed.sfx.length, 2);
  await renderVideo({ scenes, timeline: tl, imageOf: img, narrationFile: files.narration, bedFile: files.bed, outFile: files.video });
  const v = await verifyProject({ p: { scenes }, imageOf: img, wavOf: wav, files, timeline: tl });
  const failed = v.checks.filter((c) => !c.ok && !c.warning);
  assert.deepEqual(failed, [], JSON.stringify(failed, null, 1));
  assert.ok(v.passed);
  assert.ok(v.checks.find((c) => c.id === 'duracion_objetivo').warning, 'la duración objetivo es sólo aviso');

  // Si las imágenes se montan en otro orden, la verificación debe detectarlo.
  const swapped = path.join(dir, 'mal.mp4');
  const order = [scenes[0], scenes[2], scenes[1], scenes[3]];
  await renderVideo({ scenes: order.map((s, i) => ({ ...s, n: i + 1 })), timeline: tl, imageOf: img, narrationFile: files.narration, bedFile: files.bed, outFile: swapped });
  const bad = await verifyProject({ p: { scenes }, imageOf: img, wavOf: wav, files: { ...files, video: swapped }, timeline: tl });
  assert.equal(bad.checks.find((c) => c.id === 'orden_real').ok, false);
  assert.equal(bad.passed, false);
});

test('la verificación detecta música que tapa la voz y escenas sin aprobar', { timeout: 120000 }, async () => {
  const tl = computeTimeline(scenes);
  const loud = path.join(dir, 'cama_alta.wav');
  await ffmpeg(['-f', 'lavfi', '-i', `sine=f=300:d=${tl.total}`, '-af', 'volume=0.9', '-ac', '2', '-ar', '44100', loud]);
  const sc = scenes.map((s, i) => (i === 1 ? { ...s, review: { state: 'corregir' } } : s));
  const v = await verifyProject({ p: { scenes: sc }, imageOf: img, wavOf: wav, files: { video: path.join(dir, 'video.mp4'), narration: path.join(dir, 'narracion.wav'), bed: loud }, timeline: tl });
  assert.equal(v.checks.find((c) => c.id === 'musica').ok, false);
  assert.equal(v.checks.find((c) => c.id === 'coherencia').ok, false);
  assert.equal(v.passed, false);
});
