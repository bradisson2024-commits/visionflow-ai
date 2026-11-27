// GRATIS Y LOCAL: compositor de música de fondo de Vimo.
//
// Genera música instrumental ORIGINAL por síntesis (sin muestras ni grabaciones de terceros):
// progresión de acordes según el ambiente, pad, piano/arpegios, bajo, pulso, caja de música
// y percusión suave; después FFmpeg añade reverberación y normaliza el volumen.
// Al ser creada por el propio programa en tu equipo, no hay derechos de terceros ni coste.
// Cada pieza usa una semilla distinta, así que dos generaciones no suenan idénticas.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { runFfmpeg } from '../media.js';

const SR = 44100;
const SCALES = {
  minor: [0, 2, 3, 5, 7, 8, 10], major: [0, 2, 4, 5, 7, 9, 11], dorian: [0, 2, 3, 5, 7, 9, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10], lydian: [0, 2, 4, 6, 7, 9, 11],
};

// Ambientes = los mismos ids que el módulo Música IA.
export const MOODS = {
  suspenso: { root: 45, scale: 'phrygian', bpm: 72, prog: [0, 0, 1, 0, 5, 5, 6, 1], layers: { pad: 0.22, drone: 0.16, pulse: 0.34, tick: 0.05 }, bright: 0.35 },
  tristeza: { root: 50, scale: 'minor', bpm: 62, prog: [0, 5, 2, 6], layers: { pad: 0.2, piano: 0.36, bass: 0.18 }, bright: 0.5 },
  misterio: { root: 47, scale: 'dorian', bpm: 66, prog: [0, 3, 0, 6], layers: { pad: 0.24, musicbox: 0.2, drone: 0.12, tick: 0.025 }, bright: 0.45 },
  motivacion: { root: 48, scale: 'major', bpm: 104, prog: [0, 4, 5, 3], layers: { pad: 0.16, arp: 0.26, bass: 0.3, kick: 0.42, clap: 0.12, hat: 0.05 }, bright: 0.75 },
  historia: { root: 50, scale: 'major', bpm: 84, prog: [0, 5, 3, 4], layers: { pad: 0.14, pluck: 0.32, bass: 0.2 }, bright: 0.65 },
  documental: { root: 45, scale: 'minor', bpm: 78, prog: [0, 3, 5, 4], layers: { pad: 0.2, piano: 0.26, pulse: 0.12 }, bright: 0.5 },
  ambiente: { root: 52, scale: 'lydian', bpm: 56, prog: [0, 1, 0, 4], layers: { pad: 0.3, musicbox: 0.1, drone: 0.12 }, bright: 0.55 },
  cinematografico: { root: 43, scale: 'minor', bpm: 70, prog: [0, 5, 2, 6], layers: { pad: 0.3, bass: 0.26, timpani: 0.42, swell: 0.18 }, bright: 0.5 },
};

function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const hz = m => 440 * 2 ** ((m - 69) / 12);

// Tablas de onda de un ciclo (limitadas en banda) para osciladores rápidos.
const TBL = 4096;
function table(partials) {
  const t = new Float32Array(TBL + 1);
  for (let i = 0; i <= TBL; i++) { let v = 0; for (const [k, a] of partials) v += a * Math.sin((2 * Math.PI * k * i) / TBL); t[i] = v; }
  let max = 0; for (const v of t) max = Math.max(max, Math.abs(v));
  for (let i = 0; i <= TBL; i++) t[i] /= max;
  return t;
}
const W = {
  saw: table(Array.from({ length: 12 }, (_, i) => [i + 1, 1 / (i + 1)])),
  warm: table([[1, 1], [2, 0.35], [3, 0.2], [4, 0.08], [5, 0.05]]),
  sine: table([[1, 1]]),
  piano: table([[1, 1], [2, 0.45], [3, 0.22], [4, 0.12], [5, 0.06], [6, 0.03]]),
  bell: table([[1, 1], [2, 0.3], [3, 0.12]]),
};

class Mix {
  constructor(seconds) { this.n = Math.ceil(seconds * SR); this.L = new Float32Array(this.n); this.R = new Float32Array(this.n); }
  /** Añade una nota con oscilador de tabla, envolvente ADSR, filtro paso bajo y paneo. */
  note({ t, dur, freq, wave, gain, a = 0.01, d = 0.2, s = 0.6, r = 0.3, decay = 0, pan = 0, cutoff = 0.25, detune = 0 }) {
    const start = Math.floor(t * SR), len = Math.floor((dur + r) * SR);
    const gl = gain * Math.cos((pan + 1) * Math.PI / 4), gr = gain * Math.sin((pan + 1) * Math.PI / 4);
    let ph = Math.random(), lp = 0;
    const inc = (freq * (1 + detune) * TBL) / SR;
    const A = a * SR, D = d * SR, S = dur * SR;
    for (let i = 0; i < len; i++) {
      const j = start + i; if (j >= this.n) break; if (j < 0) continue;
      let env;
      if (i < A) env = i / A; else if (i < A + D) env = 1 - (1 - s) * ((i - A) / D); else if (i < S) env = s; else env = s * (1 - (i - S) / (r * SR));
      if (decay) env *= Math.exp(-i / (decay * SR));
      const idx = ph | 0, fr = ph - idx;
      const v = wave[idx] + (wave[idx + 1] - wave[idx]) * fr;
      ph += inc; if (ph >= TBL) ph -= TBL;
      lp += cutoff * (v - lp);
      const o = lp * env;
      this.L[j] += o * gl; this.R[j] += o * gr;
    }
  }
  /** Percusión sintetizada: bombo (barrido de seno), palmada/caja (ruido) o charles. */
  hit({ t, kind, gain }) {
    const start = Math.floor(t * SR);
    const len = Math.floor((kind === 'timpani' ? 1.4 : kind === 'kick' ? 0.35 : kind === 'clap' ? 0.18 : 0.05) * SR);
    let ph = 0, lp = 0, prev = 0;
    for (let i = 0; i < len; i++) {
      const j = start + i; if (j >= this.n) break;
      const x = i / SR; let v;
      if (kind === 'kick' || kind === 'timpani') {
        const f = kind === 'kick' ? 45 + 90 * Math.exp(-x * 30) : 55 + 40 * Math.exp(-x * 8);
        ph += (2 * Math.PI * f) / SR; v = Math.sin(ph) * Math.exp(-x * (kind === 'kick' ? 9 : 3));
      } else if (kind === 'clap') { const nz = Math.random() * 2 - 1; lp += 0.35 * (nz - lp); v = lp * Math.exp(-x * 22); }
      else { const nz = Math.random() * 2 - 1; v = (nz - prev) * Math.exp(-x * 90); prev = nz; } // charles / tic
      this.L[j] += v * gain; this.R[j] += v * gain;
    }
  }
}

function chordNotes(root, scale, degree, size = 4) {
  const sc = SCALES[scale];
  return Array.from({ length: size }, (_, k) => {
    const d = degree + k * 2;
    return root + sc[d % 7] + 12 * Math.floor(d / 7);
  });
}

/** Compone y guarda un MP3. Devuelve la duración. */
export async function composeLocal({ mood = 'historia', seconds = 60, outPath, seed = Date.now(), signal }) {
  const M = MOODS[mood] || MOODS.historia;
  const rand = rng(seed);
  const beat = 60 / M.bpm, bar = beat * 4;
  // Pieza en bloques de 8 compases; se repite en el montaje si el video es más largo.
  const bars = Math.max(8, Math.min(Math.ceil(Math.min(seconds, 180) / bar / 8) * 8, 96));
  const total = bars * bar;
  const mix = new Mix(total + 3);
  const L = M.layers;
  const transpose = [0, 0, 2, -2, 3][Math.floor(rand() * 5)];
  const root = M.root + transpose;
  // Pequeñas variaciones de la progresión para que cada pieza sea distinta.
  const prog = rand() < 0.5 ? M.prog : [...M.prog.slice(Math.floor(M.prog.length / 2)), ...M.prog.slice(0, Math.floor(M.prog.length / 2))];

  for (let b = 0; b < bars; b++) {
    const t0 = b * bar;
    const deg = prog[b % prog.length];
    const chord = chordNotes(root + 12, M.scale, deg, 4);
    const section = b < 2 ? 0 : b < 6 ? 1 : 2; // intro → desarrollo → completo
    const cut = 0.04 + M.bright * 0.12;
    if (L.pad) for (const [k, n] of chord.entries()) {
      for (const dt of [-0.004, 0.004]) mix.note({ t: t0, dur: bar, freq: hz(n), wave: W.saw, gain: L.pad / 4, a: bar * 0.35, d: 0.5, s: 0.85, r: bar * 0.4, pan: (k - 1.5) * 0.25, cutoff: cut, detune: dt });
    }
    if (L.drone) mix.note({ t: t0, dur: bar, freq: hz(root - 12), wave: W.warm, gain: L.drone, a: 0.8, d: 0.5, s: 0.9, r: 1.2, cutoff: 0.05 });
    if (L.swell && b % 4 === 3) chord.forEach(n => mix.note({ t: t0, dur: bar, freq: hz(n + 12), wave: W.saw, gain: L.swell / 4, a: bar * 0.9, d: 0.1, s: 1, r: 0.6, cutoff: 0.12 }));
    if (section >= 1 && L.bass) {
      const bn = root - 12 + SCALES[M.scale][deg % 7];
      const hits = M.bpm >= 95 ? [0, 1.5, 2, 3] : [0, 2];
      for (const h of hits) mix.note({ t: t0 + h * beat, dur: beat * (M.bpm >= 95 ? 0.9 : 1.8), freq: hz(bn), wave: W.warm, gain: L.bass, a: 0.01, d: 0.25, s: 0.6, r: 0.2, cutoff: 0.08 });
    }
    if (L.pulse) {
      const bn = root - 12 + SCALES[M.scale][deg % 7];
      for (let e = 0; e < 8; e++) mix.note({ t: t0 + e * beat / 2, dur: beat * 0.3, freq: hz(bn), wave: W.warm, gain: L.pulse * (e % 2 ? 0.6 : 1) * (section ? 1 : 0.5), a: 0.005, d: 0.12, s: 0.2, r: 0.1, cutoff: 0.05 });
    }
    if (section >= 1 && L.piano) {
      const pattern = [0, 1, 2, 3, 2, 1, 2, 3];
      for (let e = 0; e < 8; e++) {
        if (rand() < 0.12) continue;
        const n = chord[pattern[e]] + 12;
        mix.note({ t: t0 + e * beat / 2 + (rand() - 0.5) * 0.015, dur: beat * 1.5, freq: hz(n), wave: W.piano, gain: L.piano * (0.7 + rand() * 0.3), a: 0.004, d: 0.6, s: 0.25, r: 0.8, decay: 1.6, pan: (rand() - 0.5) * 0.5, cutoff: 0.35 });
      }
    }
    if (section >= 1 && (L.arp || L.pluck)) {
      const g = L.arp || L.pluck, steps = L.arp ? 16 : 8;
      for (let e = 0; e < steps; e++) {
        const n = chord[(e * (L.arp ? 1 : 2)) % 4] + (L.arp && e % 8 >= 4 ? 24 : 12);
        mix.note({ t: t0 + e * bar / steps, dur: bar / steps, freq: hz(n), wave: L.arp ? W.saw : W.piano, gain: g * (e % 4 === 0 ? 1 : 0.7), a: 0.003, d: 0.15, s: 0.15, r: 0.15, decay: 0.5, pan: e % 2 ? 0.3 : -0.3, cutoff: L.arp ? 0.18 : 0.3 });
      }
    }
    if (L.musicbox) {
      const sc = SCALES[M.scale];
      for (let e = 0; e < 8; e++) {
        if (rand() > 0.32) continue;
        const n = root + 36 + sc[Math.floor(rand() * 7)];
        mix.note({ t: t0 + e * beat / 2, dur: beat * 2, freq: hz(n), wave: W.bell, gain: L.musicbox, a: 0.002, d: 0.3, s: 0.2, r: 1.2, decay: 1.1, pan: rand() - 0.5, cutoff: 0.6 });
      }
    }
    if (section >= 2 || (section >= 1 && !L.kick)) {
      for (let q = 0; q < 4; q++) {
        if (L.kick) mix.hit({ t: t0 + q * beat, kind: 'kick', gain: L.kick });
        if (L.clap && (q === 1 || q === 3)) mix.hit({ t: t0 + q * beat, kind: 'clap', gain: L.clap });
        if (L.hat) for (const h of [0, 0.5]) mix.hit({ t: t0 + (q + h) * beat, kind: 'hat', gain: L.hat * (h ? 1 : 0.6) });
      }
      if (L.timpani && b % 2 === 0) { mix.hit({ t: t0, kind: 'timpani', gain: L.timpani }); if (b % 4 === 2) mix.hit({ t: t0 + beat * 3.5, kind: 'timpani', gain: L.timpani * 0.6 }); }
    }
    if (L.tick) for (let s = 0; s < 8; s++) mix.hit({ t: t0 + s * beat / 2, kind: 'hat', gain: L.tick * (s % 2 ? 0.5 : 1) });
    if (signal?.aborted) throw signal.reason || new Error('Cancelado');
  }

  // Normaliza y escribe WAV 16 bits.
  let peak = 0;
  for (let i = 0; i < mix.n; i++) peak = Math.max(peak, Math.abs(mix.L[i]), Math.abs(mix.R[i]));
  const g = peak > 0 ? 0.8 / peak : 1;
  const wav = path.join(os.tmpdir(), `vimo_music_${process.pid}_${Date.now()}.wav`);
  const buf = Buffer.alloc(44 + mix.n * 4);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + mix.n * 4, 4); buf.write('WAVE', 8); buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(2, 22); buf.writeUInt32LE(SR, 24); buf.writeUInt32LE(SR * 4, 28);
  buf.writeUInt16LE(4, 32); buf.writeUInt16LE(16, 34); buf.write('data', 36); buf.writeUInt32LE(mix.n * 4, 40);
  for (let i = 0, o = 44; i < mix.n; i++, o += 4) {
    buf.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(Math.tanh(mix.L[i] * g) * 32767))), o);
    buf.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(Math.tanh(mix.R[i] * g) * 32767))), o + 2);
  }
  fs.writeFileSync(wav, buf);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  // Reverberación + ecualización suave + volumen estándar; se recorta en un compás exacto para que el bucle sea limpio.
  await runFfmpeg(['-y', '-i', wav, '-af',
    `aecho=0.8:0.6:47|91|173|263:0.32|0.24|0.18|0.12,highpass=f=35,lowpass=f=11000,loudnorm=I=-18:TP=-2:LRA=11,atrim=0:${total.toFixed(3)},afade=t=in:d=0.02,afade=t=out:st=${(total - 0.05).toFixed(3)}:d=0.05`,
    '-ar', '44100', '-c:a', 'libmp3lame', '-b:a', '192k', outPath], { signal });
  fs.rmSync(wav, { force: true });
  return total;
}
