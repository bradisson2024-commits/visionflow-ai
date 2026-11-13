// Capa de IA con varios proveedores. Por defecto GRATIS:
//  - gemini: Google AI Studio (clave gratuita, sin tarjeta). Texto + visión.
//  - pollinations: sin clave. Sólo texto (no ve miniaturas).
//  - anthropic: Claude (de pago, opcional).
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { jsonrepair } from "jsonrepair";
import { env, requireCreds, aiProvider } from "../env";

export type Img = { url: string; label?: string };
export type Effort = "low" | "medium" | "high";
export interface JsonRequest<S extends z.ZodType> {
  schema: S;
  system: string;
  prompt: string;
  images?: Img[];
  effort?: Effort;
  maxTokens?: number;
  fixHint?: string;
}

/** ¿El proveedor configurado puede analizar imágenes (miniaturas)? */
export const aiHasVision = () => aiProvider() !== "pollinations";

async function download(url: string): Promise<{ mime: string; data: string } | null> {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(20_000) });
    if (!r.ok) return null;
    const mime = (r.headers.get("content-type") ?? "image/jpeg").split(";")[0];
    if (!/^image\/(jpeg|png|gif|webp)$/.test(mime)) return null;
    return { mime, data: Buffer.from(await r.arrayBuffer()).toString("base64") };
  } catch {
    return null;
  }
}

function extractJson(text: string): unknown {
  const t = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  try {
    return JSON.parse(t);
  } catch {
    const a = t.indexOf("{"), b = t.lastIndexOf("}");
    const body = a >= 0 && b > a ? t.slice(a, b + 1) : t;
    try {
      return JSON.parse(jsonrepair(body)); // corrige comas/comillas sueltas típicas de modelos pequeños
    } catch {
      throw new Error("La IA no devolvió JSON válido.");
    }
  }
}

/** Plantilla de ejemplo a partir del esquema (los modelos pequeños la siguen mejor que un JSON Schema). */
function skeleton(js: any): unknown {
  if (js.type === "object") return Object.fromEntries(Object.entries(js.properties ?? {}).map(([k, v]) => [k, skeleton(v)]));
  if (js.type === "array") return [skeleton(js.items ?? {})];
  const d = js.description ? ` (${js.description})` : "";
  if (js.type === "number" || js.type === "integer") return `<número${d}>`;
  if (js.type === "boolean") return `<true|false${d}>`;
  return `<texto${d}>`;
}
/** Ajusta tipos triviales que los modelos pequeños confunden (objeto suelto ↔ lista, "5" ↔ 5). No inventa datos. */
function coerce(v: any, js: any): any {
  if (v === null || v === undefined || !js) return v;
  if (js.type === "array") {
    const arr = Array.isArray(v) ? v : typeof v === "object" ? (Object.values(v).every((x) => x && typeof x === "object") && js.items?.type === "object" && !("name" in v || "title" in v) ? Object.values(v) : [v]) : [v];
    return arr.map((x) => coerce(x, js.items));
  }
  if (js.type === "object" && typeof v === "object" && !Array.isArray(v))
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, coerce(x, js.properties?.[k])]));
  if ((js.type === "number" || js.type === "integer") && typeof v === "string" && /^-?\d+(\.\d+)?/.test(v)) return parseFloat(v);
  if (js.type === "string" && (typeof v === "number" || typeof v === "boolean")) return String(v);
  if (js.type === "string" && Array.isArray(v)) return v.join("\n");
  if (js.type === "boolean" && typeof v === "string") return v.toLowerCase() === "true";
  return v;
}

const schemaText = (s: z.ZodType) => JSON.stringify(skeleton(z.toJSONSchema(s)), null, 1);

// ---------------- Gemini (gratis) ----------------
let geminiModelCache: string | null = null;
async function geminiModel(): Promise<string> {
  if (env.geminiModel) return env.geminiModel;
  if (geminiModelCache) return geminiModelCache;
  // Elige automáticamente el modelo "flash" más reciente disponible para la clave (todos tienen plan gratuito).
  const r = await fetch("https://generativelanguage.googleapis.com/v1beta/models?pageSize=200", { headers: { "x-goog-api-key": env.geminiKey } });
  const body = (await r.json().catch(() => ({}))) as any;
  if (!r.ok) throw new Error(`Gemini ${r.status}: ${body?.error?.message ?? "no se pudieron listar los modelos"}`);
  const names: string[] = (body.models ?? [])
    .filter((m: any) => m.supportedGenerationMethods?.includes("generateContent"))
    .map((m: any) => String(m.name).replace(/^models\//, ""))
    .filter((n: string) => /^gemini-[\d.]+-flash$/.test(n));
  names.sort((a, b) => parseFloat(b.split("-")[1]) - parseFloat(a.split("-")[1]));
  geminiModelCache = names[0] ?? "gemini-2.5-flash";
  return geminiModelCache;
}

export async function geminiGenerate(model: string, body: unknown): Promise<any> {
  requireCreds("GEMINI_API_KEY");
  for (let attempt = 0; attempt < 4; attempt++) {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: "POST",
      headers: { "x-goog-api-key": env.geminiKey, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(300_000),
    });
    const j = (await r.json().catch(() => ({}))) as any;
    if (r.status === 429 || r.status === 503) {
      const retry = Number(/(\d+)s/.exec(j?.error?.details?.find((d: any) => d.retryDelay)?.retryDelay ?? "")?.[1]) || 15 * (attempt + 1);
      await new Promise((res) => setTimeout(res, Math.min(retry, 60) * 1000));
      continue;
    }
    if (!r.ok) throw new Error(`Gemini ${r.status}: ${j?.error?.message ?? "error"}`);
    return j;
  }
  throw new Error("Gemini: límite del plan gratuito alcanzado. Espera un minuto y vuelve a intentarlo.");
}

async function viaGemini<S extends z.ZodType>(req: JsonRequest<S>): Promise<unknown> {
  const parts: any[] = [];
  for (const img of req.images ?? []) {
    const d = await download(img.url);
    if (!d) continue;
    if (img.label) parts.push({ text: img.label });
    parts.push({ inline_data: { mime_type: d.mime, data: d.data } });
  }
  parts.push({ text: req.prompt });
  const j = await geminiGenerate(await geminiModel(), {
    systemInstruction: { parts: [{ text: req.system }] },
    contents: [{ role: "user", parts }],
    generationConfig: {
      responseMimeType: "application/json",
      responseJsonSchema: (({ $schema, ...rest }) => rest)(z.toJSONSchema(req.schema) as any),
      maxOutputTokens: req.maxTokens ?? 32000,
    },
  });
  const cand = j.candidates?.[0];
  if (!cand?.content?.parts?.length) throw new Error(`Gemini no devolvió contenido (${cand?.finishReason ?? j.promptFeedback?.blockReason ?? "desconocido"}).`);
  return extractJson(cand.content.parts.map((p: any) => p.text ?? "").join(""));
}

// ---------------- Pollinations (gratis, sin clave, sólo texto) ----------------
async function viaPollinations<S extends z.ZodType>(req: JsonRequest<S>): Promise<unknown> {
  const note = req.images?.length
    ? "\n\nNOTA: este modelo no puede ver imágenes; basa el análisis sólo en los textos y dilo en los campos de limitaciones."
    : "";
  for (let attempt = 0; attempt < 5; attempt++) {
    const r = await fetch("https://text.pollinations.ai/openai", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(env.pollinationsToken ? { Authorization: `Bearer ${env.pollinationsToken}` } : {}) },
      body: JSON.stringify({
        model: env.pollinationsTextModel,
        messages: [
          {
            role: "system",
            content: `${req.system}\nResponde ÚNICAMENTE con un objeto JSON válido con EXACTAMENTE esta estructura y todas sus claves (sustituye cada <...> por el valor real; las listas pueden tener varios elementos):\n${schemaText(req.schema)}`,
          },
          { role: "user", content: req.prompt + note + (req.fixHint ? `\n\nTu respuesta anterior no era válida: ${req.fixHint}. Corrígelo e incluye todas las claves.` : "") },
        ],
        response_format: { type: "json_object" },
        private: true,
      }),
      signal: AbortSignal.timeout(300_000),
    });
    if (r.status === 402 || r.status === 429 || r.status === 503) {
      const t = await r.text().catch(() => "");
      const s = Number(/retry after (\d+)\s*s/i.exec(t)?.[1]) || 10 * (attempt + 1);
      await new Promise((res) => setTimeout(res, Math.min(s + 2, 70) * 1000));
      continue;
    }
    const j = (await r.json().catch(() => ({}))) as any;
    if (!r.ok) throw new Error(`Pollinations ${r.status}: ${j?.error?.message ?? "error"}`);
    const content = j.choices?.[0]?.message?.content ?? "";
    if (process.env.LLM_DEBUG) console.error("[pollinations raw]", content.slice(0, 3000));
    return extractJson(content);
  }
  throw new Error("Pollinations: límite de uso gratuito alcanzado, inténtalo en unos minutos.");
}

// ---------------- Anthropic (opcional, de pago) ----------------
async function viaAnthropic<S extends z.ZodType>(req: JsonRequest<S>): Promise<unknown> {
  requireCreds("ANTHROPIC_API_KEY");
  const client = new Anthropic({ apiKey: env.anthropicKey });
  const content: Anthropic.Beta.BetaContentBlockParam[] = [];
  for (const img of req.images ?? []) {
    const d = await download(img.url);
    if (!d) continue;
    if (img.label) content.push({ type: "text", text: img.label });
    content.push({ type: "image", source: { type: "base64", media_type: d.mime as "image/jpeg", data: d.data } });
  }
  content.push({ type: "text", text: req.prompt });
  const msg = await client.beta.messages
    .stream({
      model: env.anthropicModel,
      max_tokens: req.maxTokens ?? 32000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system: req.system,
      output_config: { effort: req.effort ?? "medium", format: betaZodOutputFormat(req.schema) },
      messages: [{ role: "user", content }],
    })
    .finalMessage();
  if (msg.stop_reason === "refusal") throw new Error("La IA rechazó la solicitud.");
  if (msg.stop_reason === "max_tokens") throw new Error("La respuesta de la IA se cortó (max_tokens).");
  return extractJson(msg.content.map((b) => (b.type === "text" ? b.text : "")).join(""));
}

/** Elimina elementos incompletos de listas de objetos (si queda al menos uno válido). No rellena nada. */
function pruneInvalid(v: any, schema: z.ZodType): any {
  if (!v || typeof v !== "object" || Array.isArray(v)) return v;
  const shape = (schema as any).shape ?? (schema as any)._zod?.def?.shape;
  if (!shape) return v;
  const out: any = { ...v };
  for (const [k, sub] of Object.entries<any>(shape)) {
    const el = sub?._zod?.def?.element ?? sub?.element;
    if (Array.isArray(out[k]) && el) {
      const ok = out[k].filter((x: unknown) => el.safeParse(x).success);
      if (ok.length) out[k] = ok;
    }
  }
  return out;
}

export async function generateJson<S extends z.ZodType>(req: JsonRequest<S>): Promise<z.infer<S>> {
  const p = aiProvider();
  let fixHint: string | undefined;
  const run = () => (p === "anthropic" ? viaAnthropic(req) : p === "gemini" ? viaGemini(req) : viaPollinations({ ...req, fixHint }));
  let last: unknown;
  for (let i = 0; i < 3; i++) {
    try {
      const value = coerce(await run(), z.toJSONSchema(req.schema));
      const first = req.schema.safeParse(value);
      if (first.success) return first.data;
      return req.schema.parse(pruneInvalid(value, req.schema));
    } catch (e) {
      last = e;
      if (e instanceof z.ZodError) fixHint = e.issues.slice(0, 8).map((x) => `${x.path.join(".")}: ${x.message}`).join("; ");
      if (!(e instanceof z.ZodError) && !/JSON/.test((e as Error).message)) throw e;
    }
  }
  throw new Error(`La IA devolvió un formato incorrecto: ${(last as Error).message.slice(0, 200)}`);
}
