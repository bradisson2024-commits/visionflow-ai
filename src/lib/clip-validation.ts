import { z } from "zod";

export const captionStyleSchema = z.object({
  preset: z.string().max(30),
  enabled: z.boolean(),
  fontFamily: z.enum(["Poppins Black", "Poppins ExtraBold", "Poppins SemiBold", "Anton", "Bebas Neue"]),
  fontSize: z.number().min(16).max(160),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  highlightColor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  backgroundColor: z.string().regex(/^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/).nullable(),
  outlineColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullable(),
  outlineWidth: z.number().min(0).max(12),
  position: z.enum(["top", "middle", "bottom"]),
  highlightMode: z.enum(["none", "word", "karaoke"]),
  uppercase: z.boolean(),
  wordsPerLine: z.number().int().min(1).max(12),
});

export const exportSchema = z.object({
  resolution: z.union([z.literal(720), z.literal(1080)]),
  quality: z.enum(["high", "medium", "low"]),
  fps: z.union([z.literal("source"), z.literal(24), z.literal(30), z.literal(60)]),
  subtitles: z.enum(["burned", "srt", "both", "none"]),
});

export const editSchema = z.object({
  aspectRatio: z.enum(["9:16", "16:9", "1:1", "4:5"]),
  reframe: z.enum(["auto", "center", "manual"]),
  manualFocus: z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) }).optional(),
  zoom: z.number().min(1).max(3).optional(),
  volume: z.number().min(0).max(3).optional(),
  captions: captionStyleSchema,
  export: exportSchema.optional(),
});

export const wordSchema = z.object({ w: z.string().min(1).max(60), s: z.number().min(0), e: z.number().min(0), p: z.number().optional() });

export const clipPatchSchema = z.object({
  title: z.string().max(120).optional(),
  startSec: z.number().min(0).optional(),
  endSec: z.number().min(0).optional(),
  edit: editSchema.optional(),
  captionWords: z.array(wordSchema).max(20000).nullable().optional(),
});
