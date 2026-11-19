/**
 * Transcripción con la API /audio/transcriptions de OpenAI (whisper-1) o de
 * Groq (whisper-large-v3), que son compatibles. Devuelve tiempos por palabra.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { TranscriptSegment, TranscriptWord } from "../../db/schema";
import { attachPunctuation } from "./punctuation";
import type { TranscribeInput, TranscriptionResult } from "./types";

type Verbose = {
  language?: string;
  text: string;
  segments?: { id: number; start: number; end: number; text: string }[];
  words?: { word: string; start: number; end: number }[];
};

const LANG_NAMES: Record<string, string> = { spanish: "es", english: "en", portuguese: "pt", french: "fr", italian: "it", german: "de" };

export async function transcribeOpenAICompatible(
  input: TranscribeInput,
  cfg: { provider: "openai" | "groq"; baseUrl: string; apiKey: string; model: string },
): Promise<TranscriptionResult> {
  const segments: TranscriptSegment[] = [];
  const words: TranscriptWord[] = [];
  let language: string | null = null;
  for (let i = 0; i < input.chunks.length; i++) {
    const c = input.chunks[i];
    const form = new FormData();
    form.append("file", new Blob([await readFile(c.file)], { type: c.mime }), path.basename(c.file));
    form.append("model", cfg.model);
    form.append("response_format", "verbose_json");
    form.append("timestamp_granularities[]", "word");
    form.append("timestamp_granularities[]", "segment");
    if (input.language && input.language !== "auto") form.append("language", input.language);
    const res = await fetch(`${cfg.baseUrl}/audio/transcriptions`, {
      method: "POST",
      headers: { authorization: `Bearer ${cfg.apiKey}` },
      body: form,
      signal: input.signal,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`${cfg.provider === "groq" ? "Groq" : "OpenAI"} respondió ${res.status} al transcribir: ${body.slice(0, 300)}`);
    }
    const data = (await res.json()) as Verbose;
    if (data.language && !language) language = LANG_NAMES[data.language.toLowerCase()] ?? data.language;
    for (const s of data.segments ?? [])
      segments.push({ id: segments.length, s: s.start + c.offsetSec, e: s.end + c.offsetSec, text: s.text.trim() });
    for (const w of data.words ?? []) words.push({ w: w.word.trim(), s: w.start + c.offsetSec, e: w.end + c.offsetSec });
    await input.onProgress?.(((i + 1) / input.chunks.length) * 100);
  }
  const punctuated = attachPunctuation(words, segments);
  return {
    provider: cfg.provider,
    model: cfg.model,
    language,
    text: segments.map((s) => s.text).join(" "),
    segments,
    words: punctuated,
  };
}
