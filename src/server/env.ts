/**
 * Lectura centralizada de variables de entorno del servidor.
 * Nunca importar desde componentes cliente.
 */
const read = (k: string, fallback = "") => (process.env[k] ?? fallback).trim();

export const env = {
  DATABASE_URL: read("DATABASE_URL", "postgres://clipforge:clipforge@localhost:5432/clipforge"),
  REDIS_URL: read("REDIS_URL", "redis://localhost:6379"),
  APP_URL: read("APP_URL", "http://localhost:3000"),
  NODE_ENV: read("NODE_ENV", "development"),

  STORAGE_DRIVER: read("STORAGE_DRIVER", "local") as "local" | "s3",
  STORAGE_LOCAL_DIR: read("STORAGE_LOCAL_DIR", "./storage"),
  S3_BUCKET: read("S3_BUCKET"),
  S3_REGION: read("S3_REGION"),
  S3_ENDPOINT: read("S3_ENDPOINT"),
  S3_ACCESS_KEY_ID: read("S3_ACCESS_KEY_ID"),
  S3_SECRET_ACCESS_KEY: read("S3_SECRET_ACCESS_KEY"),
  S3_FORCE_PATH_STYLE: read("S3_FORCE_PATH_STYLE", "true") === "true",
  MAX_UPLOAD_MB: Number(read("MAX_UPLOAD_MB", "4096")),

  TRANSCRIPTION_PROVIDER: read("TRANSCRIPTION_PROVIDER", "openai"),
  OPENAI_API_KEY: read("OPENAI_API_KEY"),
  GROQ_API_KEY: read("GROQ_API_KEY"),
  DEEPGRAM_API_KEY: read("DEEPGRAM_API_KEY"),
  PYTHON_PATH: read("PYTHON_PATH", read("LOCAL_WHISPER_PYTHON", "python3")),
  LOCAL_WHISPER_MODEL_DIR: read("LOCAL_WHISPER_MODEL_DIR", "./models/sherpa-onnx-whisper-base"),
  LOCAL_VAD_MODEL: read("LOCAL_VAD_MODEL", "./models/silero_vad.onnx"),
  LOCAL_WHISPER_THREADS: Number(read("LOCAL_WHISPER_THREADS", "4")),

  LLM_PROVIDER: read("LLM_PROVIDER", "anthropic"),
  LLM_MODEL: read("LLM_MODEL"),
  ANTHROPIC_API_KEY: read("ANTHROPIC_API_KEY"),
  LLM_BASE_URL: read("LLM_BASE_URL"),
  LLM_API_KEY: read("LLM_API_KEY"),
  LLM_EFFORT: read("LLM_EFFORT", "high"),
  /** Palabras por ventana de análisis (0 = toda la transcripción de una vez). */
  LLM_WINDOW_WORDS: Number(read("LLM_WINDOW_WORDS", read("LLM_PROVIDER", "anthropic") === "ollama" ? "2500" : "0")),
  OLLAMA_URL: read("OLLAMA_URL", "http://localhost:11434"),
  OLLAMA_NUM_CTX: Number(read("OLLAMA_NUM_CTX", "16384")),

  /** Permite importar enlaces de YouTube y otras plataformas con yt-dlp. */
  PLATFORM_IMPORT_ENABLED: read("PLATFORM_IMPORT_ENABLED", "true") === "true",
  YTDLP_PATH: read("YTDLP_PATH", "yt-dlp"),
  YTDLP_COOKIES_FILE: read("YTDLP_COOKIES_FILE"),
  MAX_IMPORT_MINUTES: Number(read("MAX_IMPORT_MINUTES", "240")),
  FFMPEG_PATH: read("FFMPEG_PATH", "ffmpeg"),
  FFPROBE_PATH: read("FFPROBE_PATH", "ffprobe"),
  WORKER_CONCURRENCY: Number(read("WORKER_CONCURRENCY", "1")),
};
