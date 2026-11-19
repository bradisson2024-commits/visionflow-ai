/**
 * Estilos de subtítulos. Compartido por el editor (vista previa) y por el
 * renderizado (archivo ASS que FFmpeg/libass graba en el video).
 */
import type { AspectRatio, CaptionStyle, ClipEdit } from "@/server/db/schema";

export const CAPTION_FONTS = [
  { family: "Poppins Black", label: "Poppins Black", file: "Poppins-Black.ttf" },
  { family: "Poppins ExtraBold", label: "Poppins ExtraBold", file: "Poppins-ExtraBold.ttf" },
  { family: "Poppins SemiBold", label: "Poppins SemiBold", file: "Poppins-SemiBold.ttf" },
  { family: "Anton", label: "Anton", file: "Anton-Regular.ttf" },
  { family: "Bebas Neue", label: "Bebas Neue", file: "BebasNeue-Regular.ttf" },
] as const;

export const CAPTION_PRESETS: Record<string, { label: string; description: string; style: CaptionStyle }> = {
  classic: {
    label: "Clásico",
    description: "Texto blanco con contorno, frase completa abajo.",
    style: { preset: "classic", enabled: true, fontFamily: "Poppins SemiBold", fontSize: 54, color: "#FFFFFF", highlightColor: "#FFFFFF", backgroundColor: null, outlineColor: "#000000", outlineWidth: 3, position: "bottom", highlightMode: "none", uppercase: false, wordsPerLine: 7 },
  },
  viral: {
    label: "Viral",
    description: "Mayúsculas grandes, 2–3 palabras, palabra activa en amarillo.",
    style: { preset: "viral", enabled: true, fontFamily: "Poppins Black", fontSize: 78, color: "#FFFFFF", highlightColor: "#FFE14D", backgroundColor: null, outlineColor: "#000000", outlineWidth: 5, position: "middle", highlightMode: "word", uppercase: true, wordsPerLine: 3 },
  },
  minimal: {
    label: "Minimalista",
    description: "Discreto, sin contorno, con sombra suave.",
    style: { preset: "minimal", enabled: true, fontFamily: "Poppins SemiBold", fontSize: 46, color: "#FFFFFF", highlightColor: "#FFFFFF", backgroundColor: null, outlineColor: null, outlineWidth: 0, position: "bottom", highlightMode: "none", uppercase: false, wordsPerLine: 6 },
  },
  highlight: {
    label: "Palabras resaltadas",
    description: "Cada palabra se ilumina al pronunciarse (karaoke).",
    style: { preset: "highlight", enabled: true, fontFamily: "Poppins ExtraBold", fontSize: 66, color: "#FFFFFF", highlightColor: "#FF8A1F", backgroundColor: null, outlineColor: "#000000", outlineWidth: 4, position: "middle", highlightMode: "karaoke", uppercase: false, wordsPerLine: 4 },
  },
  podcast: {
    label: "Podcast",
    description: "Caja oscura semitransparente, fácil de leer.",
    style: { preset: "podcast", enabled: true, fontFamily: "Poppins SemiBold", fontSize: 50, color: "#FFFFFF", highlightColor: "#45D3F0", backgroundColor: "#000000B3", outlineColor: null, outlineWidth: 0, position: "bottom", highlightMode: "word", uppercase: false, wordsPerLine: 6 },
  },
};

export const ASPECTS: { id: AspectRatio; label: string; w: number; h: number; hint: string }[] = [
  { id: "9:16", label: "9:16", w: 9, h: 16, hint: "Shorts · TikTok · Reels" },
  { id: "1:1", label: "1:1", w: 1, h: 1, hint: "Cuadrado" },
  { id: "4:5", label: "4:5", w: 4, h: 5, hint: "Feed vertical" },
  { id: "16:9", label: "16:9", w: 16, h: 9, hint: "Horizontal" },
];

export function defaultEdit(aspectRatio: AspectRatio = "9:16", preset = "viral"): ClipEdit {
  return { aspectRatio, reframe: "auto", zoom: 1, volume: 1, captions: { ...(CAPTION_PRESETS[preset] ?? CAPTION_PRESETS.viral).style } };
}

/** Tamaño de salida para una relación de aspecto y altura/ancho base (pares, para H.264). */
export function outputSize(aspect: AspectRatio, resolution: 720 | 1080): { w: number; h: number } {
  const a = ASPECTS.find((x) => x.id === aspect)!;
  const even = (n: number) => Math.round(n / 2) * 2;
  // `resolution` es el lado corto.
  if (a.w <= a.h) return { w: resolution, h: even((resolution * a.h) / a.w) };
  return { w: even((resolution * a.w) / a.h), h: resolution };
}

export const CLIP_LENGTH_PRESETS = {
  short: { label: "Cortos", minSec: 15, maxSec: 35 },
  medium: { label: "Medianos", minSec: 30, maxSec: 60 },
  long: { label: "Largos", minSec: 60, maxSec: 90 },
} as const;
