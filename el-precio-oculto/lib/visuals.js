// Módulo 13 · Pasos 4–5: personajes fijos, plan visual por escena y generación real de imágenes Stickman estáticas.
import fs from 'node:fs';
import path from 'node:path';
import { config, imageProviderName } from './config.js';
import { fetchRetry, fetchJson, ServiceError, sleep } from './http.js';
import { generate } from './llm.js';
import { ffmpeg, ffmpegBuffer } from './media.js';

// Estilo fijo. La escena va primero en el prompt (los modelos de difusión priorizan el inicio) y sin negaciones,
// que en FLUX/SANA suelen producir justo lo que se niega.
export const STYLE = 'flat 2D hand-drawn stick figure cartoon, xkcd-like doodle, bold clean black ink outlines, plain solid cream beige background, only red and yellow accent colors, simple expressive stick figures with round white heads and dot eyes, minimal objects, explainer video still frame, static single image';
export const NEGATIVE = 'Do not include: photorealism, 3D, shading, gradients, realistic people, written text or letters, logos, watermark, multiple panels.';

export const DEFAULT_NARRATOR = {
  id: 'investigador',
  name: 'El Investigador',
  description: 'stick figure man with a round white head, thin black stick body, a small yellow detective fedora hat and a red scarf',
};

export async function buildCharacters({ topic, script }) {
  const r = await generate({
    json: true, temperature: 0.4,
    system: 'Diseñas un elenco mínimo de personajes Stickman para un video explicativo. Cada personaje debe ser reconocible por 1 o 2 accesorios de color rojo o amarillo, siempre los mismos.',
    prompt: `Tema: ${topic}\nGuion (extracto): ${script.slice(0, 4000)}\n\nEl protagonista fijo es: ${DEFAULT_NARRATOR.name} (${DEFAULT_NARRATOR.description}).
Propón de 1 a 3 personajes secundarios (name y role en español) que aparezcan en la historia (p. ej. cliente, dueño, empleado). Describe su aspecto EN INGLÉS para un generador de imágenes, empezando por "stick figure".
Devuelve JSON {"characters": [{"id": "minusculas_sin_espacios", "name": string, "role": string, "description": string}]}`,
  });
  const extra = (r.data.characters || []).filter((c) => c.id && c.description).slice(0, 3)
    .map((c) => ({ id: String(c.id).toLowerCase().replace(/[^a-z0-9_]/g, '_'), name: c.name, role: c.role, description: c.description }));
  const isNarrator = (c) => /investigador|narrador|protagonista/i.test(`${c.id} ${c.name} ${c.role || ''}`) || /fedora/i.test(c.description);
  const seen = new Set([DEFAULT_NARRATOR.id]);
  const unique = extra.filter((c) => !isNarrator(c) && !seen.has(c.id) && seen.add(c.id));
  return [DEFAULT_NARRATOR, ...unique];
}

/**
 * Para cada escena, qué debe verse EXACTAMENTE mientras se escucha su narración.
 * Se procesa por lotes y se valida que vuelvan todas las escenas, en orden.
 */
export async function planVisuals({ scenes, characters, title, log }) {
  const cast = characters.map((c) => `- ${c.id}: ${c.name}${c.role ? ` (${c.role})` : ''} → ${c.description}`).join('\n');
  const BATCH = 12;
  for (let start = 0; start < scenes.length; start += BATCH) {
    const batch = scenes.slice(start, start + BATCH);
    const ctxBefore = scenes[start - 1]?.narration || '';
    const ctxAfter = scenes[start + BATCH]?.narration || '';
    let data;
    for (let attempt = 0; attempt < 3; attempt++) {
      const r = await generate({
        json: true, temperature: 0.5,
        system: `Eres director de arte de un canal de videos explicativos con ilustraciones Stickman estáticas.
Para cada fragmento de narración diseñas UNA ilustración que represente exactamente lo que se dice en ese fragmento: ni lo anterior ni lo siguiente.
Usa metáforas visuales simples (flechas, monedas, edificios, contratos, lupas, mapas, gráficos dibujados a mano) cuando se hable de ideas abstractas.
Nunca pidas texto escrito dentro de la imagen. No dibujes logotipos exactos de marcas: represéntalas de forma genérica y reconocible.
Personajes disponibles (usa sus ids y no cambies su aspecto):\n${cast}`,
        prompt: `Video: «${title}»
Contexto anterior: ${ctxBefore || '(inicio del video)'}
Contexto posterior (NO ilustrar): ${ctxAfter || '(fin)'}

Escenas a ilustrar:
${batch.map((s) => `${s.n}. ${s.narration}`).join('\n')}

Devuelve JSON {"scenes": [{"n": number, "visual_es": string (qué se ve, en español, una frase), "prompt_en": string (descripción de la imagen en inglés: personajes con sus accesorios, acción, expresión, objetos, escenario; 25–60 palabras; sin estilo), "characters": [ids], "sfx": null | "whoosh" | "revelacion" | "tension"}]}
Debe haber exactamente ${batch.length} elementos con n = ${batch.map((s) => s.n).join(', ')}. Usa "revelacion" sólo cuando la narración revela un dato sorprendente.`,
      });
      const arr = r.data.scenes || [];
      const ok = arr.length === batch.length && batch.every((s, i) => Number(arr[i]?.n) === s.n && arr[i]?.prompt_en);
      if (ok) { data = arr; break; }
      log?.(`Plan visual escenas ${batch[0].n}–${batch.at(-1).n}: respuesta incompleta, reintento ${attempt + 1}.`);
    }
    if (!data) throw new Error(`No se pudo planificar la imagen de las escenas ${batch[0].n}–${batch.at(-1).n}.`);
    batch.forEach((s, i) => {
      const d = data[i];
      const chars = (d.characters || []).filter((id) => characters.some((c) => c.id === id));
      s.visual = { description: d.visual_es, prompt: d.prompt_en, characters: chars };
      s.sfx = ['whoosh', 'revelacion', 'tension'].includes(d.sfx) ? d.sfx : null;
    });
    log?.(`Plan visual: escenas ${batch[0].n}–${batch.at(-1).n} listas.`);
  }
  return scenes;
}

export function fullPrompt(scene, characters, extraFix = '') {
  const used = characters.filter((c) => scene.visual.characters.includes(c.id));
  const castTxt = used.map((c) => `${c.name} is a ${c.description}`).join('. ');
  return `${scene.visual.prompt}${castTxt ? `. ${castTxt}` : ''}${extraFix ? `. ${extraFix}` : ''}. Style: ${STYLE}. ${NEGATIVE}`;
}

// ---------------------------------------------------------------- proveedores

let lastPollinations = 0;
async function pollinationsImage(prompt, seed) {
  const minGap = config.pollinationsToken ? 3000 : 16000;
  const wait = lastPollinations + minGap - Date.now();
  if (wait > 0) await sleep(wait);
  // Sin token sólo está disponible el modelo «sana» (calidad insuficiente para este estilo: se avisa en Configuración).
  const p = new URLSearchParams({ width: '1280', height: '720', seed: String(seed), nologo: 'true', private: 'true', enhance: 'false', ...(config.pollinationsToken ? { model: 'flux' } : {}) });
  const headers = config.pollinationsToken ? { authorization: `Bearer ${config.pollinationsToken}` } : {};
  try {
    const res = await fetchRetry('Pollinations', `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt.slice(0, 1800))}?${p}`, { headers }, { retries: 4, timeoutMs: 180000, backoffMs: 20000 });
    const type = res.headers.get('content-type') || '';
    if (!type.startsWith('image/')) throw new ServiceError('Pollinations', `respuesta sin imagen (${type})`);
    return { buffer: Buffer.from(await res.arrayBuffer()), mime: type };
  } finally { lastPollinations = Date.now(); }
}

async function geminiImage(prompt, refImage) {
  if (!config.geminiKey) throw new ServiceError('Gemini Imagen', 'falta GEMINI_API_KEY');
  const parts = [];
  if (refImage) {
    parts.push({ text: 'Reference sheet of the recurring characters. Keep their exact look (same accessories and colors):' });
    parts.push({ inlineData: { mimeType: 'image/png', data: refImage.toString('base64') } });
  }
  parts.push({ text: prompt });
  const res = await fetchJson('Gemini Imagen', `https://generativelanguage.googleapis.com/v1beta/models/${config.geminiImageModel}:generateContent?key=${encodeURIComponent(config.geminiKey)}`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ contents: [{ role: 'user', parts }], generationConfig: { responseModalities: ['IMAGE'], imageConfig: { aspectRatio: '16:9' } } }),
  }, { retries: 3, timeoutMs: 180000, backoffMs: 10000 });
  const part = (res.candidates?.[0]?.content?.parts || []).find((p) => p.inlineData?.data);
  if (!part) throw new ServiceError('Gemini Imagen', `no devolvió imagen (${res.candidates?.[0]?.finishReason || res.promptFeedback?.blockReason || 'sin motivo'})`);
  return { buffer: Buffer.from(part.inlineData.data, 'base64'), mime: part.inlineData.mimeType };
}

/** Normaliza a PNG 1920x1080 sobre fondo crema (sin recortar el dibujo). */
export async function normalizeImage(inFile, outFile) {
  await ffmpeg(['-i', inFile, '-vf', 'scale=1920:1080:force_original_aspect_ratio=decrease:flags=lanczos,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=0xF3E9D2,format=rgb24', '-frames:v', '1', outFile]);
}

export async function generateImageFile({ prompt, seed, outFile, refImage }) {
  const provider = imageProviderName();
  const img = provider === 'gemini' ? await geminiImage(prompt, refImage) : await pollinationsImage(prompt, seed);
  const raw = `${outFile}.raw`;
  fs.writeFileSync(raw, img.buffer);
  try { await normalizeImage(raw, outFile); } finally { fs.rmSync(raw, { force: true }); }
  return { provider, bytes: img.buffer.length };
}

export async function generateCharacterSheet({ characters, outFile, seed }) {
  const prompt = `Character reference sheet: ${characters.map((c) => `${c.name}, a ${c.description}`).join('; ')}. All characters standing side by side, full body, evenly spaced. Style: ${STYLE}. ${NEGATIVE}`;
  return generateImageFile({ prompt, seed, outFile });
}

// ---------------------------------------------------------------- comprobaciones locales

/** Huella perceptual (dHash 64 bits) calculada con FFmpeg, para detectar imágenes repetidas. */
export async function dhash(file) {
  const buf = await ffmpegBuffer(['-i', file, '-frames:v', '1', '-vf', 'scale=9:8:flags=area,format=gray', '-f', 'rawvideo', '-']);
  let bits = '';
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) bits += buf[y * 9 + x] > buf[y * 9 + x + 1] ? '1' : '0';
  return bits;
}

export const hamming = (a, b) => { let d = 0; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) d++; return d; };

export function imageRelPath(scene) { return path.posix.join('imagenes', `${scene.id}.png`); }
