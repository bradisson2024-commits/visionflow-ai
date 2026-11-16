// Identidad fija de la mascota de EL PRECIO OCULTO. No se modifica entre escenas ni proyectos.
import fs from 'node:fs';
import path from 'node:path';
import { paths } from '../core/paths.js';

export const MASCOT = {
  nombre: 'El Detective del Precio Oculto',
  rasgos_es: ['cabeza redonda blanca', 'ojos negros expresivos', 'sombrero fedora negro', 'gabardina marrón', 'corbata negra', 'lupa dorada', 'etiqueta de precio con el símbolo $', 'detalles amarillos'],
  prompt_en: 'the recurring mascot "The Hidden Price Detective": a stick figure with a perfectly round WHITE head outlined in black, two expressive solid BLACK oval eyes, a BLACK fedora hat with a yellow hatband, a BROWN trench coat (belted, collar up) over a thin black stick body, a thin BLACK necktie, holding a GOLDEN magnifying glass, and a small yellow PRICE TAG with a black "$" symbol hanging from the coat pocket; black stick arms and legs',
};

export const STYLE_EN = 'static 2D hand-drawn stickman illustration for a YouTube explainer, thick clean black ink outlines, flat colors, warm cream paper background, accent colors limited to yellow, brown and red, simple readable composition, expressive faces, one single frame (no comic panels)';
export const AVOID_EN = 'Avoid: photorealism, 3D rendering, gradients, real human faces, written words or letters, logos, watermarks, motion blur, multiple panels.';

export const referenceFile = () => path.join(paths.mascot, 'referencia.png');
export const hasReference = () => fs.existsSync(referenceFile());

/** Guarda la imagen de referencia (PNG rasterizado en el navegador a partir del SVG oficial). */
export function saveReference(buf) {
  if (!buf?.length || buf.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') throw Object.assign(new Error('Se esperaba un PNG.'), { http: 400 });
  fs.mkdirSync(paths.mascot, { recursive: true });
  fs.writeFileSync(referenceFile(), buf);
}

export function scenePrompt(scene) {
  return `${scene.image_prompt}. ${scene.image_prompt.includes('detective') || scene.image_prompt.includes('mascot') ? `The mascot looks exactly like the reference: ${MASCOT.prompt_en}.` : ''} Style: ${STYLE_EN}. ${AVOID_EN}`.replace(/\s+/g, ' ').trim();
}
