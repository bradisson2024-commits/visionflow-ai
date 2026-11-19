import { env } from "../../env";
import { transcriptionStatus } from "../status";
import { transcribeDeepgram } from "./deepgram";
import { transcribeLocal } from "./local";
import { transcribeOpenAICompatible } from "./openai-compatible";
import { ProviderConfigError, type TranscribeInput, type TranscriptionResult } from "./types";

export { ProviderConfigError };

/** Transcribe con el proveedor configurado. Lanza un error claro si falta configuración. */
export async function transcribe(input: TranscribeInput): Promise<TranscriptionResult> {
  const st = transcriptionStatus();
  if (!st.ready) throw new ProviderConfigError(`Transcripción no configurada (${st.provider}). Falta: ${st.missing.join(", ")}. Configúralo en el archivo .env del servidor.`);
  switch (env.TRANSCRIPTION_PROVIDER) {
    case "openai":
      return transcribeOpenAICompatible(input, { provider: "openai", baseUrl: "https://api.openai.com/v1", apiKey: env.OPENAI_API_KEY, model: "whisper-1" });
    case "groq":
      return transcribeOpenAICompatible(input, { provider: "groq", baseUrl: "https://api.groq.com/openai/v1", apiKey: env.GROQ_API_KEY, model: "whisper-large-v3" });
    case "deepgram":
      return transcribeDeepgram(input, env.DEEPGRAM_API_KEY);
    case "local":
      return transcribeLocal(input);
    default:
      throw new ProviderConfigError(`Proveedor de transcripción desconocido: ${env.TRANSCRIPTION_PROVIDER}`);
  }
}
