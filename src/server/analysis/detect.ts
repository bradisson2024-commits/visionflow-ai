/**
 * Detector de momentos.
 *
 * 1. La transcripción se divide en frases numeradas con sus tiempos.
 * 2. La IA lee el contexto completo y propone clips como rangos de frases
 *    (nunca tiempos sueltos), con título, tema, gancho, motivo y 9 notas.
 * 3. El servidor valida cada propuesta, la ajusta a la duración pedida
 *    añadiendo o quitando frases completas, elimina solapamientos y calcula
 *    la puntuación final. El orden final es de mayor a menor potencial.
 */
import { z } from "zod";
import type { ClipScoreBreakdown } from "../db/schema";
import type { LlmProvider } from "../providers/llm/types";
import type { Sentence } from "./sentences";

export const SCORE_KEYS = ["hook", "topicInterest", "curiosity", "emotion", "clarity", "standalone", "retention", "ending", "socialPotential"] as const;

/** Peso de cada criterio en la puntuación final (suma 1). */
export const SCORE_WEIGHTS: Record<(typeof SCORE_KEYS)[number], number> = {
  hook: 0.18,
  retention: 0.14,
  standalone: 0.12,
  socialPotential: 0.12,
  curiosity: 0.1,
  emotion: 0.1,
  topicInterest: 0.08,
  clarity: 0.08,
  ending: 0.08,
};

const scoreSchema = z.object(Object.fromEntries(SCORE_KEYS.map((k) => [k, z.number()])) as Record<(typeof SCORE_KEYS)[number], z.ZodNumber>);

const candidateSchema = z.object({
  startSentence: z.number().int(),
  endSentence: z.number().int(),
  title: z.string(),
  topic: z.string(),
  momentType: z.enum(["historia", "pregunta", "explicación", "opinión fuerte", "dato sorprendente", "consejo práctico", "humor", "emoción", "debate", "otro"]),
  hook: z.string(),
  reason: z.string(),
  scores: scoreSchema,
});

export const analysisSchema = z.object({
  topics: z.array(z.object({ name: z.string(), startSentence: z.number().int(), endSentence: z.number().int() })),
  clips: z.array(candidateSchema),
});

export type DetectOptions = { minSec: number; maxSec: number; maxClips: number; language?: string | null };

export type DetectedClip = {
  startSec: number;
  endSec: number;
  sentenceStart: number;
  sentenceEnd: number;
  title: string;
  topic: string;
  hook: string;
  reason: string;
  momentType: string;
  score: number;
  scoreBreakdown: ClipScoreBreakdown;
  transcript: string;
};

const SYSTEM = `Eres un editor experto en contenido de video corto (YouTube Shorts, TikTok, Instagram Reels, Facebook Reels).
Tu trabajo es leer la transcripción completa de un video largo y elegir los fragmentos con más potencial para funcionar como clips independientes.

Cómo trabajar:
- Lee primero toda la transcripción para entender de qué trata, quién habla y cómo cambian los temas.
- Busca: ganchos fuertes al inicio, frases impactantes, preguntas que generan curiosidad, historias con desarrollo y desenlace, explicaciones que se entienden sin contexto previo, opiniones fuertes, datos sorprendentes, consejos prácticos, momentos de humor o emoción.
- Cada clip debe contener UNA idea completa: que empiece donde la idea empieza (idealmente con una frase que enganche en los primeros 3 segundos) y termine cuando la idea concluye. No cortes una historia antes de su desenlace ni una explicación antes de su conclusión.
- Un espectador que no vio el resto del video debe entender el clip. Si el clip depende de algo dicho antes ("como decía antes", "eso que mencioné"), amplíalo para incluir ese contexto o descártalo.
- No repartas el video en trozos iguales: elige sólo los mejores momentos, aunque estén concentrados en una parte del video.
- Los clips no deben solaparse entre sí.
- Indica los clips con números de frase (startSentence y endSentence, ambos incluidos) de la lista proporcionada.

Puntuación (0 a 100 cada criterio, sé exigente y usa todo el rango; 50 es un clip mediocre):
- hook: fuerza de los primeros segundos para detener el scroll.
- topicInterest: interés general del tema para una audiencia amplia en redes.
- curiosity: cuánta curiosidad genera y si invita a ver hasta el final.
- emotion: carga emocional (sorpresa, risa, indignación, inspiración, tensión).
- clarity: claridad del mensaje y del audio hablado.
- standalone: se entiende sin el resto del video.
- retention: ritmo y densidad; ausencia de partes muertas o divagaciones.
- ending: calidad del cierre (conclusión, remate, frase final memorable).
- socialPotential: probabilidad de que se comparta, comente o guarde.
Estas notas son una estimación editorial, no una garantía de resultados.

Escribe title, topic, hook y reason en el mismo idioma que la transcripción. El title debe ser corto (máx. 70 caracteres) y atractivo, sin clickbait engañoso. El hook es la frase de apertura del clip tal como se dice. El reason explica en 1–2 frases por qué este momento tiene potencial.`;

function buildUserPrompt(sentences: Sentence[], opts: DetectOptions, totalSec: number) {
  const lines = sentences.map((s) => `[${s.i}] (${s.s.toFixed(1)}–${s.e.toFixed(1)}s) ${s.text}`).join("\n");
  return `Duración total del video: ${Math.round(totalSec)} s.
Duración deseada de cada clip: entre ${opts.minSec} y ${opts.maxSec} segundos (calcúlala con los tiempos de las frases).
Propón hasta ${Math.min(opts.maxClips * 2, 40)} candidatos ordenados de mejor a peor; sólo los que de verdad tengan potencial.
Además, lista los temas del video con su rango de frases (cambios de tema).

Transcripción en frases numeradas:
${lines}`;
}

const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(Number.isFinite(n) ? n : 0)));

export function overallScore(b: ClipScoreBreakdown): number {
  return clamp(SCORE_KEYS.reduce((acc, k) => acc + b[k] * SCORE_WEIGHTS[k], 0));
}

/** Ajusta un rango de frases a la duración pedida sin partir frases. */
export function fitToDuration(sentences: Sentence[], a: number, b: number, minSec: number, maxSec: number): [number, number] | null {
  if (a < 0 || b >= sentences.length || a > b) return null;
  const dur = () => sentences[b].e - sentences[a].s;
  // Demasiado largo: recorta frases del final (conserva el gancho inicial) y, si hace falta, del inicio.
  while (dur() > maxSec && b > a) {
    const dropEnd = sentences[b - 1].e - sentences[a].s;
    if (dropEnd >= minSec || b - 1 === a) b--;
    else a++;
  }
  // Demasiado corto: añade frases siguientes (completa la idea) y luego anteriores.
  while (dur() < minSec) {
    if (b + 1 < sentences.length && sentences[b + 1].e - sentences[a].s <= maxSec) b++;
    else if (a > 0 && sentences[b].e - sentences[a - 1].s <= maxSec) a--;
    else break;
  }
  const d = dur();
  // Tolerancia de 15 % cuando una sola frase excede el máximo o no hay más contexto.
  if (d < minSec * 0.85 || d > maxSec * 1.15) return null;
  return [a, b];
}

export async function detectMoments(llm: LlmProvider, sentences: Sentence[], opts: DetectOptions, totalSec: number, signal?: AbortSignal) {
  if (sentences.length === 0) throw new Error("La transcripción está vacía: no se detectó voz en el video.");
  const result = await llm.generateJson({
    system: SYSTEM,
    user: buildUserPrompt(sentences, opts, totalSec),
    schema: analysisSchema,
    schemaName: "clip_analysis",
    signal,
  });

  const accepted: DetectedClip[] = [];
  const rejected: { title: string; why: string }[] = [];
  for (const c of result.clips) {
    const fit = fitToDuration(sentences, Math.round(c.startSentence), Math.round(c.endSentence), opts.minSec, opts.maxSec);
    if (!fit) {
      rejected.push({ title: c.title, why: "no encaja en la duración pedida con frases completas" });
      continue;
    }
    const [a, b] = fit;
    const breakdown = Object.fromEntries(SCORE_KEYS.map((k) => [k, clamp(c.scores[k])])) as ClipScoreBreakdown;
    const clip: DetectedClip = {
      startSec: Math.max(0, sentences[a].s - 0.15),
      endSec: Math.min(totalSec, sentences[b].e + 0.3),
      sentenceStart: a,
      sentenceEnd: b,
      title: c.title.trim().slice(0, 120),
      topic: c.topic.trim().slice(0, 80),
      hook: c.hook.trim(),
      reason: c.reason.trim(),
      momentType: c.momentType,
      score: overallScore(breakdown),
      scoreBreakdown: breakdown,
      transcript: sentences.slice(a, b + 1).map((s) => s.text).join(" "),
    };
    // Sin solapamientos: si se solapa >40 % con uno ya aceptado, gana el de mayor puntuación.
    const clash = accepted.findIndex((o) => {
      const inter = Math.min(o.endSec, clip.endSec) - Math.max(o.startSec, clip.startSec);
      return inter > 0.4 * Math.min(o.endSec - o.startSec, clip.endSec - clip.startSec);
    });
    if (clash >= 0) {
      if (accepted[clash].score >= clip.score) {
        rejected.push({ title: clip.title, why: "se solapa con un clip mejor" });
        continue;
      }
      rejected.push({ title: accepted[clash].title, why: "se solapa con un clip mejor" });
      accepted.splice(clash, 1);
    }
    accepted.push(clip);
  }
  accepted.sort((x, y) => y.score - x.score);
  return { clips: accepted.slice(0, opts.maxClips), topics: result.topics, rejected, candidates: result.clips.length };
}
