// Ajustes y claves de API. Se guardan en la base de datos local (pantalla Configuración);
// una variable de entorno con el mismo nombre tiene prioridad. Las claves nunca se envían al navegador completas.
import { one, run, all } from '../db/index.js';

export const SETTINGS = {
  YOUTUBE_API_KEY: { secret: true, label: 'Clave de YouTube Data API v3' },
  GEMINI_API_KEY: { secret: true, label: 'Clave de Google Gemini (AI Studio)' },
  GEMINI_TEXT_MODEL: { default: 'gemini-2.5-flash', label: 'Modelo de texto' },
  GEMINI_IMAGE_MODEL: { default: 'gemini-2.5-flash-image', label: 'Modelo de imagen' },
  GEMINI_TTS_MODEL: { default: 'gemini-2.5-flash-preview-tts', label: 'Modelo de voz' },
  GEMINI_TTS_VOICE: { default: 'Charon', label: 'Voz de Gemini' },
  ELEVENLABS_API_KEY: { secret: true, label: 'Clave de ElevenLabs (opcional)' },
  ELEVENLABS_VOICE_ID: { default: '', label: 'Voz de ElevenLabs' },
  EDGE_VOICE: { default: 'es-MX-JorgeNeural', label: 'Voz de Microsoft Edge (gratis)' },
  VOICE_ENGINE: { default: 'auto', label: 'Motor de voz', options: ['auto', 'gemini', 'elevenlabs', 'edge'] },
  IMAGE_ENGINE: { default: 'gemini', label: 'Generador de imágenes', options: ['gemini', 'flow'] },
  FFMPEG_PATH: { default: 'ffmpeg', label: 'Ruta de FFmpeg' },
  FFPROBE_PATH: { default: 'ffprobe', label: 'Ruta de FFprobe' },
  TARGET_MINUTES: { default: '9', label: 'Duración objetivo (minutos)' },
  MUSIC_VOLUME_DB: { default: '-24', label: 'Nivel de la música (LUFS)' },
};

export function getSetting(key) {
  const env = process.env[key];
  if (env != null && env !== '') return env.trim();
  const row = one('SELECT value FROM settings WHERE key = ?', key);
  if (row && row.value !== '') return row.value;
  return SETTINGS[key]?.default ?? '';
}

export function setSettings(obj) {
  for (const [k, v] of Object.entries(obj)) {
    if (!SETTINGS[k]) throw new Error(`Ajuste desconocido: ${k}`);
    const val = String(v ?? '').trim();
    if (SETTINGS[k].options && val && !SETTINGS[k].options.includes(val)) throw new Error(`Valor no válido para ${k}`);
    run(`INSERT INTO settings(key, value, updated_at) VALUES(?, ?, datetime('now'))
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`, k, val);
  }
}

const mask = (v) => (v ? `${v.slice(0, 4)}…${v.slice(-4)}` : '');

/** Vista para la interfaz: las claves secretas sólo se muestran enmascaradas. */
export function publicSettings() {
  const stored = Object.fromEntries(all('SELECT key, value FROM settings').map((r) => [r.key, r.value]));
  return Object.entries(SETTINGS).map(([key, def]) => {
    const fromEnv = !!process.env[key];
    const value = getSetting(key);
    return {
      key, label: def.label, secret: !!def.secret, options: def.options || null,
      configured: !!value, source: fromEnv ? 'variable de entorno' : stored[key] ? 'configuración' : 'predeterminado',
      value: def.secret ? mask(value) : value,
    };
  });
}
