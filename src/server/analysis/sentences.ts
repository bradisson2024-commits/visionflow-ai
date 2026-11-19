import type { TranscriptSegment, TranscriptWord } from "../db/schema";

export type Sentence = { i: number; s: number; e: number; text: string; w0: number; w1: number };

const END = /[.!?…¿¡]?[.!?…]["»”)\]]?$/;

/**
 * Agrupa las palabras en frases. Un clip siempre empieza y termina en el
 * límite de una frase, así nunca se corta a mitad de una idea.
 * Corte: signo final (. ! ? …), o pausa larga, o frase demasiado larga
 * (en ese caso se corta en la coma más cercana).
 */
/** Índices de las palabras que cierran un segmento del transcriptor (frontera natural de frase). */
export function segmentEndIndices(words: TranscriptWord[], segments: TranscriptSegment[]): Set<number> {
  const ends = new Set<number>();
  let k = 0;
  for (const seg of segments) {
    while (k < words.length && words[k].e <= seg.e + 0.05) k++;
    if (k > 0) ends.add(k - 1);
  }
  return ends;
}

export function buildSentences(words: TranscriptWord[], segmentEnds: Set<number> = new Set(), opts = { pauseSec: 1.0, segmentPauseSec: 0.3, maxWords: 45 }): Sentence[] {
  const out: Sentence[] = [];
  let start = 0;
  const push = (end: number) => {
    if (end < start) return;
    const ws = words.slice(start, end + 1);
    out.push({ i: out.length, s: ws[0].s, e: ws[ws.length - 1].e, text: ws.map((w) => w.w).join(" "), w0: start, w1: end });
    start = end + 1;
  };
  for (let k = 0; k < words.length; k++) {
    const w = words[k];
    const next = words[k + 1];
    const len = k - start + 1;
    if (!next) {
      push(k);
      break;
    }
    const gap = next.s - w.e;
    if (END.test(w.w) || gap >= opts.pauseSec || (segmentEnds.has(k) && gap >= opts.segmentPauseSec && len >= 4)) {
      push(k);
      continue;
    }
    if (len >= opts.maxWords) {
      // retrocede hasta una coma si la hay
      let cut = k;
      for (let j = k; j > start + 5; j--) if (/[,;:]$/.test(words[j].w)) { cut = j; break; }
      push(cut);
      k = cut;
    }
  }
  return out;
}
