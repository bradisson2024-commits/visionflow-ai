// Generación de imágenes. Proveedores: OpenAI (gpt-image-1), Google Gemini Image y Replicate (FLUX).
// Todos admiten imágenes de referencia de personajes para mantener la consistencia
// (OpenAI: /images/edits con varias imágenes; Gemini: imágenes en línea; Replicate: FLUX Kontext).
import fs from 'node:fs';
import path from 'node:path';
import { getSettings, requireKey, BASE_URLS } from '../settings.js';
import { json, buffer, ProviderError } from './http.js';
import { comfyImage } from './comfyui.js';

const OPENAI_SIZE = { '16:9': '1536x1024', '9:16': '1024x1536', '1:1': '1024x1024' };
const mime = p => (p.endsWith('.png') ? 'image/png' : p.endsWith('.webp') ? 'image/webp' : 'image/jpeg');

async function openaiImage({ prompt, refs, aspect, signal }) {
  const s = getSettings();
  const key = requireKey('openai');
  let r;
  if (refs.length) {
    const fd = new FormData();
    fd.append('model', s.openai_image_model);
    fd.append('prompt', prompt);
    fd.append('size', OPENAI_SIZE[aspect] || '1536x1024');
    fd.append('quality', s.openai_image_quality);
    fd.append('n', '1');
    for (const p of refs.slice(0, 8)) fd.append('image[]', new Blob([fs.readFileSync(p)], { type: mime(p) }), path.basename(p));
    r = await json('OpenAI', `${BASE_URLS.openai}/v1/images/edits`, { method: 'POST', headers: { Authorization: `Bearer ${key}` }, body: fd }, { signal });
  } else {
    r = await json('OpenAI', `${BASE_URLS.openai}/v1/images/generations`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: s.openai_image_model, prompt, size: OPENAI_SIZE[aspect] || '1536x1024', quality: s.openai_image_quality, n: 1 }),
    }, { signal });
  }
  const d = r.data?.[0];
  if (d?.b64_json) return Buffer.from(d.b64_json, 'base64');
  if (d?.url) return buffer('OpenAI', d.url, {}, { signal });
  throw new ProviderError('OpenAI', 0, 'no se recibió ninguna imagen');
}

async function geminiImage({ prompt, refs, aspect, signal }) {
  const s = getSettings();
  const parts = [{ text: prompt }];
  for (const p of refs.slice(0, 3)) parts.push({ inline_data: { mime_type: mime(p), data: fs.readFileSync(p).toString('base64') } });
  const r = await json('Gemini', `${BASE_URLS.gemini}/v1beta/models/${s.gemini_image_model}:generateContent`, {
    method: 'POST',
    headers: { 'x-goog-api-key': requireKey('gemini'), 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents: [{ role: 'user', parts }], generationConfig: { responseModalities: ['IMAGE'], imageConfig: { aspectRatio: aspect } } }),
  }, { signal });
  for (const part of r.candidates?.[0]?.content?.parts || []) {
    const inline = part.inlineData || part.inline_data;
    if (inline?.data) return Buffer.from(inline.data, 'base64');
  }
  throw new ProviderError('Gemini', 0, 'no se recibió ninguna imagen' + (r.candidates?.[0]?.finishReason ? ` (${r.candidates[0].finishReason})` : ''));
}

async function replicateImage({ prompt, refs, aspect, signal }) {
  const s = getSettings();
  const key = requireKey('replicate');
  const model = refs.length ? s.replicate_ref_model : s.replicate_model;
  const input = { prompt, aspect_ratio: aspect, output_format: 'png' };
  if (refs.length) input.input_image = `data:${mime(refs[0])};base64,${fs.readFileSync(refs[0]).toString('base64')}`;
  const headers = { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Prefer: 'wait=60' };
  let pred = await json('Replicate', `${BASE_URLS.replicate}/v1/models/${model}/predictions`, { method: 'POST', headers, body: JSON.stringify({ input }) }, { signal });
  const started = Date.now();
  while (['starting', 'processing'].includes(pred.status)) {
    if (Date.now() - started > 600_000) throw new ProviderError('Replicate', 0, 'tiempo de espera agotado');
    await new Promise(r => setTimeout(r, 2000));
    if (signal?.aborted) throw signal.reason;
    pred = await json('Replicate', pred.urls.get, { headers: { Authorization: `Bearer ${key}` } }, { signal });
  }
  if (pred.status !== 'succeeded') throw new ProviderError('Replicate', 0, pred.error || `estado ${pred.status}`);
  const url = Array.isArray(pred.output) ? pred.output[0] : pred.output;
  if (!url) throw new ProviderError('Replicate', 0, 'no se recibió ninguna imagen');
  return buffer('Replicate', url, {}, { signal });
}

// GRATIS Y LOCAL: ComfyUI. Usa un prompt compacto (los modelos de difusión leen mejor
// listas de rasgos que párrafos largos) y una semilla fija por proyecto para dar coherencia.
async function comfyuiProvider({ prompt, compact, negative, refs, aspect, seed, signal, onProgress }) {
  return comfyImage({ prompt: compact || prompt, negative, refs, aspect, seed, signal, onProgress });
}

const PROVIDERS = { openai: openaiImage, gemini: geminiImage, replicate: replicateImage, comfyui: comfyuiProvider };

/**
 * Genera una imagen y la guarda en outPath. Devuelve outPath.
 * compact/negative/seed solo los usan los motores de difusión locales (ComfyUI).
 */
export async function generateImage({ prompt, compact, negative, seed, refs = [], aspect = '16:9', outPath, signal, onProgress }) {
  const provider = getSettings().image_provider;
  const fn = PROVIDERS[provider];
  if (!fn) throw new Error('Proveedor de imágenes no válido: ' + provider);
  const buf = await fn({ prompt, compact, negative, seed, refs: refs.filter(p => p && fs.existsSync(p)), aspect, signal, onProgress });
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, buf);
  return outPath;
}
