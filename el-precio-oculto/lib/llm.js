// IA de texto y visión. Proveedores reales: Gemini (REST), Claude (SDK oficial) o Pollinations (texto, sin clave).
// Ninguna función devuelve contenido de relleno: si el proveedor falla, se lanza un error con el motivo.
import Anthropic from '@anthropic-ai/sdk';
import { config, llmProviderName, visionProviderName } from './config.js';
import { fetchJson, fetchRetry, ServiceError, sleep } from './http.js';

const GEMINI = 'https://generativelanguage.googleapis.com/v1beta/models';
let anthropicClient;
const anthropic = () => (anthropicClient ??= new Anthropic({ apiKey: config.anthropicKey }));

/** Extrae el primer objeto/array JSON de un texto (los modelos a veces añaden ``` o comentarios). */
export function parseJsonLoose(text) {
  const clean = String(text).replace(/```(?:json)?/gi, '').trim();
  try { return JSON.parse(clean); } catch { /* sigue */ }
  const starts = [clean.indexOf('{'), clean.indexOf('[')].filter((i) => i >= 0);
  if (!starts.length) throw new Error('La IA no devolvió JSON.');
  const start = Math.min(...starts);
  const open = clean[start];
  const close = open === '{' ? '}' : ']';
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < clean.length; i++) {
    const c = clean[i];
    if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true;
    else if (c === open) depth++;
    else if (c === close && --depth === 0) return JSON.parse(clean.slice(start, i + 1));
  }
  throw new Error('JSON incompleto en la respuesta de la IA.');
}

/**
 * @param {object} o
 * @param {string} o.system
 * @param {string} o.prompt
 * @param {boolean} [o.json]
 * @param {{mime:string,data:string}[]} [o.images] base64
 * @param {string} [o.youtubeUrl] sólo Gemini: el modelo ve y escucha el video público
 * @param {boolean} [o.search] búsqueda web real con fuentes (Gemini Google Search o Claude web_search)
 * @param {string} [o.provider]
 * @returns {Promise<{text:string, data?:any, sources:{title:string,url:string}[], provider:string}>}
 */
export async function generate(o) {
  const needsVision = (o.images?.length ?? 0) > 0;
  const provider = o.provider || (needsVision ? visionProviderName() : llmProviderName());
  if (!provider) throw new ServiceError('IA', 'Esta operación necesita una IA con visión: añade GEMINI_API_KEY (gratis) o ANTHROPIC_API_KEY.');
  if (o.youtubeUrl && provider !== 'gemini') throw new ServiceError('IA', 'Ver el video directamente sólo es posible con GEMINI_API_KEY.');
  const call = () => {
    if (provider === 'gemini') return gemini(o);
    if (provider === 'anthropic') return claude(o);
    if (provider === 'pollinations') {
      if (needsVision) throw new ServiceError('Pollinations', 'no admite imágenes; añade GEMINI_API_KEY.');
      return pollinations(o);
    }
    throw new ServiceError('IA', `proveedor desconocido: ${provider}`);
  };
  // Una respuesta JSON rota o cortada se pide de nuevo (máx. 3 intentos); nunca se rellena.
  let lastErr;
  for (let attempt = 0; attempt < (o.json ? 3 : 1); attempt++) {
    const out = await call();
    out.provider = provider;
    if (!o.json) return out;
    try { out.data = parseJsonLoose(out.text); return out; } catch (e) {
      lastErr = new ServiceError(provider, `${e.message} (inicio de la respuesta: ${out.text.slice(0, 160).replace(/\s+/g, ' ')}…)`);
      if (process.env.DEBUG_LLM) console.error('[LLM JSON inválido]', out.text);
    }
  }
  throw lastErr;
}

async function gemini(o) {
  if (!config.geminiKey) throw new ServiceError('Gemini', 'falta GEMINI_API_KEY');
  const parts = [];
  if (o.youtubeUrl) parts.push({ fileData: { fileUri: o.youtubeUrl, mimeType: 'video/*' } });
  for (const img of o.images || []) parts.push({ inlineData: { mimeType: img.mime, data: img.data } });
  parts.push({ text: o.prompt });
  const body = {
    systemInstruction: { parts: [{ text: o.system }] },
    contents: [{ role: 'user', parts }],
    generationConfig: { temperature: o.temperature ?? 0.7, maxOutputTokens: 16384 },
  };
  if (o.search) body.tools = [{ google_search: {} }];
  else if (o.json) body.generationConfig.responseMimeType = 'application/json';
  const res = await fetchJson('Gemini', `${GEMINI}/${config.geminiTextModel}:generateContent?key=${encodeURIComponent(config.geminiKey)}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  }, { retries: 3, timeoutMs: 300000, backoffMs: 8000 });
  const cand = res.candidates?.[0];
  const text = (cand?.content?.parts || []).map((p) => p.text || '').join('');
  if (!text) throw new ServiceError('Gemini', `respuesta vacía (${cand?.finishReason || res.promptFeedback?.blockReason || 'sin motivo'})`);
  const sources = (cand?.groundingMetadata?.groundingChunks || [])
    .filter((c) => c.web?.uri).map((c) => ({ title: c.web.title || c.web.uri, url: c.web.uri }));
  return { text, sources };
}

async function claude(o) {
  if (!config.anthropicKey) throw new ServiceError('Claude', 'falta ANTHROPIC_API_KEY');
  const content = [];
  for (const img of o.images || []) content.push({ type: 'image', source: { type: 'base64', media_type: img.mime, data: img.data } });
  content.push({ type: 'text', text: o.json ? `${o.prompt}\n\nResponde únicamente con JSON válido.` : o.prompt });
  const stream = anthropic().messages.stream({
    model: config.anthropicModel,
    max_tokens: 32000,
    output_config: { effort: 'medium' },
    system: o.system,
    messages: [{ role: 'user', content }],
    ...(o.search ? { tools: [{ type: 'web_search_20260209', name: 'web_search', max_uses: 6 }] } : {}),
  });
  let msg;
  try { msg = await stream.finalMessage(); } catch (e) {
    throw new ServiceError('Claude', e?.message || String(e), { status: e?.status, retriable: e?.status === 429 || e?.status >= 500 });
  }
  if (msg.stop_reason === 'refusal') throw new ServiceError('Claude', `rechazó la petición (${msg.stop_details?.category || 'sin categoría'})`);
  const sources = [];
  let text = '';
  for (const b of msg.content) {
    if (b.type === 'text') text += b.text;
    if (b.type === 'web_search_tool_result' && Array.isArray(b.content)) {
      for (const r of b.content) if (r.type === 'web_search_result') sources.push({ title: r.title, url: r.url });
    }
  }
  if (!text) throw new ServiceError('Claude', 'respuesta vacía');
  return { text, sources };
}

let lastPollinationsText = 0;
async function pollinations(o) {
  // Plan gratuito sin token: 1 respuesta cada 45 s por IP.
  const gap = config.pollinationsToken ? 1000 : 47000;
  const wait = lastPollinationsText + gap - Date.now();
  if (wait > 0) await sleep(wait);
  const headers = { 'content-type': 'application/json' };
  if (config.pollinationsToken) headers.authorization = `Bearer ${config.pollinationsToken}`;
  const body = {
    model: config.pollinationsToken ? 'openai' : 'openai-fast',
    max_tokens: 12000,
    reasoning_effort: 'low',
    messages: [{ role: 'system', content: o.system }, { role: 'user', content: o.prompt }],
    ...(o.json ? { response_format: { type: 'json_object' } } : {}),
    private: true,
  };
  let j;
  try {
    const res = await fetchRetry('Pollinations', 'https://text.pollinations.ai/openai', { method: 'POST', headers, body: JSON.stringify(body) }, { retries: 5, timeoutMs: 240000, backoffMs: 20000 });
    j = await res.json();
  } finally { lastPollinationsText = Date.now(); }
  const text = j.choices?.[0]?.message?.content || '';
  if (!text) throw new ServiceError('Pollinations', 'respuesta vacía');
  return { text, sources: [] };
}
