// Síntesis de voz con proveedores reales. Por defecto GRATIS con Google Gemini TTS (misma clave gratuita).
// ElevenLabs es opcional. No se clona ninguna voz: sólo voces prediseñadas del proveedor.
import { env, requireCreds, voiceProvider } from "../env";
import { saveAsset } from "./assets";
import { geminiGenerate } from "./llm";

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

// Voces prediseñadas de Gemini TTS (multilingües, incluido español) con su carácter oficial.
const GEMINI_VOICES: [string, string][] = [
  ["Zephyr", "Brillante"], ["Puck", "Animada"], ["Charon", "Informativa"], ["Kore", "Firme"], ["Fenrir", "Enérgica"],
  ["Leda", "Juvenil"], ["Orus", "Firme"], ["Aoede", "Ligera"], ["Callirrhoe", "Relajada"], ["Autonoe", "Brillante"],
  ["Enceladus", "Susurrante"], ["Iapetus", "Clara"], ["Umbriel", "Relajada"], ["Algieba", "Suave"], ["Despina", "Suave"],
  ["Erinome", "Clara"], ["Algenib", "Grave"], ["Rasalgethi", "Informativa"], ["Laomedeia", "Animada"], ["Achernar", "Suave"],
  ["Alnilam", "Firme"], ["Schedar", "Equilibrada"], ["Gacrux", "Madura"], ["Pulcherrima", "Directa"], ["Achird", "Cercana"],
  ["Zubenelgenubi", "Informal"], ["Vindemiatrix", "Amable"], ["Sadachbia", "Viva"], ["Sadaltager", "Experta"], ["Sulafat", "Cálida"],
];

export async function listVoices(): Promise<{ provider: string; voices: VoiceOption[] }> {
  if (voiceProvider() === "gemini") {
    requireCreds("GEMINI_API_KEY");
    return {
      provider: "gemini",
      voices: GEMINI_VOICES.map(([id, d]) => ({ id, name: id, category: "premade", gender: null, age: null, accent: null, description: d, useCase: null, previewUrl: null, languages: [] })),
    };
  }
  const r = (await (await eleven("/voices")).json()) as any;
  return {
    provider: "elevenlabs",
    voices: (r.voices ?? []).map((v: any) => ({
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
    })),
  };
}

async function eleven(path: string, init: RequestInit = {}) {
  requireCreds("ELEVENLABS_API_KEY");
  const res = await fetch(`https://api.elevenlabs.io/v1${path}`, { ...init, headers: { "xi-api-key": env.elevenKey, ...(init.headers ?? {}) } });
  if (!res.ok) throw new Error(`ElevenLabs ${res.status}: ${(await res.text().catch(() => "")).slice(0, 300)}`);
  return res;
}

/** PCM 16-bit mono → WAV */
export function pcmToWav(pcm: Buffer, sampleRate = 24000): Buffer {
  const h = Buffer.alloc(44);
  h.write("RIFF", 0);
  h.writeUInt32LE(36 + pcm.length, 4);
  h.write("WAVE", 8);
  h.write("fmt ", 12);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(1, 22);
  h.writeUInt32LE(sampleRate, 24);
  h.writeUInt32LE(sampleRate * 2, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write("data", 36);
  h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}

const LANG_NAME: Record<string, string> = { es: "español", en: "inglés", pt: "portugués", fr: "francés", de: "alemán", it: "italiano" };

export async function synthesize(opts: {
  projectId: string;
  voiceId: string;
  text: string;
  language: string;
  stability: number;
  similarity: number;
  style: number;
  speed: number;
  instructions?: string;
}) {
  if (voiceProvider() === "gemini") {
    const pace = opts.speed < 0.95 ? "con ritmo pausado" : opts.speed > 1.05 ? "con ritmo rápido" : "con ritmo natural";
    const directive = `Lee en ${LANG_NAME[opts.language] ?? opts.language}, ${pace}${opts.instructions ? `, ${opts.instructions}` : ""}:`;
    const j = await geminiGenerate(env.geminiTtsModel, {
      contents: [{ parts: [{ text: `${directive}\n${opts.text}` }] }],
      generationConfig: { responseModalities: ["AUDIO"], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: opts.voiceId } } } },
    });
    const part = j.candidates?.[0]?.content?.parts?.find((p: any) => p.inlineData?.data);
    if (!part) throw new Error("Gemini no devolvió audio.");
    const rate = Number(/rate=(\d+)/.exec(part.inlineData.mimeType ?? "")?.[1]) || 24000;
    const raw = Buffer.from(part.inlineData.data, "base64");
    const wav = /wav/.test(part.inlineData.mimeType ?? "") ? raw : pcmToWav(raw, rate);
    return saveAsset({
      projectId: opts.projectId, kind: "voice_sample", provider: "gemini", model: env.geminiTtsModel, prompt: opts.text,
      mimeType: "audio/wav", data: wav, meta: { voiceId: opts.voiceId, language: opts.language, speed: opts.speed, instructions: opts.instructions ?? "" },
    });
  }
  const res = await eleven(`/text-to-speech/${encodeURIComponent(opts.voiceId)}?output_format=mp3_44100_128`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "audio/mpeg" },
    body: JSON.stringify({
      text: opts.text,
      model_id: env.elevenModel,
      voice_settings: { stability: opts.stability, similarity_boost: opts.similarity, style: opts.style, speed: opts.speed, use_speaker_boost: true },
    }),
  });
  return saveAsset({
    projectId: opts.projectId, kind: "voice_sample", provider: "elevenlabs", model: env.elevenModel, prompt: opts.text,
    mimeType: "audio/mpeg", data: Buffer.from(await res.arrayBuffer()),
    meta: { voiceId: opts.voiceId, language: opts.language, stability: opts.stability, similarity: opts.similarity, style: opts.style, speed: opts.speed },
  });
}
