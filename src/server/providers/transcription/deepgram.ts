import { readFile } from "node:fs/promises";
import type { TranscriptSegment, TranscriptWord } from "../../db/schema";
import type { TranscribeInput, TranscriptionResult } from "./types";

type DG = {
  results: {
    channels: { detected_language?: string; alternatives: { transcript: string; words: { word: string; punctuated_word?: string; start: number; end: number; confidence: number }[] }[] }[];
    utterances?: { start: number; end: number; transcript: string }[];
  };
};

/** Deepgram Nova: un único envío del audio completo, con palabras puntuadas. */
export async function transcribeDeepgram(input: TranscribeInput, apiKey: string): Promise<TranscriptionResult> {
  const model = "nova-3";
  const params = new URLSearchParams({ model, smart_format: "true", punctuate: "true", utterances: "true" });
  if (input.language && input.language !== "auto") params.set("language", input.language);
  else params.set("detect_language", "true");
  const segments: TranscriptSegment[] = [];
  const words: TranscriptWord[] = [];
  let language: string | null = null;
  for (let i = 0; i < input.chunks.length; i++) {
    const c = input.chunks[i];
    const res = await fetch(`https://api.deepgram.com/v1/listen?${params}`, {
      method: "POST",
      headers: { authorization: `Token ${apiKey}`, "content-type": c.mime },
      body: await readFile(c.file),
      signal: input.signal,
    });
    if (!res.ok) throw new Error(`Deepgram respondió ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const data = (await res.json()) as DG;
    const ch = data.results.channels[0];
    language ??= ch?.detected_language ?? null;
    for (const w of ch?.alternatives[0]?.words ?? []) words.push({ w: w.punctuated_word ?? w.word, s: w.start + c.offsetSec, e: w.end + c.offsetSec, p: w.confidence });
    for (const u of data.results.utterances ?? []) segments.push({ id: segments.length, s: u.start + c.offsetSec, e: u.end + c.offsetSec, text: u.transcript });
    await input.onProgress?.(((i + 1) / input.chunks.length) * 100);
  }
  return { provider: "deepgram", model, language, text: segments.map((s) => s.text).join(" "), segments, words };
}
