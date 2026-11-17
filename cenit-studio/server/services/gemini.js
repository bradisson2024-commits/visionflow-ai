// Google Gemini API (REST oficial, clave en cabecera x-goog-api-key).
// Texto/JSON, búsqueda con Google, comprensión de vídeos públicos de YouTube, transcripción de audio,
// imágenes con referencias (Gemini Imagen), voz (TTS) y animación de imágenes (Veo, operación de larga duración).
import { config } from '../config.js';
import { call, sleep } from '../core/http.js';
import { ServiceError } from '../core/errors.js';
import { getSetting } from '../modules/settings.js';

export const MODELS = { text: 'gemini-2.5-flash', pro: 'gemini-2.5-pro', image: 'gemini-2.5-flash-image', tts: 'gemini-2.5-flash-preview-tts', veo: 'veo-3.0-fast-generate-001' };
const model = async (k) => (await getSetting(`model.${k}`)) || MODELS[k];

function headers() {
  if (!config.geminiKey) throw new ServiceError('Gemini', 'falta GEMINI_API_KEY en el servidor (aistudio.google.com/apikey).', { status: 503 });
  return { 'x-goog-api-key': config.geminiKey, 'content-type': 'application/json' };
}
const gen = async (op, m, body, timeout = 300000) => call('Gemini', op, `${config.geminiBase}/models/${m}:generateContent`, { method: 'POST', headers: headers(), body: JSON.stringify(body) }, { timeout });
const reason = (r) => r.candidates?.[0]?.finishReason || r.promptFeedback?.blockReason || 'sin motivo';

export function parseJson(text) {
  const t = String(text).trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  try { return JSON.parse(t); } catch { /* buscar el bloque */ }
  const a = Math.min(...['{', '['].map((c) => (t.indexOf(c) < 0 ? Infinity : t.indexOf(c)))), b = Math.max(t.lastIndexOf('}'), t.lastIndexOf(']'));
  if (a === Infinity || b <= a) throw new Error('sin JSON');
  return JSON.parse(t.slice(a, b + 1));
}

/**
 * @param {{system?:string,prompt:string,json?:boolean,search?:boolean,pro?:boolean,images?:{mime:string,data:string}[],audio?:{mime:string,data:string},youtubeUrl?:string,temperature?:number}} o
 */
export async function ask(o) {
  const parts = [];
  if (o.youtubeUrl) parts.push({ fileData: { fileUri: o.youtubeUrl } });
  if (o.audio) parts.push({ inlineData: { mimeType: o.audio.mime, data: o.audio.data } });
  for (const im of o.images || []) parts.push({ inlineData: { mimeType: im.mime, data: im.data } });
  parts.push({ text: o.prompt });
  const body = { contents: [{ role: 'user', parts }], generationConfig: { temperature: o.temperature ?? 0.7, maxOutputTokens: 32768 } };
  if (o.system) body.systemInstruction = { parts: [{ text: o.system }] };
  if (o.search) body.tools = [{ google_search: {} }];
  else if (o.json) body.generationConfig.responseMimeType = 'application/json';
  const m = await model(o.pro ? 'pro' : 'text');
  let last;
  for (let i = 0; i < (o.json ? 3 : 1); i++) {
    const r = await gen(o.search ? 'búsqueda' : o.youtubeUrl ? 'vídeo' : o.audio ? 'audio' : 'texto', m, body);
    const c = r.candidates?.[0];
    const text = (c?.content?.parts || []).map((p) => p.text || '').join('').trim();
    if (!text) { last = new ServiceError('Gemini', `respuesta vacía (${reason(r)})`); continue; }
    const sources = (c?.groundingMetadata?.groundingChunks || []).filter((x) => x.web?.uri).map((x) => ({ title: x.web.title || x.web.uri, url: x.web.uri }));
    if (!o.json) return { text, sources };
    try { return { text, data: parseJson(text), sources }; } catch { last = new ServiceError('Gemini', 'la respuesta no era JSON válido'); }
  }
  throw last;
}

/** Imagen nueva. `refs`: imágenes de referencia (personajes, objetos) que condicionan el resultado. */
export async function image({ prompt, refs = [], aspect = '16:9' }) {
  const parts = [];
  refs.forEach((r, i) => { parts.push({ text: `Referencia ${i + 1}: ${r.label}` }); parts.push({ inlineData: { mimeType: r.mime, data: r.data } }); });
  parts.push({ text: prompt });
  const r = await gen('imagen', await model('image'), { contents: [{ role: 'user', parts }], generationConfig: { responseModalities: ['IMAGE'], imageConfig: { aspectRatio: aspect } } }, 240000);
  const p = (r.candidates?.[0]?.content?.parts || []).find((x) => x.inlineData?.data);
  if (!p) throw new ServiceError('Gemini Imagen', `no devolvió imagen (${reason(r)}). Si menciona facturación o cuota, activa la facturación en Google AI Studio.`);
  return { buffer: Buffer.from(p.inlineData.data, 'base64'), mime: p.inlineData.mimeType || 'image/png' };
}

/** Voz (PCM 16 bits mono). */
export async function speech({ text, voice, style }) {
  const r = await gen('voz', await model('tts'), {
    contents: [{ parts: [{ text: style ? `${style}\n\n${text}` : text }] }],
    generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } } },
  }, 240000);
  const p = (r.candidates?.[0]?.content?.parts || []).find((x) => x.inlineData?.data);
  if (!p) throw new ServiceError('Gemini TTS', `no devolvió audio (${reason(r)})`);
  return { pcm: Buffer.from(p.inlineData.data, 'base64'), rate: Number(/rate=(\d+)/.exec(p.inlineData.mimeType || '')?.[1] || 24000) };
}

/** Anima una imagen con Veo: operación de larga duración; devuelve el MP4. */
export async function animate({ prompt, image, aspect, onWait }) {
  const m = await model('veo');
  const op = await call('Gemini Veo', 'iniciar', `${config.geminiBase}/models/${m}:predictLongRunning`, {
    method: 'POST', headers: headers(),
    body: JSON.stringify({ instances: [{ prompt, image: { bytesBase64Encoded: image.data, mimeType: image.mime } }], parameters: { aspectRatio: aspect } }),
  }, { attempts: 2, timeout: 120000 });
  if (!op.name) throw new ServiceError('Gemini Veo', 'no devolvió una operación');
  const t0 = Date.now();
  for (;;) {
    await sleep(Number(process.env.VEO_POLL_MS || 10000));
    const st = await call('Gemini Veo', 'estado', `${config.geminiBase}/${op.name}`, { headers: headers() }, { attempts: 3, timeout: 60000 });
    if (st.error) throw new ServiceError('Gemini Veo', st.error.message || 'la animación falló');
    if (st.done) {
      const s = st.response?.generateVideoResponse?.generatedSamples?.[0]?.video;
      if (!s?.uri) throw new ServiceError('Gemini Veo', `terminó sin vídeo${st.response?.generateVideoResponse?.raiMediaFilteredReasons ? `: ${st.response.generateVideoResponse.raiMediaFilteredReasons.join('; ')}` : ''}`);
      const res = await call('Gemini Veo', 'descarga', s.uri, { headers: { 'x-goog-api-key': config.geminiKey } }, { raw: true, timeout: 300000 });
      return Buffer.from(await res.arrayBuffer());
    }
    onWait?.(Math.round((Date.now() - t0) / 1000));
    if (Date.now() - t0 > 15 * 60000) throw new ServiceError('Gemini Veo', 'la animación tardó más de 15 minutos');
  }
}

export async function listModels() {
  const r = await call('Gemini', 'modelos', `${config.geminiBase}/models?pageSize=500`, { headers: headers() }, { attempts: 1, timeout: 20000 });
  return (r.models || []).map((x) => x.name.replace('models/', ''));
}
