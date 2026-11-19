import { z } from "zod";
import { handle, json, parseBody, requireUser } from "@/server/http";
import { startAnalysis } from "@/server/services/analysis";

const schema = z.object({
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

export const POST = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const user = await requireUser();
  const { id } = await ctx.params;
  const body = await parseBody(req, schema);
  return json({ job: await startAnalysis(user.id, id, body) }, 202);
});
