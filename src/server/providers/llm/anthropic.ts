/**
 * Proveedor Claude (Anthropic) con el SDK oficial y salida estructurada
 * validada por esquema. Incluye el respaldo automático del servidor
 * (`fallbacks: "default"`) para que una negativa por política no deje el
 * análisis sin resultado.
 */
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { z } from "zod";
import { env } from "../../env";
import type { JsonRequest, LlmProvider } from "./types";

type Effort = "low" | "medium" | "high" | "xhigh" | "max";

export function anthropicProvider(): LlmProvider {
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, maxRetries: 3, timeout: 15 * 60_000 });
  const model = env.LLM_MODEL || "claude-opus-5-5";
  const effort = (["low", "medium", "high", "xhigh", "max"].includes(env.LLM_EFFORT) ? env.LLM_EFFORT : "high") as Effort;
  return {
    id: "anthropic",
    model,
    async generateJson<T extends z.ZodType>(req: JsonRequest<T>): Promise<z.infer<T>> {
      let response;
      try {
        response = await client.beta.messages.parse(
          {
            model,
            max_tokens: 32000,
            betas: ["server-side-fallback-2026-07-01"],
            fallbacks: "default",
            system: req.system,
            output_config: { effort, format: betaZodOutputFormat(req.schema) },
            messages: [{ role: "user", content: req.user }],
          },
          { signal: req.signal },
        );
      } catch (err) {
        if (err instanceof Anthropic.AuthenticationError) throw new Error("La clave ANTHROPIC_API_KEY no es válida.");
        if (err instanceof Anthropic.PermissionDeniedError) throw new Error("La cuenta de Anthropic no tiene permiso para este modelo o no tiene saldo.");
        if (err instanceof Anthropic.RateLimitError) throw new Error("Límite de uso de la API de Anthropic alcanzado. Reintenta en unos minutos.");
        if (err instanceof Anthropic.BadRequestError) throw new Error(`Anthropic rechazó la petición: ${err.message}`);
        if (err instanceof Anthropic.APIError) throw new Error(`Error de la API de Anthropic (${err.status}): ${err.message}`);
        throw err;
      }
      if (response.stop_reason === "refusal") throw new Error("El modelo de IA rechazó analizar este contenido.");
      if (response.stop_reason === "max_tokens") throw new Error("La respuesta de la IA se cortó por longitud. Reduce el número de clips o divide el video.");
      if (!response.parsed_output) throw new Error("La IA devolvió una respuesta que no cumple el formato esperado.");
      return response.parsed_output as z.infer<T>;
    },
  };
}
