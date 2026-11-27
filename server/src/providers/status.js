// Estado REAL de cada proveedor: comprueba claves y que los servicios locales respondan.
// Se usa en la interfaz (qué falta para activarlo) y antes de empezar una generación.
import { spawnSync } from 'node:child_process';
import { getSettings, getKey, API_KEYS, BASE_URLS } from '../settings.js';
import { json } from './http.js';
import { comfyStatus, listCheckpoints } from './comfyui.js';
import { piperStatus } from './piper.js';
import { FFMPEG } from '../media.js';

export const PROVIDER_INFO = {
  llm: {
    anthropic: { label: 'Anthropic (Claude)', cost: 'De pago' },
    openai: { label: 'OpenAI', cost: 'De pago' },
    gemini: { label: 'Google Gemini', cost: 'Gratis con límites (cuota gratuita de Google AI Studio)' },
    groq: { label: 'Groq', cost: 'Gratis con límites (peticiones y tokens por minuto/día)' },
    ollama: { label: 'Ollama (local)', cost: 'Gratis y sin límites (usa tu computador)' },
  },
  image: {
    openai: { label: 'OpenAI (gpt-image-1)', cost: 'De pago' },
    gemini: { label: 'Google Gemini Image', cost: 'De pago (normalmente requiere facturación activa)' },
    replicate: { label: 'Replicate (FLUX)', cost: 'De pago' },
    comfyui: { label: 'ComfyUI (local)', cost: 'Gratis y sin límites (usa tu computador)' },
  },
  tts: {
    elevenlabs: { label: 'ElevenLabs', cost: 'Plan gratuito limitado / de pago' },
    openai: { label: 'OpenAI TTS', cost: 'De pago' },
    piper: { label: 'Piper (local)', cost: 'Gratis y sin límites (usa tu computador)' },
    kokoro: { label: 'Kokoro (local)', cost: 'Gratis y sin límites (usa tu computador)' },
  },
  music: {
    local: { label: 'Compositor local de Vimo', cost: 'Gratis y sin límites' },
    elevenlabs: { label: 'ElevenLabs Music', cost: 'De pago' },
  },
};

const ok = (message) => ({ ready: true, message });
const fail = (message, fix) => ({ ready: false, message, fix });
const keyCheck = (k) => (getKey(k) ? ok('Clave configurada') : fail(`Falta la clave de ${API_KEYS[k].label}`, 'Añádela en «Claves API».'));

export async function checkProvider(kind, provider) {
  const s = getSettings();
  try {
    if (kind === 'llm') {
      if (provider === 'ollama') {
        const r = await json('Ollama', `${s.ollama_url.replace(/\/$/, '')}/api/tags`, {}, { retries: 0, timeoutMs: 5000 });
        const names = (r.models || []).map(m => m.name);
        if (!names.length) return fail('Ollama está abierto pero no tiene modelos', `Ejecuta en una terminal: ollama pull ${s.ollama_model}`);
        const want = s.ollama_model.includes(':') ? s.ollama_model : `${s.ollama_model}:latest`;
        if (!names.includes(want) && !names.includes(s.ollama_model)) return fail(`El modelo «${s.ollama_model}» no está descargado (tienes: ${names.join(', ')})`, `Ejecuta: ollama pull ${s.ollama_model} — o elige uno de los instalados en Ajustes.`);
        return ok(`Conectado · modelo ${s.ollama_model}`);
      }
      return keyCheck(provider);
    }
    if (kind === 'image') {
      if (provider === 'comfyui') {
        const st = await comfyStatus();
        if (!s.comfyui_workflow?.trim()) {
          const ck = await listCheckpoints();
          if (!ck.length) return fail('ComfyUI está abierto pero no tiene modelos (checkpoints)', 'Copia un modelo .safetensors en ComfyUI/models/checkpoints y reinicia ComfyUI.');
          if (s.comfyui_checkpoint && !ck.includes(s.comfyui_checkpoint)) return fail(`El modelo «${s.comfyui_checkpoint}» no está en ComfyUI`, 'Elige uno de la lista en Ajustes → Imágenes.');
          return ok(`Conectado${st.device ? ` · ${st.device}` : ''} · modelo ${s.comfyui_checkpoint || ck[0]}`);
        }
        return ok(`Conectado${st.device ? ` · ${st.device}` : ''} · flujo personalizado`);
      }
      return keyCheck(provider);
    }
    if (kind === 'tts') {
      if (provider === 'piper') {
        const st = piperStatus();
        if (!st.installed) return fail('Piper no está instalado', 'Pulsa «Instalar Piper» en «Claves API → Servicios locales».');
        if (!st.voices.length) return fail('Piper no tiene voces descargadas', 'Descarga una voz en «Voces» (proveedor Piper).');
        return ok(`Instalado · ${st.voices.length} voz/voces`);
      }
      if (provider === 'kokoro') {
        const r = await json('Kokoro', `${s.kokoro_url.replace(/\/$/, '')}/v1/audio/voices`, {}, { retries: 0, timeoutMs: 5000 });
        return ok(`Conectado · ${(r.voices || []).length} voces`);
      }
      return keyCheck(provider);
    }
    if (kind === 'music') {
      if (provider === 'local') return ok('Listo (no necesita instalación)');
      return keyCheck('elevenlabs');
    }
    if (kind === 'render') {
      const r = spawnSync(FFMPEG, ['-version']);
      return r.status === 0 ? ok(String(r.stdout).split('\n')[0]) : fail('FFmpeg no encontrado', 'Instálalo (Windows: winget install Gyan.FFmpeg) y reinicia Vimo.');
    }
  } catch (e) {
    const where = { ollama: s.ollama_url, comfyui: s.comfyui_url, kokoro: s.kokoro_url }[provider];
    return fail(where ? `No responde en ${where}` : e.message, where ? `Inicia ${PROVIDER_INFO[kind]?.[provider]?.label || provider} y vuelve a comprobar.` : undefined);
  }
  return fail('Proveedor desconocido: ' + provider);
}

export async function allStatus() {
  const s = getSettings();
  const sel = { llm: s.llm_provider, image: s.image_provider, tts: s.tts_provider, music: s.music_provider || 'local' };
  const out = {};
  await Promise.all(Object.entries(sel).map(async ([kind, provider]) => {
    out[kind] = { provider, ...(PROVIDER_INFO[kind][provider] || { label: provider }), ...(await checkProvider(kind, provider)) };
  }));
  out.render = { provider: 'ffmpeg', label: 'FFmpeg', cost: 'Gratis y local', ...(await checkProvider('render', 'ffmpeg')) };
  return out;
}

/** Lista de modelos disponibles en un proveedor (para elegir en Ajustes). */
export async function listModels(provider) {
  const s = getSettings();
  if (provider === 'ollama') return ((await json('Ollama', `${s.ollama_url.replace(/\/$/, '')}/api/tags`, {}, { retries: 0, timeoutMs: 5000 })).models || []).map(m => m.name);
  if (provider === 'comfyui') return listCheckpoints();
  if (provider === 'groq') {
    const r = await json('Groq', `${BASE_URLS.groq}/v1/models`, { headers: { Authorization: `Bearer ${getKey('groq') || ''}` } }, { retries: 0, timeoutMs: 10000 });
    return (r.data || []).filter(m => !/whisper|tts|guard|playai|orpheus/i.test(m.id)).map(m => m.id).sort();
  }
  return [];
}
