import type { TranscriptSegment, TranscriptWord } from "../../db/schema";

const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^\p{L}\p{N}]/gu, "");

/**
 * Las palabras con tiempos de Whisper llegan sin puntuación; los segmentos sí
 * la tienen. Se alinean por orden para recuperar mayúsculas y signos, que son
 * necesarios para detectar finales de frase.
 */
export function attachPunctuation(words: TranscriptWord[], segments: TranscriptSegment[]): TranscriptWord[] {
  const out = words.map((w) => ({ ...w }));
  let wi = 0;
  for (const seg of segments) {
    const tokens = seg.text.split(/\s+/).filter(Boolean);
    for (const tok of tokens) {
      const n = norm(tok);
      if (!n) continue;
      // busca la palabra correspondiente en una ventana corta
      for (let k = wi; k < Math.min(out.length, wi + 4); k++) {
        if (norm(out[k].w) === n) {
          out[k].w = tok;
          wi = k + 1;
          break;
        }
      }
    }
  }
  return out;
}
