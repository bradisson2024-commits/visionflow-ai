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
    service: "Generación de imágenes (OpenAI gpt-image-1)",
    howTo: "platform.openai.com → API keys → Create new secret key. Guárdala en .env como OPENAI_API_KEY.",
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
