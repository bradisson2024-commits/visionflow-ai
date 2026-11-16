// Imágenes Stickman estáticas. Dos motores reales:
//  - gemini: el servidor llama al modelo de imagen de Gemini con la mascota oficial como referencia.
//  - flow:   Google Flow, desde la extensión «EPO · Conector Flow» (extension/) o importando archivos.
import fs from 'node:fs';
import crypto from 'node:crypto';
import { paths } from '../core/paths.js';
import * as gemini from '../services/gemini.js';
import { ffmpeg } from '../services/ffmpeg.js';
import { referenceFile, hasReference, scenePrompt, STYLE_EN, AVOID_EN, MASCOT } from './mascot.js';

export const sceneImagePath = (slug, n) => paths.project(slug, 'imagenes', `escena_${String(n).padStart(3, '0')}.png`);
export const thumbBasePath = (slug) => paths.project(slug, 'imagenes', 'miniatura_base.png');
export const fileHash = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex').slice(0, 16);

/** Cualquier imagen → PNG 1920×1080 sobre fondo crema, sin recortar el dibujo. */
export async function normalize(input, output) {
  const tmp = `${output}.tmp.png`;
  await ffmpeg(['-i', input, '-frames:v', '1', '-vf', 'scale=1920:1080:force_original_aspect_ratio=decrease:flags=lanczos,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=0xF5EDDC,format=rgb24', tmp]);
  fs.renameSync(tmp, output);
}

export async function geminiSceneImage(slug, scene) {
  if (!hasReference()) throw new Error('Falta la imagen de referencia de la mascota. Abre Configuración → Mascota y pulsa «Guardar referencia» (se genera a partir del dibujo oficial).');
  const ref = { mime: 'image/png', data: fs.readFileSync(referenceFile()).toString('base64') };
  const prompt = `The attached image is the official mascot reference. ${scenePrompt(scene)}`;
  const img = await gemini.image({ prompt, refs: [ref] });
  const raw = paths.project(slug, 'imagenes', `escena_${String(scene.n).padStart(3, '0')}.raw`);
  fs.writeFileSync(raw, img.buffer);
  try { await normalize(raw, sceneImagePath(slug, scene.n)); } finally { fs.rmSync(raw, { force: true }); }
  return { prompt };
}

export function thumbnailPrompt(title, text) {
  return `YouTube thumbnail illustration about "${title}": the detective mascot in the foreground, shocked, holding the golden magnifying glass up to reveal the hidden secret of the topic; huge simple shapes, strong contrast, empty space in the bottom third for big text "${text}" to be added later (do not draw any text). The mascot: ${MASCOT.prompt_en}. Style: ${STYLE_EN}. ${AVOID_EN}`;
}

export async function geminiThumbnail(slug, title, text) {
  const ref = hasReference() ? [{ mime: 'image/png', data: fs.readFileSync(referenceFile()).toString('base64') }] : [];
  const img = await gemini.image({ prompt: thumbnailPrompt(title, text), refs: ref });
  const raw = `${thumbBasePath(slug)}.raw`;
  fs.writeFileSync(raw, img.buffer);
  try { await normalize(raw, thumbBasePath(slug)); } finally { fs.rmSync(raw, { force: true }); }
}

/** Recibe una imagen generada en Google Flow (extensión o importación manual). n = 0 → miniatura. */
export async function receiveFlowImage(project, n, buf) {
  if (!buf?.length) throw Object.assign(new Error('Archivo vacío.'), { http: 400 });
  const target = n === 0 ? thumbBasePath(project.slug) : sceneImagePath(project.slug, n);
  if (n !== 0 && !project.scenes.some((s) => s.n === n)) throw Object.assign(new Error(`El proyecto no tiene escena ${n}.`), { http: 400 });
  const raw = paths.project(project.slug, 'flow', `escena_${String(n).padStart(3, '0')}_${Date.now()}`);
  fs.mkdirSync(paths.project(project.slug, 'flow'), { recursive: true });
  fs.writeFileSync(raw, buf);
  try { await normalize(raw, target); } catch (e) { throw Object.assign(new Error(`No es una imagen válida: ${e.message.slice(0, 200)}`), { http: 400 }); }
  return target;
}
