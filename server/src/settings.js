// Ajustes y claves API. Las claves se guardan en la base de datos local
// (o se leen de variables de entorno) y nunca se devuelven completas al navegador.
import { all, run } from './db.js';

export const API_KEYS = {
  anthropic: { label: 'Anthropic (Claude)', env: 'ANTHROPIC_API_KEY', use: 'Análisis del guion, división en escenas y guiones con IA', url: 'https://console.anthropic.com/settings/keys' },
  openai: { label: 'OpenAI', env: 'OPENAI_API_KEY', use: 'Imágenes (gpt-image-1), voz (TTS) y, opcionalmente, análisis del guion', url: 'https://platform.openai.com/api-keys' },
  gemini: { label: 'Google Gemini', env: 'GEMINI_API_KEY', use: 'GRATIS con límites para guion y escenas (cuota gratuita de AI Studio); las imágenes de Gemini normalmente requieren facturación', url: 'https://aistudio.google.com/apikey', free: true },
  replicate: { label: 'Replicate', env: 'REPLICATE_API_TOKEN', use: 'Imágenes con FLUX (FLUX Kontext para referencias de personaje)', url: 'https://replicate.com/account/api-tokens' },
  elevenlabs: { label: 'ElevenLabs', env: 'ELEVENLABS_API_KEY', use: 'Voces IA (narración) y Música IA', url: 'https://elevenlabs.io/app/settings/api-keys' },
  groq: { label: 'Groq', env: 'GROQ_API_KEY', use: 'GRATIS (con límites): análisis del guion y guiones con modelos abiertos (Llama, GPT-OSS, Qwen)', url: 'https://console.groq.com/keys', free: true },
};

export const DEFAULTS = {
  free_only: 'on', // modo gratuito: nunca usar servicios que piden saldo
  llm_provider: 'gemini',
  anthropic_model: 'claude-opus-5-5',
  openai_llm_model: 'gpt-4.1',
  gemini_llm_model: 'gemini-2.5-flash',
  image_provider: 'comfyui',
  openai_image_model: 'gpt-image-1',
  openai_image_quality: 'medium',
  gemini_image_model: 'gemini-2.5-flash-image',
  replicate_model: 'black-forest-labs/flux-1.1-pro',
  replicate_ref_model: 'black-forest-labs/flux-kontext-pro',
  image_concurrency: '3',
  tts_provider: 'piper',
  elevenlabs_tts_model: 'eleven_multilingual_v2',
  openai_tts_model: 'gpt-4o-mini-tts',
  language: 'es',
  resolution: '1080p',
  fps: '30',
  transition: 'fade',
  camera_motion: 'on',
  music_volume: '0.18',
  music_ducking: 'on',
  scene_padding: '0.35',
  default_voice_provider: '',
  default_voice_id: '',
  default_voice_name: '',
  default_voice_speed: '1',
  // ---- Proveedores gratuitos / locales ----
  groq_model: 'llama-3.3-70b-versatile',
  ollama_url: 'http://127.0.0.1:11434',
  ollama_model: 'qwen2.5:7b',
  comfyui_url: 'http://127.0.0.1:8188',
  comfyui_preset: 'sdxl_lightning',
  comfyui_checkpoint: '',
  comfyui_steps: '6',
  comfyui_cfg: '2',
  comfyui_sampler: 'dpmpp_sde',
  comfyui_scheduler: 'karras',
  comfyui_width: '1344',
  comfyui_height: '768',
  comfyui_negative: 'text, letters, watermark, signature, logo, caption, speech bubble, blurry, lowres, jpeg artifacts, deformed, extra limbs, bad anatomy, duplicate, cropped',
  comfyui_workflow: '',
  kokoro_url: 'http://127.0.0.1:8880',
  music_provider: 'local',
};

/** Configuración de coste 0: todo gratis o local. */
export const FREE_PRESET = { free_only: 'on', llm_provider: 'gemini', image_provider: 'comfyui', tts_provider: 'piper', music_provider: 'local' };

/** Proveedores que piden saldo / pago por uso. En modo gratuito no se usan ni se muestran. */
export const PAID = {
  llm_provider: ['anthropic', 'openai'],
  image_provider: ['openai', 'gemini', 'replicate'],
  tts_provider: ['openai'],
  music_provider: ['elevenlabs'],
};
export const PAID_KEYS = ['anthropic', 'openai', 'replicate'];
export const isPaidVoice = provider => PAID.tts_provider.includes(provider);

// Permite apuntar los proveedores a otra URL (proxys corporativos o pruebas automáticas).
export const BASE_URLS = {
  anthropic: process.env.VIMO_ANTHROPIC_BASE_URL || undefined,
  openai: process.env.VIMO_OPENAI_BASE_URL || 'https://api.openai.com',
  gemini: process.env.VIMO_GEMINI_BASE_URL || 'https://generativelanguage.googleapis.com',
  replicate: process.env.VIMO_REPLICATE_BASE_URL || 'https://api.replicate.com',
  elevenlabs: process.env.VIMO_ELEVENLABS_BASE_URL || 'https://api.elevenlabs.io',
  groq: process.env.VIMO_GROQ_BASE_URL || 'https://api.groq.com/openai',
};

function rawSettings() {
  const out = {};
  for (const r of all('SELECT key, value FROM settings')) out[r.key] = r.value;
  return out;
}

export function getSettings() {
  const v = { ...DEFAULTS, ...Object.fromEntries(Object.entries(rawSettings()).filter(([k]) => !k.startsWith('key_'))) };
  // En modo gratuito, cualquier proveedor de pago guardado se sustituye por el gratuito.
  if (v.free_only !== 'off') for (const [k, list] of Object.entries(PAID)) if (list.includes(v[k])) v[k] = FREE_PRESET[k];
  return v;
}

export function setSettings(patch) {
  for (const [k, v] of Object.entries(patch)) {
    if (!(k in DEFAULTS)) continue;
    run('INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', k, String(v));
  }
  return getSettings();
}

export function getKey(provider) {
  const raw = rawSettings()['key_' + provider];
  if (raw) return raw;
  const env = API_KEYS[provider]?.env;
  return env ? process.env[env] || null : null;
}

export function setKey(provider, value) {
  if (!API_KEYS[provider]) throw new Error('Proveedor desconocido');
  if (!value) run('DELETE FROM settings WHERE key = ?', 'key_' + provider);
  else run('INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', 'key_' + provider, value.trim());
}

export function keysStatus() {
  const raw = rawSettings();
  return Object.entries(API_KEYS).map(([id, meta]) => {
    const stored = raw['key_' + id];
    const env = process.env[meta.env];
    const v = stored || env;
    return {
      id, ...meta,
      configured: !!v,
      paid: PAID_KEYS.includes(id),
      source: stored ? 'app' : env ? 'env' : null,
      masked: v ? v.slice(0, 4) + '…' + v.slice(-4) : null,
    };
  });
}

export class MissingKeyError extends Error {
  constructor(provider) {
    super(`Falta la clave API de ${API_KEYS[provider]?.label || provider}. Configúrala en «Claves API».`);
    this.code = 'MISSING_KEY';
    this.provider = provider;
  }
}

export function requireKey(provider) {
  const k = getKey(provider);
  if (!k) throw new MissingKeyError(provider);
  return k;
}
