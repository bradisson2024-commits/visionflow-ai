// Configuración: lee .env (sin dependencias) y describe qué servicios reales están conectados.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function loadEnv(file = path.join(ROOT, '.env')) {
  if (!fs.existsSync(file)) return;
  for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 1) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1);
    if (process.env[key] === undefined) process.env[key] = val;
  }
}
loadEnv();

const env = (k, d = '') => (process.env[k] ?? d).trim();

export const config = {
  get port() { return Number(env('PORT', '8790')); },
  get projectsDir() { return path.resolve(ROOT, env('PROJECTS_DIR', 'projects')); },
  get musicDir() { return path.resolve(ROOT, env('MUSIC_DIR', 'assets/music')); },
  get youtubeKey() { return env('YOUTUBE_API_KEY'); },
  get geminiKey() { return env('GEMINI_API_KEY'); },
  get geminiTextModel() { return env('GEMINI_TEXT_MODEL', 'gemini-2.5-flash'); },
  get geminiImageModel() { return env('GEMINI_IMAGE_MODEL', 'gemini-2.5-flash-image'); },
  get geminiTtsModel() { return env('GEMINI_TTS_MODEL', 'gemini-2.5-flash-preview-tts'); },
  get geminiVoice() { return env('GEMINI_TTS_VOICE', 'Charon'); },
  get anthropicKey() { return env('ANTHROPIC_API_KEY'); },
  get anthropicModel() { return env('ANTHROPIC_MODEL', 'claude-opus-5-5'); },
  get elevenKey() { return env('ELEVENLABS_API_KEY'); },
  get elevenVoice() { return env('ELEVENLABS_VOICE_ID'); },
  get elevenModel() { return env('ELEVENLABS_MODEL', 'eleven_multilingual_v2'); },
  get pollinationsToken() { return env('POLLINATIONS_TOKEN'); },
  get llmProvider() { return env('LLM_PROVIDER', 'auto'); },
  get imageProvider() { return env('IMAGE_PROVIDER', 'auto'); },
  get ttsProvider() { return env('TTS_PROVIDER', 'auto'); },
  get edgeVoice() { return env('EDGE_TTS_VOICE', 'es-MX-JorgeNeural'); },
  get edgeRate() { return env('EDGE_TTS_RATE', '+4%'); },
  get ffmpeg() { return env('FFMPEG_PATH', 'ffmpeg'); },
  get ffprobe() { return env('FFPROBE_PATH', 'ffprobe'); },
  get targetMinutes() { return [Number(env('TARGET_MIN_MINUTES', '8')), Number(env('TARGET_MAX_MINUTES', '10'))]; },
  get accessToken() { return env('APP_ACCESS_TOKEN'); },
};

/** Proveedor de texto efectivo. Pollinations no necesita clave pero no tiene visión ni búsqueda web. */
export function llmProviderName() {
  const p = config.llmProvider;
  if (p !== 'auto') return p;
  if (config.geminiKey) return 'gemini';
  if (config.anthropicKey) return 'anthropic';
  return 'pollinations';
}

/** Proveedor con visión (para analizar miniaturas y revisar coherencia imagen–narración). */
export function visionProviderName() {
  if (config.geminiKey) return 'gemini';
  if (config.anthropicKey) return 'anthropic';
  return null;
}

export function imageProviderName() {
  const p = config.imageProvider;
  if (p !== 'auto') return p;
  return config.geminiKey ? 'gemini' : 'pollinations';
}

export function ttsProviderName() {
  const p = config.ttsProvider;
  if (p !== 'auto') return p;
  if (config.elevenKey && config.elevenVoice) return 'elevenlabs';
  return 'edge';
}

export function serviceStatus() {
  const vision = visionProviderName();
  const tts = ttsProviderName();
  return [
    {
      id: 'youtube', name: 'YouTube Data API v3', ok: !!config.youtubeKey,
      role: 'Buscador de virales y datos reales del video (vistas, duración, fecha).',
      missing: config.youtubeKey ? null : 'Falta YOUTUBE_API_KEY. Sin ella no hay buscador; al pegar un enlace sólo se obtienen título, canal y miniatura (oEmbed), sin vistas, fecha ni duración.',
    },
    {
      id: 'llm', name: `IA de texto (${llmProviderName()})`, ok: llmProviderName() === 'pollinations' ? null : true,
      role: 'Análisis, guion, descripción de escenas y título.',
      missing: llmProviderName() === 'pollinations' ? 'Usando Pollinations (gratis, sin clave). Funciona, pero con GEMINI_API_KEY (gratis) la calidad del guion y la investigación con Google Search mejoran.' : null,
    },
    {
      id: 'vision', name: `IA con visión${vision ? ` (${vision})` : ''}`, ok: !!vision,
      role: 'Analiza la miniatura original y revisa automáticamente que cada imagen represente su narración.',
      missing: vision ? null : 'Falta GEMINI_API_KEY (gratis) u otra clave con visión. Sin ella la revisión de coherencia imagen–narración debe aprobarse a mano escena por escena.',
    },
    {
      id: 'research', name: 'Investigación con fuentes', ok: true,
      role: 'Wikipedia (sin clave)' + (config.geminiKey ? ' + Google Search vía Gemini.' : '. Con GEMINI_API_KEY se añade búsqueda en Google con fuentes citadas.'),
      missing: null,
    },
    {
      id: 'transcript', name: 'Transcripción del video original', ok: !!config.geminiKey,
      role: 'Para analizar la narración original.',
      missing: config.geminiKey ? null : 'Sin GEMINI_API_KEY la herramienta no puede ver ni escuchar el video: pega o sube una transcripción autorizada (.txt/.srt/.vtt).',
    },
    {
      id: 'images', name: `Imágenes Stickman (${imageProviderName()})`,
      ok: imageProviderName() === 'gemini' ? !!config.geminiKey : config.pollinationsToken ? null : false,
      role: 'Una ilustración estática por escena, con la hoja de personajes como referencia.',
      missing: imageProviderName() === 'gemini'
        ? (config.geminiKey ? 'Gemini Imagen puede requerir facturación activa en Google AI Studio; si no está disponible, el paso de imágenes mostrará el error de Google.' : 'Falta GEMINI_API_KEY.')
        : config.pollinationsToken
          ? 'Pollinations con token (modelo FLUX). La consistencia de personajes depende sólo del texto y la semilla.'
          : 'Pollinations SIN token sólo ofrece el modelo «sana»: en pruebas reales no produce el estilo Stickman (dibujos abstractos). Añade GEMINI_API_KEY (recomendado) o POLLINATIONS_TOKEN (enter.pollinations.ai) para FLUX. Sin ello, la revisión de coherencia rechazará la mayoría de imágenes.',
    },
    {
      id: 'tts', name: `Voz (${tts})`, ok: tts === 'edge' ? null : tts === 'gemini' ? !!config.geminiKey : !!(config.elevenKey && config.elevenVoice), test: 'tts',
      role: tts === 'edge' ? `Microsoft Edge neural TTS, voz ${config.edgeVoice} (español latino, sin clave).` : tts === 'gemini' ? 'Gemini TTS.' : 'ElevenLabs multilingüe.',
      missing: tts === 'edge' ? 'Edge TTS es un servicio gratuito no oficial de Microsoft: puede dejar de responder. Para una voz de pago estable añade ELEVENLABS_API_KEY y ELEVENLABS_VOICE_ID.' : null,
    },
    {
      id: 'ffmpeg', name: 'FFmpeg', ok: null,
      role: 'Montaje real del MP4, música, efectos y verificación.',
      missing: null,
    },
  ];
}
