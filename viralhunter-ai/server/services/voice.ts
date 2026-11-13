// Síntesis de voz con un proveedor real: ElevenLabs. No se clona ninguna voz:
// sólo se usan voces de la biblioteca de la cuenta del usuario.
import { env, requireCreds } from "../env";
import { saveAsset } from "./assets";

const BASE = "https://api.elevenlabs.io/v1";

async function el(path: string, init: RequestInit = {}) {
  requireCreds("ELEVENLABS_API_KEY");
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { "xi-api-key": env.elevenKey, ...(init.headers ?? {}) },
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`ElevenLabs ${res.status}: ${t.slice(0, 300)}`);
  }
  return res;
}

export interface VoiceOption {
  id: string;
  name: string;
  category: string;
  gender: string | null;
  age: string | null;
  accent: string | null;
  description: string | null;
  useCase: string | null;
  previewUrl: string | null;
  languages: string[];
}

export async function listVoices(): Promise<VoiceOption[]> {
  const r = (await (await el("/voices")).json()) as any;
  return (r.voices ?? []).map((v: any) => ({
    id: v.voice_id,
    name: v.name,
    category: v.category,
    gender: v.labels?.gender ?? null,
    age: v.labels?.age ?? null,
    accent: v.labels?.accent ?? null,
    description: v.labels?.description ?? v.description ?? null,
    useCase: v.labels?.use_case ?? null,
    previewUrl: v.preview_url ?? null,
    languages: [...new Set<string>((v.verified_languages ?? []).map((l: any) => l.language))],
  }));
}

export async function synthesize(opts: {
  projectId: string;
  voiceId: string;
  text: string;
  language: string;
  stability: number;
  similarity: number;
  style: number;
  speed: number;
}) {
  const res = await el(`/text-to-speech/${encodeURIComponent(opts.voiceId)}?output_format=mp3_44100_128`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "audio/mpeg" },
    body: JSON.stringify({
      text: opts.text,
      model_id: env.elevenModel,
      language_code: env.elevenModel.includes("multilingual_v2") ? undefined : opts.language,
      voice_settings: {
        stability: opts.stability,
        similarity_boost: opts.similarity,
        style: opts.style,
        speed: opts.speed,
        use_speaker_boost: true,
      },
    }),
  });
  const buf = Buffer.from(await res.arrayBuffer());
  return saveAsset({
    projectId: opts.projectId,
    kind: "voice_sample",
    provider: "elevenlabs",
    model: env.elevenModel,
    prompt: opts.text,
    mimeType: "audio/mpeg",
    data: buf,
    meta: { voiceId: opts.voiceId, language: opts.language, stability: opts.stability, similarity: opts.similarity, style: opts.style, speed: opts.speed },
  });
}
