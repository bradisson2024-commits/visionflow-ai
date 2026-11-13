// Generación de imágenes con proveedores reales. Por defecto GRATIS:
//  - pollinations (por defecto): gratis y sin clave (modelo FLUX). https://pollinations.ai
//  - huggingface: gratis con token de Hugging Face (FLUX.1-schnell, Inference Providers).
//  - openai: de pago (gpt-image-1), opcional.
import { env, requireCreds } from "../env";
import { saveAsset } from "./assets";

export type ImageSize = "1024x1024" | "1536x1024" | "1024x1536";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function detectMime(buf: Buffer): string | null {
  if (buf[0] === 0x89 && buf[1] === 0x50) return "image/png";
  if (buf[0] === 0xff && buf[1] === 0xd8) return "image/jpeg";
  if (buf.subarray(0, 4).toString() === "RIFF" && buf.subarray(8, 12).toString() === "WEBP") return "image/webp";
  return null;
}

async function fetchImage(url: string, init: RequestInit, label: string): Promise<Buffer> {
  for (let attempt = 0; attempt < 6; attempt++) {
    const res = await fetch(url, { ...init, signal: AbortSignal.timeout(180_000) });
    // 402/429: límite del plan gratuito (p. ej. Pollinations: 1 imagen cada ~45 s por IP); 503: modelo cargando.
    if (res.status === 402 || res.status === 429 || res.status === 503) {
      const body = await res.text().catch(() => "");
      const hinted = Number(res.headers.get("retry-after")) || Number(/retry after (\d+)\s*s/i.exec(body)?.[1]);
      await sleep(Math.min(70, (hinted || 10 * (attempt + 1)) + 2) * 1000);
      continue;
    }
    if (!res.ok) throw new Error(`${label} ${res.status}: ${(await res.text().catch(() => "")).slice(0, 200)}`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (!detectMime(buf)) throw new Error(`${label} no devolvió una imagen válida.`);
    return buf;
  }
  throw new Error(`${label}: límite de uso gratuito alcanzado, inténtalo en unos minutos.`);
}

async function pollinations(prompt: string, size: ImageSize, seed: number): Promise<Buffer> {
  const [w, h] = size.split("x").map(Number);
  const u = new URL(`https://image.pollinations.ai/prompt/${encodeURIComponent(prompt.slice(0, 1500))}`);
  u.searchParams.set("width", String(w));
  u.searchParams.set("height", String(h));
  u.searchParams.set("seed", String(seed));
  u.searchParams.set("model", env.pollinationsModel);
  u.searchParams.set("nologo", "true");
  u.searchParams.set("private", "true");
  const headers: Record<string, string> = {};
  if (env.pollinationsToken) headers.Authorization = `Bearer ${env.pollinationsToken}`;
  return fetchImage(u.toString(), { headers }, "Pollinations");
}

const HF_SIZE: Record<ImageSize, [number, number]> = { "1024x1024": [1024, 1024], "1536x1024": [1344, 896], "1024x1536": [896, 1344] };

async function huggingface(prompt: string, size: ImageSize, seed: number): Promise<Buffer> {
  requireCreds("HF_TOKEN");
  const [width, height] = HF_SIZE[size];
  return fetchImage(
    `https://router.huggingface.co/hf-inference/models/${env.hfImageModel}`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${env.hfToken}`, "Content-Type": "application/json", Accept: "image/png" },
      body: JSON.stringify({ inputs: prompt, parameters: { width, height, seed } }),
    },
    "Hugging Face",
  );
}

async function openai(prompt: string, size: ImageSize, quality: string): Promise<Buffer> {
  requireCreds("OPENAI_API_KEY");
  const { default: OpenAI } = await import("openai");
  const r = await new OpenAI({ apiKey: env.openaiKey }).images.generate({ model: env.openaiImageModel, prompt, size, n: 1, quality: quality as "medium" });
  const b64 = r.data?.[0]?.b64_json;
  if (!b64) throw new Error("OpenAI no devolvió ninguna imagen.");
  return Buffer.from(b64, "base64");
}

export async function generateImages(opts: {
  projectId: string;
  kind: string;
  prompt: string;
  size: ImageSize;
  n?: number;
  quality?: "low" | "medium" | "high";
}): Promise<{ id: string; url: string; prompt: string }[]> {
  const out: { id: string; url: string; prompt: string }[] = [];
  const provider = env.imageProvider;
  for (let i = 0; i < (opts.n ?? 1); i++) {
    const seed = Math.floor(Math.random() * 2_000_000_000);
    const buf =
      provider === "openai" ? await openai(opts.prompt, opts.size, opts.quality ?? "medium")
      : provider === "huggingface" ? await huggingface(opts.prompt, opts.size, seed)
      : await pollinations(opts.prompt, opts.size, seed);
    const model = provider === "openai" ? env.openaiImageModel : provider === "huggingface" ? env.hfImageModel : `pollinations/${env.pollinationsModel}`;
    const saved = await saveAsset({
      projectId: opts.projectId,
      kind: opts.kind,
      provider,
      model,
      prompt: opts.prompt,
      mimeType: detectMime(buf)!,
      data: buf,
      meta: { size: opts.size, seed },
    });
    out.push({ ...saved, prompt: opts.prompt });
  }
  return out;
}
