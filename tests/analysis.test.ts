/**
 * Pruebas unitarias del post-procesado del detector de momentos.
 * Usan un proveedor de IA de PRUEBA con respuestas fijas: comprueban que el
 * servidor ajusta los clips a frases completas, respeta la duración, elimina
 * solapamientos y ordena por puntuación. No se usan en la aplicación.
 */
import { describe, expect, it } from "vitest";
import { buildSentences, segmentEndIndices } from "@/server/analysis/sentences";
import { detectMoments, fitToDuration, overallScore } from "@/server/analysis/detect";
import type { LlmProvider } from "@/server/providers/llm/types";
import { assColor, buildAss, groupLines } from "@/server/render/subtitles";
import { cropBox, planCrop } from "@/server/render/reframe";

// 30 frases de 4 s (5 palabras de 0,8 s), cada una termina en punto.
const words = Array.from({ length: 150 }, (_, i) => ({ w: i % 5 === 4 ? `p${i}.` : `p${i}`, s: i * 0.8, e: i * 0.8 + 0.7 }));
const sentences = buildSentences(words);

const stub = (clips: unknown[]): LlmProvider => ({ id: "stub", model: "stub", generateJson: async () => ({ topics: [], clips }) as never });
const scores = (v: number) => ({ hook: v, topicInterest: v, curiosity: v, emotion: v, clarity: v, standalone: v, retention: v, ending: v, socialPotential: v });
const cand = (a: number, b: number, v: number, title = `c${a}`) => ({ startSentence: a, endSentence: b, title, topic: "t", momentType: "historia", hook: "h", reason: "r", scores: scores(v) });

describe("frases", () => {
  it("corta en signos de final de frase", () => {
    expect(sentences).toHaveLength(30);
    expect(sentences[0].text).toBe("p0 p1 p2 p3 p4.");
  });
  it("usa los cortes del transcriptor cuando no hay puntuación", () => {
    const ws = Array.from({ length: 20 }, (_, i) => ({ w: `w${i}`, s: i * 0.5 + (i >= 10 ? 0.5 : 0), e: i * 0.5 + 0.4 + (i >= 10 ? 0.5 : 0) }));
    const segs = [{ id: 0, s: 0, e: 4.9, text: "" }, { id: 1, s: 5.5, e: 10.5, text: "" }];
    expect(buildSentences(ws, segmentEndIndices(ws, segs))).toHaveLength(2);
  });
});

describe("detector", () => {
  it("ajusta la duración añadiendo frases completas", () => {
    expect(fitToDuration(sentences, 2, 3, 15, 30)).toEqual([2, 5]); // 8 s → 16 s
    expect(fitToDuration(sentences, 0, 20, 15, 30)).toEqual([0, 6]); // 84 s → recorta por el final
  });
  it("ordena por puntuación, elimina solapamientos y respeta el máximo", async () => {
    const r = await detectMoments(stub([cand(0, 4, 60, "a"), cand(1, 5, 90, "b"), cand(10, 14, 75, "c"), cand(20, 24, 40, "d")]), sentences, { minSec: 15, maxSec: 30, maxClips: 2 }, 120);
    expect(r.clips.map((c) => c.title)).toEqual(["b", "c"]);
    expect(r.rejected.some((x) => x.title === "a")).toBe(true);
    for (const c of r.clips) {
      expect(c.endSec - c.startSec).toBeGreaterThanOrEqual(15 * 0.85);
      expect(c.transcript.endsWith(".")).toBe(true); // termina en final de frase
    }
  });
  it("descarta índices imposibles en vez de inventar tiempos", async () => {
    const r = await detectMoments(stub([cand(40, 50, 99)]), sentences, { minSec: 15, maxSec: 30, maxClips: 5 }, 120);
    expect(r.clips).toHaveLength(0);
  });
  it("calcula la puntuación ponderada en 0–100", () => {
    expect(overallScore(scores(80))).toBe(80);
    expect(overallScore({ ...scores(0), hook: 100 })).toBe(18);
  });
});

describe("subtítulos y encuadre", () => {
  it("convierte colores a formato ASS", () => {
    expect(assColor("#FF8A1F")).toBe("&H001F8AFF");
    expect(assColor("#000000B3")).toBe("&H4C000000");
  });
  it("agrupa palabras y genera eventos con resaltado", () => {
    expect(groupLines(words.slice(0, 10), 3).length).toBeGreaterThanOrEqual(4);
    const ass = buildAss(words.slice(0, 6), { preset: "viral", enabled: true, fontFamily: "Poppins Black", fontSize: 78, color: "#FFFFFF", highlightColor: "#FFE14D", backgroundColor: null, outlineColor: "#000000", outlineWidth: 5, position: "middle", highlightMode: "word", uppercase: true, wordsPerLine: 3 }, 1080, 1920);
    expect(ass).toContain("PlayResY: 1920");
    expect(ass).toContain("{\\c&H004DE1FF}P0{\\r}");
  });
  it("calcula el recorte 9:16 de una fuente 16:9 y sigue a la cara", () => {
    expect(cropBox(1920, 1080, 9 / 16)).toEqual({ cropW: 606, cropH: 1080 });
    const det = { width: 1920, height: 1080, samples: Array.from({ length: 20 }, (_, i) => ({ t: i * 0.25, faces: [[1500, 500, 200, 200, 0.9]] as [number, number, number, number, number][] })) };
    const plan = planCrop(det, 9 / 16, { mode: "auto", allowSplit: true }, 1920, 1080);
    expect(plan.mode).toBe("track");
    expect(plan.keys[0].x).toBeGreaterThan(1100); // la cara queda dentro del recorte
    expect(plan.keys[0].x).toBeLessThan(1500);
  });
  it("con dos personas separadas propone pantalla dividida", () => {
    const det = { width: 1920, height: 1080, samples: Array.from({ length: 20 }, (_, i) => ({ t: i * 0.25, faces: [[400, 500, 200, 200, 0.9], [1500, 500, 200, 200, 0.9]] as [number, number, number, number, number][] })) };
    expect(planCrop(det, 9 / 16, { mode: "auto", allowSplit: true }, 1920, 1080).mode).toBe("split");
  });
});
