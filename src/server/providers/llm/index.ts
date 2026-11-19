import { env } from "../../env";
import { llmStatus } from "../status";
import { ProviderConfigError } from "../transcription/types";
import { anthropicProvider } from "./anthropic";
import { openAICompatibleProvider } from "./openai";
import type { LlmProvider } from "./types";

export function getLlm(): LlmProvider {
  const st = llmStatus();
  if (!st.ready) throw new ProviderConfigError(`IA de análisis no configurada (${st.provider}). Falta: ${st.missing.join(", ")}. Configúralo en el archivo .env del servidor.`);
  switch (env.LLM_PROVIDER) {
    case "anthropic":
      return anthropicProvider();
    case "openai":
      return openAICompatibleProvider({ id: "openai", baseUrl: "https://api.openai.com/v1", apiKey: env.OPENAI_API_KEY, model: env.LLM_MODEL });
    case "openai_compatible":
      return openAICompatibleProvider({ id: "openai_compatible", baseUrl: env.LLM_BASE_URL, apiKey: env.LLM_API_KEY, model: env.LLM_MODEL });
    default:
      throw new ProviderConfigError(`Proveedor de IA desconocido: ${env.LLM_PROVIDER}`);
  }
}
