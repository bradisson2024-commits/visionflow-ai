// Revisión automática de coherencia: Gemini mira cada imagen junto a la narración que la acompaña.
import fs from 'node:fs';
import * as gemini from '../services/gemini.js';
import { grayPixels } from '../services/ffmpeg.js';
import { MASCOT } from './mascot.js';

export const MIN_SCORE = 7;

export async function reviewImage(scene, file) {
  const r = await gemini.ask({
    json: true, temperature: 0, images: [{ mime: 'image/png', data: fs.readFileSync(file).toString('base64') }],
    system: 'Eres el control de calidad de EL PRECIO OCULTO. Estricto y concreto.',
    prompt: `Narración que se oye mientras se muestra la imagen: «${scene.narration}»
Lo que debía verse: ${scene.visual}
Estilo obligatorio: Stickman 2D dibujado a mano, imagen estática, contornos negros, fondo crema, acentos amarillos/marrones/rojos. Sin fotorrealismo, 3D ni texto.
Si aparece la mascota debe ser: ${MASCOT.rasgos_es.join(', ')}.
JSON: {"se_ve": string, "representa": boolean, "estilo": boolean, "mascota_correcta": boolean (true si no aparece), "puntuacion": number (0-10), "problemas": [string], "correccion": string (instrucción en inglés para rehacerla; vacía si no hace falta)}`,
  });
  const d = r.data;
  const ok = d.representa && d.estilo && d.mascota_correcta !== false && Number(d.puntuacion) >= MIN_SCORE;
  return { state: ok ? 'aprobada' : 'rechazada', by: 'gemini', score: Number(d.puntuacion) || 0, seen: d.se_ve, problems: d.problemas || [], fix: d.correccion || '', at: new Date().toISOString() };
}

/** Pares de escenas con imágenes casi idénticas (huella perceptual por diferencias). */
export async function nearDuplicates(files) {
  const hashes = [];
  for (const { n, file } of files) {
    const px = await grayPixels(file, { w: 9, h: 8 });
    let h = '';
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) h += px[y * 9 + x] > px[y * 9 + x + 1] ? 1 : 0;
    hashes.push({ n, h });
  }
  const pairs = [];
  for (let i = 0; i < hashes.length; i++) for (let j = i + 1; j < hashes.length; j++) {
    let d = 0;
    for (let k = 0; k < 64; k++) if (hashes[i].h[k] !== hashes[j].h[k]) d++;
    if (d <= 5) pairs.push([hashes[i].n, hashes[j].n]);
  }
  return pairs;
}
