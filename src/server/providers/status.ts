/**
 * Estado de configuración de los servicios externos.
 * Sólo devuelve si cada servicio está listo y qué variable falta;
 * jamás devuelve el valor de una clave.
 */
import { env } from "../env";

export type ServiceStatus = {
  id: string;
  label: string;
  provider: string;
  ready: boolean;
  missing: string[];
  note?: string;
};

const need = (pairs: [string, string][]) => pairs.filter(([, v]) => !v).map(([k]) => k);

export function transcriptionStatus(): ServiceStatus {
  const p = env.TRANSCRIPTION_PROVIDER;
  const base = { id: "transcription", label: "Transcripción", provider: p };
  switch (p) {
    case "openai":
      return { ...base, missing: need([["OPENAI_API_KEY", env.OPENAI_API_KEY]]), ready: !!env.OPENAI_API_KEY, note: "OpenAI Whisper (whisper-1) con marcas de tiempo por palabra." };
    case "groq":
      return { ...base, missing: need([["GROQ_API_KEY", env.GROQ_API_KEY]]), ready: !!env.GROQ_API_KEY, note: "Groq whisper-large-v3, compatible con la API de OpenAI." };
    case "deepgram":
      return { ...base, missing: need([["DEEPGRAM_API_KEY", env.DEEPGRAM_API_KEY]]), ready: !!env.DEEPGRAM_API_KEY, note: "Deepgram Nova con marcas de tiempo por palabra." };
    case "local_whisper":
      return { ...base, missing: [], ready: true, note: `faster-whisper en el servidor (modelo "${env.LOCAL_WHISPER_MODEL}"). Requiere Python y el modelo descargado; se verifica al ejecutar.` };
    default:
      return { ...base, missing: ["TRANSCRIPTION_PROVIDER"], ready: false, note: `Proveedor desconocido: "${p}".` };
  }
}

export function llmStatus(): ServiceStatus {
  const p = env.LLM_PROVIDER;
  const base = { id: "llm", label: "IA de análisis", provider: p };
  switch (p) {
    case "anthropic":
      return { ...base, missing: need([["ANTHROPIC_API_KEY", env.ANTHROPIC_API_KEY]]), ready: !!env.ANTHROPIC_API_KEY, note: "Claude analiza la transcripción, detecta momentos y puntúa los clips." };
    case "openai":
      return { ...base, missing: need([["OPENAI_API_KEY", env.OPENAI_API_KEY]]), ready: !!env.OPENAI_API_KEY };
    case "openai_compatible": {
      const missing = need([["LLM_BASE_URL", env.LLM_BASE_URL], ["LLM_MODEL", env.LLM_MODEL]]);
      return { ...base, missing, ready: missing.length === 0, note: "Groq, OpenRouter, Ollama u otro servidor compatible con OpenAI." };
    }
    default:
      return { ...base, missing: ["LLM_PROVIDER"], ready: false, note: `Proveedor desconocido: "${p}".` };
  }
}

export function storageStatus(): ServiceStatus {
  if (env.STORAGE_DRIVER === "s3") {
    const missing = need([
      ["S3_BUCKET", env.S3_BUCKET],
      ["S3_ACCESS_KEY_ID", env.S3_ACCESS_KEY_ID],
      ["S3_SECRET_ACCESS_KEY", env.S3_SECRET_ACCESS_KEY],
    ]);
    return { id: "storage", label: "Almacenamiento", provider: "s3", missing, ready: missing.length === 0, note: "AWS S3, Cloudflare R2, MinIO o Supabase Storage (endpoint S3)." };
  }
  return { id: "storage", label: "Almacenamiento", provider: "local", missing: [], ready: true, note: `Disco del servidor: ${env.STORAGE_LOCAL_DIR}` };
}

export function allServiceStatus(): ServiceStatus[] {
  return [storageStatus(), transcriptionStatus(), llmStatus()];
}
