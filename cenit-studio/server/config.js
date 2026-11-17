// Configuración del servidor. Todas las claves viven aquí (variables de entorno o .env) y nunca se envían al navegador.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const envFile = path.join(ROOT, '.env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
}

const e = (k, d = '') => (process.env[k] ?? d).toString().trim();

export const config = {
  get port() { return Number(e('PORT', '8080')); },
  get databaseUrl() { return e('DATABASE_URL'); },
  get supabaseUrl() { return e('SUPABASE_URL').replace(/\/$/, ''); },
  get supabaseAnonKey() { return e('SUPABASE_ANON_KEY'); },
  get supabaseServiceKey() { return e('SUPABASE_SERVICE_ROLE_KEY'); },
  get supabaseJwtSecret() { return e('SUPABASE_JWT_SECRET'); },
  get storageBucket() { return e('SUPABASE_STORAGE_BUCKET', 'cenit'); },
  get localJwtSecret() { return e('LOCAL_JWT_SECRET'); },
  get storageDir() { return path.resolve(ROOT, e('STORAGE_DIR', 'storage')); },
  get youtubeKey() { return e('YOUTUBE_API_KEY'); },
  get geminiKey() { return e('GEMINI_API_KEY'); },
  get elevenKey() { return e('ELEVENLABS_API_KEY'); },
  get ffmpeg() { return e('FFMPEG_PATH', 'ffmpeg'); },
  get ffprobe() { return e('FFPROBE_PATH', 'ffprobe'); },
  get runWorker() { return e('RUN_WORKER', 'true') !== 'false'; },
  get initialCredits() { return Number(e('INITIAL_CREDITS', '20000')); },
  get adminEmails() { return e('ADMIN_EMAILS').split(',').map((x) => x.trim().toLowerCase()).filter(Boolean); },
  // Bases de las APIs (sólo se cambian en pruebas, para apuntar a dobles locales)
  get youtubeBase() { return e('YOUTUBE_API_BASE', 'https://www.googleapis.com/youtube/v3'); },
  get geminiBase() { return e('GEMINI_API_BASE', 'https://generativelanguage.googleapis.com/v1beta'); },
  get elevenBase() { return e('ELEVENLABS_API_BASE', 'https://api.elevenlabs.io'); },
};

/** Modo de autenticación: Supabase si está configurado; si no, cuentas locales. */
export const authMode = () => (config.supabaseUrl && config.supabaseAnonKey ? 'supabase' : 'local');
export const storageMode = () => (config.supabaseUrl && config.supabaseServiceKey ? 'supabase' : 'local');
