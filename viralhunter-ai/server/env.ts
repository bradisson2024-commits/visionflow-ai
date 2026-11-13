import "dotenv/config";
import type { MissingCredential } from "../shared/types";

const v = (k: string) => (process.env[k] ?? "").trim();

export const env = {
  port: Number(v("PORT") || 8787),
  databaseUrl: v("DATABASE_URL"),
  youtubeKey: v("YOUTUBE_API_KEY"),
  youtubeDailyQuota: Number(v("YOUTUBE_DAILY_QUOTA") || 10000),
  anthropicKey: v("ANTHROPIC_API_KEY"),
  anthropicModel: v("ANTHROPIC_MODEL") || "claude-opus-5-5",
  openaiKey: v("OPENAI_API_KEY"),
  openaiImageModel: v("OPENAI_IMAGE_MODEL") || "gpt-image-1",
  imageProvider: (v("IMAGE_PROVIDER") || "pollinations") as "pollinations" | "huggingface" | "openai",
  pollinationsModel: v("POLLINATIONS_MODEL") || "flux",
  pollinationsToken: v("POLLINATIONS_TOKEN"),
  hfToken: v("HF_TOKEN"),
  hfImageModel: v("HF_IMAGE_MODEL") || "black-forest-labs/FLUX.1-schnell",
  elevenKey: v("ELEVENLABS_API_KEY"),
  elevenModel: v("ELEVENLABS_MODEL") || "eleven_multilingual_v2",
  allowedOrigin: v("ALLOWED_ORIGIN"),
  production: process.env.NODE_ENV === "production",
};

export const CREDENTIALS: Record<string, MissingCredential> = {
  DATABASE_URL: {
    env: "DATABASE_URL",
    service: "Supabase (PostgreSQL)",
    howTo:
      "Supabase → Project Settings → Database → Connection string (URI, Session pooler). Pégala en viralhunter-ai/.env como DATABASE_URL y ejecuta `npm run db:migrate`.",
  },
  YOUTUBE_API_KEY: {
    env: "YOUTUBE_API_KEY",
    service: "YouTube Data API v3",
    howTo:
      "console.cloud.google.com → crea un proyecto → APIs y servicios → Biblioteca → habilita 'YouTube Data API v3' → Credenciales → Crear clave de API. Guárdala en .env como YOUTUBE_API_KEY.",
  },
  ANTHROPIC_API_KEY: {
    env: "ANTHROPIC_API_KEY",
    service: "IA de análisis (Claude)",
    howTo: "console.anthropic.com → API Keys → Create Key. Guárdala en .env como ANTHROPIC_API_KEY.",
  },
  OPENAI_API_KEY: {
    env: "OPENAI_API_KEY",
    service: "Imágenes con OpenAI (opcional, de pago)",
    howTo: "Sólo si IMAGE_PROVIDER=openai: platform.openai.com → API keys. Por defecto se usa Pollinations, gratis y sin clave.",
  },
  HF_TOKEN: {
    env: "HF_TOKEN",
    service: "Imágenes con Hugging Face (gratis)",
    howTo: "Sólo si IMAGE_PROVIDER=huggingface: huggingface.co → Settings → Access Tokens → New token (tipo Read, gratis). Guárdalo en .env como HF_TOKEN.",
  },
  ELEVENLABS_API_KEY: {
    env: "ELEVENLABS_API_KEY",
    service: "Síntesis de voz (ElevenLabs)",
    howTo: "elevenlabs.io → Profile → API Keys → Create. Guárdala en .env como ELEVENLABS_API_KEY.",
  },
};

const PRESENT: Record<string, () => boolean> = {
  DATABASE_URL: () => !!env.databaseUrl,
  YOUTUBE_API_KEY: () => !!env.youtubeKey,
  ANTHROPIC_API_KEY: () => !!env.anthropicKey,
  OPENAI_API_KEY: () => !!env.openaiKey,
  HF_TOKEN: () => !!env.hfToken,
  ELEVENLABS_API_KEY: () => !!env.elevenKey,
};

export function missing(...keys: string[]): MissingCredential[] {
  return keys.filter((k) => !PRESENT[k]()).map((k) => CREDENTIALS[k]);
}

export class MissingCredentialError extends Error {
  constructor(public missing: MissingCredential[]) {
    super(`Faltan credenciales: ${missing.map((m) => m.env).join(", ")}`);
  }
}

export function requireCreds(...keys: string[]) {
  const m = missing(...keys);
  if (m.length) throw new MissingCredentialError(m);
}

/** Credenciales que necesita el proveedor de imágenes elegido (ninguna para Pollinations). */
export function imageCredKeys(): string[] {
  return env.imageProvider === "openai" ? ["OPENAI_API_KEY"] : env.imageProvider === "huggingface" ? ["HF_TOKEN"] : [];
}
