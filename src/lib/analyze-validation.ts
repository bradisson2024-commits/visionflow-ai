import { z } from "zod";

export const analyzeSchema = z.object({
  mode: z.enum(["full", "transcribe"]).default("full"),
  clipLength: z.object({
    preset: z.enum(["short", "medium", "long", "custom"]),
    minSec: z.number().min(3).max(600),
    maxSec: z.number().min(5).max(900),
  }),
  maxClips: z.number().int().min(1).max(30).default(10),
  language: z.string().max(10).default("auto"),
  aspectRatio: z.enum(["9:16", "16:9", "1:1", "4:5"]).default("9:16"),
  captionStyle: z.string().max(30).default("viral"),
  reuseTranscript: z.boolean().default(true),
});

export const importSchema = z.object({
  url: z.string().trim().min(1, "Pega un enlace.").max(2000),
  confirmRights: z.boolean().optional(),
  autoAnalyze: analyzeSchema.optional(),
});
