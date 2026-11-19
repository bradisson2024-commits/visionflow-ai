/**
 * Proveedor compatible con la API Chat Completions de OpenAI (OpenAI, Groq,
 * OpenRouter, Ollama…). Pide JSON y lo valida con el esquema Zod.
 */
import { z } from "zod";
import type { JsonRequest, LlmProvider } from "./types";

export function openAICompatibleProvider(cfg: { id: string; baseUrl: string; apiKey: string; model: string }): LlmProvider {
  return {
    id: cfg.id,
    model: cfg.model,
    async generateJson<T extends z.ZodType>(req: JsonRequest<T>): Promise<z.infer<T>> {
      const schemaJson = z.toJSONSchema(req.schema);
      const res = await fetch(`${cfg.baseUrl.replace(/\/$/, "")}/chat/completions`, {
        method: "POST",
        signal: req.signal,
        headers: { "content-type": "application/json", ...(cfg.apiKey ? { authorization: `Bearer ${cfg.apiKey}` } : {}) },
        body: JSON.stringify({
          model: cfg.model,
          response_format: { type: "json_schema", json_schema: { name: req.schemaName, schema: schemaJson } },
          messages: [
            { role: "system", content: `${req.system}\n\nResponde únicamente con JSON que cumpla este esquema:\n${JSON.stringify(schemaJson)}` },
            { role: "user", content: req.user },
          ],
        }),
      });
      if (!res.ok) throw new Error(`El proveedor de IA (${cfg.id}) respondió ${res.status}: ${(await res.text()).slice(0, 300)}`);
      const data = (await res.json()) as { choices: { message: { content: string | null; refusal?: string | null } }[] };
      const msg = data.choices?.[0]?.message;
      if (msg?.refusal) throw new Error("El modelo de IA rechazó analizar este contenido.");
      const raw = (msg?.content ?? "").replace(/^```(?:json)?\s*|\s*```$/g, "");
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        throw new Error("La IA devolvió una respuesta que no es JSON válido.");
      }
      const r = req.schema.safeParse(parsed);
      if (!r.success) throw new Error(`La IA devolvió datos con formato incorrecto: ${r.error.issues[0]?.message}`);
      return r.data as z.infer<T>;
    },
  };
}
