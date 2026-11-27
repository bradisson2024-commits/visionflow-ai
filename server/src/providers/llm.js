// Modelos de lenguaje: análisis del guion (división en escenas) y redacción de guiones.
// Proveedores: Anthropic (Claude, por defecto), OpenAI y Google Gemini.
import Anthropic from '@anthropic-ai/sdk';
import { getSettings, requireKey, BASE_URLS } from '../settings.js';
import { json, ProviderError } from './http.js';

function parseJsonText(provider, text) {
  try { return JSON.parse(text); } catch { /* intenta extraer el bloque JSON */ }
  const m = text.match(/\{[\s\S]*\}/);
  if (m) { try { return JSON.parse(m[0]); } catch { /* sin JSON válido */ } }
  throw new ProviderError(provider, 0, 'la respuesta no contiene JSON válido');
}

async function anthropicCall({ system, user, schema, signal, maxTokens = 64000 }) {
  const s = getSettings();
  const client = new Anthropic({ apiKey: requireKey('anthropic'), baseURL: BASE_URLS.anthropic, maxRetries: 3 });
  const params = {
    model: s.anthropic_model,
    max_tokens: maxTokens,
    system,
    messages: [{ role: 'user', content: user }],
    thinking: { type: 'adaptive' },
    output_config: { effort: 'medium', ...(schema ? { format: { type: 'json_schema', schema } } : {}) },
  };
  // Respaldo en el servidor si el modelo rechaza la petición (solo modelos que lo admiten).
  if (/^claude-(opus-5|fable-5|sonnet-5-5)/.test(s.anthropic_model)) {
    params.betas = ['server-side-fallback-2026-07-01'];
    params.fallbacks = 'default';
  }
  let msg;
  try {
    const stream = client.beta.messages.stream(params, { signal });
    msg = await stream.finalMessage();
  } catch (e) {
    if (e instanceof Anthropic.APIError) throw new ProviderError('Anthropic', e.status || 0, e.message);
    throw e;
  }
  if (msg.stop_reason === 'refusal') throw new ProviderError('Anthropic', 0, 'el modelo rechazó la solicitud' + (msg.stop_details?.explanation ? `: ${msg.stop_details.explanation}` : ''));
  if (msg.stop_reason === 'max_tokens') throw new ProviderError('Anthropic', 0, 'la respuesta superó el límite de longitud; divide el guion en partes más cortas');
  const text = msg.content.filter(b => b.type === 'text').map(b => b.text).join('');
  return schema ? parseJsonText('Anthropic', text) : text.trim();
}

async function openaiCall({ system, user, schema, signal }) {
  const s = getSettings();
  const body = {
    model: s.openai_llm_model,
    messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
  };
  if (schema) body.response_format = { type: 'json_schema', json_schema: { name: 'result', strict: true, schema } };
  const r = await json('OpenAI', `${BASE_URLS.openai}/v1/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${requireKey('openai')}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }, { signal });
  const text = r.choices?.[0]?.message?.content || '';
  if (r.choices?.[0]?.message?.refusal) throw new ProviderError('OpenAI', 0, r.choices[0].message.refusal);
  return schema ? parseJsonText('OpenAI', text) : text.trim();
}

// Gemini admite un subconjunto de JSON Schema: se eliminan las claves no soportadas.
function geminiSchema(s) {
  if (Array.isArray(s)) return s.map(geminiSchema);
  if (s && typeof s === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(s)) if (k !== 'additionalProperties') out[k] = geminiSchema(v);
    return out;
  }
  return s;
}

async function geminiCall({ system, user, schema, signal }) {
  const s = getSettings();
  const body = {
    systemInstruction: { parts: [{ text: system }] },
    contents: [{ role: 'user', parts: [{ text: user }] }],
    generationConfig: schema ? { responseMimeType: 'application/json', responseSchema: geminiSchema(schema) } : {},
  };
  const r = await json('Gemini', `${BASE_URLS.gemini}/v1beta/models/${s.gemini_llm_model}:generateContent`, {
    method: 'POST',
    headers: { 'x-goog-api-key': requireKey('gemini'), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }, { signal });
  const text = r.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('') || '';
  if (!text) throw new ProviderError('Gemini', 0, 'respuesta vacía' + (r.promptFeedback?.blockReason ? ` (${r.promptFeedback.blockReason})` : ''));
  return schema ? parseJsonText('Gemini', text) : text.trim();
}

// ---- GRATIS: Groq (cuota gratuita con límites por minuto/día; API compatible con OpenAI) ----
async function groqCall({ system, user, schema, signal }) {
  const s = getSettings();
  const body = {
    model: s.groq_model,
    messages: [
      { role: 'system', content: schema ? `${system}\n\nResponde SOLO con un objeto JSON válido que cumpla exactamente este JSON Schema:\n${JSON.stringify(schema)}` : system },
      { role: 'user', content: user },
    ],
    temperature: 0.4,
  };
  if (schema) body.response_format = { type: 'json_object' };
  const r = await json('Groq', `${BASE_URLS.groq}/v1/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${requireKey('groq')}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }, { signal, retries: 4 });
  const text = r.choices?.[0]?.message?.content || '';
  return schema ? parseJsonText('Groq', text) : text.trim();
}

// ---- GRATIS Y LOCAL: Ollama (modelos abiertos en tu computador, sin límites ni coste) ----
async function ollamaCall({ system, user, schema, signal }) {
  const s = getSettings();
  const base = s.ollama_url.replace(/\/$/, '');
  const body = {
    model: s.ollama_model,
    stream: false,
    messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
    options: { temperature: 0.4, num_ctx: 16384 },
  };
  if (schema) body.format = schema; // salidas estructuradas de Ollama (JSON Schema)
  let r;
  try {
    // En CPU un modelo local puede tardar varios minutos en un guion largo.
    r = await json('Ollama', `${base}/api/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, { signal, retries: 1, timeoutMs: 45 * 60_000 });
  } catch (e) {
    if (e.status === 0) throw new ProviderError('Ollama', 0, `no responde en ${base}. ¿Está abierto Ollama? (${e.message})`);
    if (e.status === 404) throw new ProviderError('Ollama', 404, `el modelo «${s.ollama_model}» no está descargado. Ejecuta: ollama pull ${s.ollama_model}`);
    throw e;
  }
  const text = r.message?.content || '';
  return schema ? parseJsonText('Ollama', text) : text.trim();
}

const CALLS = { anthropic: anthropicCall, openai: openaiCall, gemini: geminiCall, groq: groqCall, ollama: ollamaCall };

export async function llm(opts) {
  const provider = getSettings().llm_provider;
  const fn = CALLS[provider];
  if (!fn) throw new Error('Proveedor de lenguaje no válido: ' + provider);
  return fn(opts);
}
