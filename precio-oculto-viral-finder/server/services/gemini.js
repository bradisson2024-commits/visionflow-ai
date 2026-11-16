// Google Gemini (AI Studio): texto, visión, búsqueda con Google y fuentes, comprensión de video de YouTube,
// generación de imágenes y síntesis de voz. Todas son llamadas reales a la API REST oficial.
import { getSetting } from '../core/settings.js';
import { requestJson, ExternalError } from '../core/http-client.js';

const base = () => process.env.EPO_GEMINI_BASE || 'https://generativelanguage.googleapis.com/v1beta';

function key() {
  const k = getSetting('GEMINI_API_KEY');
  if (!k) throw new ExternalError('Gemini', 'falta la clave GEMINI_API_KEY. Créala gratis en aistudio.google.com/apikey y pégala en Configuración.');
  return k;
}

const endpoint = (model) => `${base()}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key())}`;
const post = (op, model, body, timeout = 300000) =>
  requestJson('Gemini', op, endpoint(model), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }, { attempts: 3, timeout });

/** Extrae JSON aunque venga envuelto en ``` o con texto alrededor. */
export function extractJson(text) {
  const t = String(text).trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  try { return JSON.parse(t); } catch { /* sigue */ }
  const i = Math.min(...['{', '['].map((c) => { const k = t.indexOf(c); return k < 0 ? Infinity : k; }));
  const j = Math.max(t.lastIndexOf('}'), t.lastIndexOf(']'));
  if (i === Infinity || j <= i) throw new Error('la respuesta no contiene JSON');
  return JSON.parse(t.slice(i, j + 1));
}

function why(res) {
  const c = res.candidates?.[0];
  return c?.finishReason || res.promptFeedback?.blockReason || 'sin motivo';
}

/**
 * @param {{system?:string, prompt:string, json?:boolean, search?:boolean, images?:{mime:string,data:string}[], youtubeUrl?:string, temperature?:number}} o
 * @returns {Promise<{text:string, data?:any, sources:{title:string,url:string}[]}>}
 */
export async function ask(o) {
  const parts = [];
  if (o.youtubeUrl) parts.push({ fileData: { fileUri: o.youtubeUrl } });
  for (const im of o.images || []) parts.push({ inlineData: { mimeType: im.mime, data: im.data } });
  parts.push({ text: o.prompt });
  const body = {
    contents: [{ role: 'user', parts }],
    generationConfig: { temperature: o.temperature ?? 0.6, maxOutputTokens: 32768 },
  };
  if (o.system) body.systemInstruction = { parts: [{ text: o.system }] };
  if (o.search) body.tools = [{ google_search: {} }];
  else if (o.json) body.generationConfig.responseMimeType = 'application/json';

  let lastErr;
  for (let attempt = 0; attempt < (o.json ? 3 : 1); attempt++) {
    const res = await post(o.youtubeUrl ? 'video' : o.search ? 'search' : o.images?.length ? 'vision' : 'text', getSetting('GEMINI_TEXT_MODEL'), body);
    const cand = res.candidates?.[0];
    const text = (cand?.content?.parts || []).map((p) => p.text || '').join('').trim();
    if (!text) { lastErr = new ExternalError('Gemini', `respuesta vacía (${why(res)})`); continue; }
    const sources = [];
    for (const ch of cand?.groundingMetadata?.groundingChunks || []) if (ch.web?.uri) sources.push({ title: ch.web.title || ch.web.uri, url: ch.web.uri });
    if (!o.json) return { text, sources };
    try { return { text, data: extractJson(text), sources }; } catch (e) { lastErr = new ExternalError('Gemini', `JSON no válido (${e.message})`); }
  }
  throw lastErr;
}

/** Imagen real con el modelo de imagen de Gemini. `refs` = imágenes de referencia (la mascota). */
export async function image({ prompt, refs = [], aspect = '16:9' }) {
  const parts = [];
  for (const r of refs) parts.push({ inlineData: { mimeType: r.mime, data: r.data } });
  parts.push({ text: prompt });
  const res = await post('image', getSetting('GEMINI_IMAGE_MODEL'), {
    contents: [{ role: 'user', parts }],
    generationConfig: { responseModalities: ['IMAGE'], imageConfig: { aspectRatio: aspect } },
  }, 240000);
  const part = (res.candidates?.[0]?.content?.parts || []).find((p) => p.inlineData?.data);
  if (!part) throw new ExternalError('Gemini Imagen', `no devolvió imagen (${why(res)}). Si el error menciona facturación o cuota, activa la facturación en Google AI Studio o usa Google Flow.`);
  return { buffer: Buffer.from(part.inlineData.data, 'base64'), mime: part.inlineData.mimeType || 'image/png' };
}

/** Voz real (PCM 16 bits). */
export async function speech({ text, voice, direction }) {
  const res = await post('tts', getSetting('GEMINI_TTS_MODEL'), {
    contents: [{ parts: [{ text: `${direction}\n\n${text}` }] }],
    generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } } },
  }, 240000);
  const part = (res.candidates?.[0]?.content?.parts || []).find((p) => p.inlineData?.data);
  if (!part) throw new ExternalError('Gemini TTS', `no devolvió audio (${why(res)})`);
  const rate = Number(/rate=(\d+)/.exec(part.inlineData.mimeType || '')?.[1] || 24000);
  return { pcm: Buffer.from(part.inlineData.data, 'base64'), rate };
}

/** Comprobación de la clave (lista de modelos). */
export async function checkKey() {
  const r = await requestJson('Gemini', 'models', `${base()}/models?key=${encodeURIComponent(key())}&pageSize=200`, {}, { attempts: 1, timeout: 20000 });
  const names = (r.models || []).map((m) => m.name.replace('models/', ''));
  return { models: names.length, text: names.includes(getSetting('GEMINI_TEXT_MODEL')), image: names.includes(getSetting('GEMINI_IMAGE_MODEL')), tts: names.includes(getSetting('GEMINI_TTS_MODEL')) };
}
