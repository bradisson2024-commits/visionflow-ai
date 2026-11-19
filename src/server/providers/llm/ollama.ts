/**
 * Proveedor GRATUITO: modelo de IA local con Ollama (https://ollama.com).
 * Corre en el propio computador/servidor, sin claves ni coste por uso.
 * API nativa /api/chat con `format` = esquema JSON (salida estructurada) y
 * `options.num_ctx` para que quepa la transcripción.
 */
import { z } from "zod";
import { env } from "../../env";
import type { JsonRequest, LlmProvider } from "./types";

export const ollamaBase = () => (env.OLLAMA_URL || "http://localhost:11434").replace(/\/$/, "");
export const ollamaModel = () => env.LLM_MODEL || "qwen2.5:7b";

/** Comprueba que Ollama responde y que el modelo está descargado. Devuelve el problema o null. */
export async function checkOllama(): Promise<string | null> {
  let res: Response;
  try {
    res = await fetch(`${ollamaBase()}/api/tags`, { signal: AbortSignal.timeout(3000) });
  } catch {
    return `Ollama no responde en ${ollamaBase()}. Instálalo desde ollama.com y ábrelo (o ejecuta \`ollama serve\`).`;
  }
  if (!res.ok) return `Ollama respondió ${res.status} en ${ollamaBase()}.`;
  const data = (await res.json()) as { models?: { name: string; model?: string }[] };
  const want = ollamaModel();
  const names = (data.models ?? []).flatMap((m) => [m.name, m.model ?? ""]);
  const ok = names.some((n) => n === want || n === `${want}:latest` || n.replace(/:latest$/, "") === want);
  return ok ? null : `El modelo «${want}» no está instalado en Ollama. Ejecuta: ollama pull ${want}`;
}

export function ollamaProvider(): LlmProvider {
  const model = ollamaModel();
  return {
    id: "ollama",
    model,
    async generateJson<T extends z.ZodType>(req: JsonRequest<T>): Promise<z.infer<T>> {
      const problem = await checkOllama();
      if (problem) throw new Error(problem);
      const schemaJson = z.toJSONSchema(req.schema);
      let res: Response;
      try {
        res = await fetch(`${ollamaBase()}/api/chat`, {
          method: "POST",
          signal: req.signal,
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            model,
            stream: false,
            format: schemaJson,
            options: { num_ctx: env.OLLAMA_NUM_CTX, temperature: 0.2 },
            keep_alive: "10m",
            messages: [
              { role: "system", content: `${req.system}\n\nResponde sólo con JSON válido que cumpla el esquema indicado.` },
              { role: "user", content: req.user },
            ],
          }),
        });
      } catch (e) {
        if ((e as Error).name === "AbortError") throw e;
        throw new Error(`No se pudo conectar con Ollama en ${ollamaBase()}: ${(e as Error).message}`);
      }
      if (!res.ok) throw new Error(`Ollama respondió ${res.status}: ${(await res.text()).slice(0, 300)}`);
      const data = (await res.json()) as { message?: { content?: string }; done_reason?: string };
      if (data.done_reason === "length") throw new Error("La respuesta del modelo local se cortó por longitud. Aumenta OLLAMA_NUM_CTX o reduce el máximo de clips.");
      let parsed: unknown;
      try {
        parsed = JSON.parse(data.message?.content ?? "");
      } catch {
        throw new Error("El modelo local devolvió una respuesta que no es JSON válido. Prueba con un modelo más capaz (p. ej. qwen2.5:14b).");
      }
      const r = req.schema.safeParse(parsed);
      if (!r.success) throw new Error(`El modelo local devolvió datos con formato incorrecto: ${r.error.issues[0]?.message}. Prueba con un modelo más capaz.`);
      return r.data as z.infer<T>;
    },
  };
}
