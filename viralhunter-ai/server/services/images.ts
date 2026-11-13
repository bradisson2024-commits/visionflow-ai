// Generación de imágenes con un proveedor real: OpenAI Images (gpt-image-1).
import OpenAI from "openai";
import { env, requireCreds } from "../env";
import { saveAsset } from "./assets";

let _c: OpenAI | null = null;
const client = () => {
  requireCreds("OPENAI_API_KEY");
  return (_c ??= new OpenAI({ apiKey: env.openaiKey }));
};

export type ImageSize = "1024x1024" | "1536x1024" | "1024x1536";

export async function generateImages(opts: {
  projectId: string;
  kind: string;
  prompt: string;
  size: ImageSize;
  n?: number;
  quality?: "low" | "medium" | "high";
}): Promise<{ id: string; url: string; prompt: string }[]> {
  const r = await client().images.generate({
    model: env.openaiImageModel,
    prompt: opts.prompt,
    size: opts.size,
    n: opts.n ?? 1,
    quality: opts.quality ?? "medium",
  });
  const out: { id: string; url: string; prompt: string }[] = [];
  for (const img of r.data ?? []) {
    let buf: Buffer | null = null;
    if (img.b64_json) buf = Buffer.from(img.b64_json, "base64");
    else if (img.url) buf = Buffer.from(await (await fetch(img.url)).arrayBuffer());
    if (!buf) continue;
    const saved = await saveAsset({
      projectId: opts.projectId,
      kind: opts.kind,
      provider: "openai",
      model: env.openaiImageModel,
      prompt: opts.prompt,
      mimeType: "image/png",
      data: buf,
      meta: { size: opts.size, revised_prompt: img.revised_prompt ?? null },
    });
    out.push({ ...saved, prompt: opts.prompt });
  }
  if (!out.length) throw new Error("El proveedor de imágenes no devolvió ninguna imagen.");
  return out;
}
