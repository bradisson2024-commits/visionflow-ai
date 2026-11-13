// IA de análisis (Claude). Todo resultado de aquí se marca como "análisis IA" en la interfaz.
import { z } from "zod";
import { generateJson, type Img } from "./llm";

const structured = generateJson;

const SYSTEM_ANALYST =
  "Eres un analista experto en estrategia de contenido de YouTube. Basas tus conclusiones sólo en el material que se te muestra " +
  "(miniaturas, títulos, descripciones y estadísticas reales). Si algo no se puede saber con el material, dilo. Responde en español.";

// ---------- Clasificación de canales en la búsqueda ----------
export const ChannelClassification = z.object({
  channels: z.array(
    z.object({
      channelId: z.string(),
      faceless: z.boolean().describe("true si ninguna miniatura muestra la cara real del creador/presentador"),
      facelessEvidence: z.string(),
      aiGeneratedVisuals: z.boolean().describe("true sólo si las imágenes muestran rasgos claros de generación por IA"),
      aiEvidence: z.string(),
      format: z.string().describe("Formato de contenido en una frase"),
      nicheLabel: z.string().describe("Nicho concreto en español, 2-4 palabras"),
      spanishSearchQuery: z
        .string()
        .describe("Consulta de búsqueda en español (3-6 palabras) para encontrar vídeos con este mismo formato en español"),
    }),
  ),
});
export type ChannelClassificationT = z.infer<typeof ChannelClassification>;

export async function classifyChannels(
  items: { channelId: string; title: string; description: string; videos: { title: string; thumbnailUrl: string }[] }[],
): Promise<ChannelClassificationT> {
  const images: Img[] = [];
  const lines: string[] = [];
  for (const it of items) {
    lines.push(`Canal ${it.channelId} — "${it.title}". Descripción: ${it.description.slice(0, 300) || "(vacía)"}`);
    it.videos.slice(0, 3).forEach((v, i) => {
      lines.push(`   vídeo ${i + 1}: ${v.title}`);
      images.push({ url: v.thumbnailUrl, label: `Miniatura ${i + 1} del canal ${it.channelId}:` });
    });
  }
  return structured({
    schema: ChannelClassification,
    system: SYSTEM_ANALYST,
    effort: "low",
    images,
    prompt:
      "Clasifica cada canal. Devuelve un elemento por canal con su channelId exacto.\n" +
      "faceless=true sólo si en ninguna miniatura aparece una persona real hablando a cámara/presentador.\n" +
      "aiGeneratedVisuals=true sólo si las ilustraciones o imágenes parecen claramente generadas por IA (estética típica, artefactos).\n\n" +
      lines.join("\n"),
  });
}

// ---------- ReplicaPro · Etapa 1: formatos ----------
export const FormatAnalysis = z.object({
  formats: z.array(z.object({ name: z.string(), description: z.string(), share: z.string(), exampleTitles: z.array(z.string()) })),
  titlePatterns: z.array(z.string()),
  audience: z.string(),
  summary: z.string(),
});
export type FormatAnalysisT = z.infer<typeof FormatAnalysis>;
export async function analyzeFormats(input: { channel: string; videos: { title: string; views: number | null; durationSec: number | null; publishedAt: string }[] }) {
  return structured({
    schema: FormatAnalysis,
    system: SYSTEM_ANALYST,
    effort: "medium",
    prompt:
      `Canal: ${input.channel}\nVídeos (título | vistas | duración s | fecha):\n` +
      input.videos.map((v) => `- ${v.title} | ${v.views ?? "?"} | ${v.durationSec ?? "?"} | ${v.publishedAt.slice(0, 10)}`).join("\n") +
      "\n\nIdentifica los formatos de contenido recurrentes, los patrones de títulos que funcionan mejor y el público objetivo.",
  });
}

// ---------- ReplicaPro · Etapa 2: estilo ----------
export const StyleAnalysis = z.object({
  narrativeStyle: z.string(),
  tone: z.string(),
  voiceType: z.string().describe("Tipo de voz probable (género, edad, timbre, ritmo). Indica que es una inferencia."),
  visualStyle: z.string(),
  colors: z.array(z.object({ hex: z.string(), name: z.string() })),
  composition: z.string(),
  illustrations: z.string(),
  characters: z.string(),
  rhythm: z.string(),
  hasRecurringCharacter: z.boolean(),
  imagePromptBase: z
    .string()
    .describe("Prompt en inglés para generar imágenes ORIGINALES con una estética similar, sin copiar personajes, logotipos ni marcas"),
  limitations: z.string().describe("Qué no se puede inferir sólo con miniaturas/títulos"),
});
export type StyleAnalysisT = z.infer<typeof StyleAnalysis>;
export async function analyzeStyle(input: { channel: string; description: string; videos: { title: string; description?: string; thumbnailUrl: string; durationSec: number | null; views: number | null }[] }) {
  return structured({
    schema: StyleAnalysis,
    system: SYSTEM_ANALYST,
    effort: "medium",
    images: input.videos.slice(0, 8).map((v, i) => ({ url: v.thumbnailUrl, label: `Miniatura ${i + 1}: "${v.title}" (${v.views ?? "?"} vistas, ${v.durationSec ?? "?"} s)` })),
    prompt:
      `Canal: ${input.channel}\nDescripción: ${input.description.slice(0, 800)}\n` +
      `Descripciones de vídeos:\n${input.videos.slice(0, 8).map((v) => `- ${v.title}: ${(v.description ?? "").slice(0, 250).replace(/\s+/g, " ")}`).join("\n")}\n\n` +
      "Analiza estilo narrativo, tono, tipo de voz, estilo visual, paleta de colores (hex), composición, ilustraciones, personajes y ritmo. " +
      "El ritmo y la voz se deducen de duraciones, títulos y descripciones: marca claramente que son inferencias.",
  });
}

// ---------- ReplicaPro · Etapa 3: branding ----------
export const BrandingProposals = z.object({
  proposals: z.array(
    z.object({
      name: z.string(),
      handle: z.string().describe("Handle sugerido sin @, sólo letras/números"),
      tagline: z.string(),
      description: z.string().describe("Descripción del canal para YouTube, 400-700 caracteres"),
      palette: z.array(z.object({ hex: z.string(), role: z.string() })),
      typography: z.string(),
      visualIdentity: z.string(),
      logoPrompt: z.string().describe("Prompt en inglés para el logo (icono, sin texto ilegible, fondo plano)"),
      bannerPrompt: z.string().describe("Prompt en inglés para el banner 16:9 de YouTube, zona central segura"),
    }),
  ),
});
export type BrandingProposalsT = z.infer<typeof BrandingProposals>;
export async function generateBranding(input: { sourceChannel: string; niche: string; language: string; style: unknown; character: string | null }) {
  return structured({
    schema: BrandingProposals,
    system: "Eres director creativo de marcas para YouTube. Creas marcas originales que no imitan nombres, logos ni marcas registradas existentes. Responde en español.",
    effort: "medium",
    prompt:
      `Canal de referencia (sólo inspiración, no copiar su nombre): ${input.sourceChannel}\nNicho: ${input.niche}\nIdioma del nuevo canal: ${input.language}\n` +
      `Estilo aprobado: ${JSON.stringify(input.style)}\nPersonaje: ${input.character ?? "sin personaje"}\n\n` +
      "Crea 3 propuestas de marca distintas entre sí y coherentes con el estilo aprobado.",
  });
}

// ---------- ReplicaPro · Etapa 4: vídeos ----------
const VideoIdea = z.object({
  title: z.string(),
  idea: z.string(),
  hook: z.string().describe("Gancho de los primeros 5-10 segundos, texto literal a narrar"),
  structure: z.array(z.object({ section: z.string(), seconds: z.number(), content: z.string() })),
  durationMinutes: z.number(),
  visualStyle: z.string(),
  thumbnailIdea: z.string(),
  thumbnailPrompt: z.string().describe("Prompt en inglés para generar la miniatura"),
  inspiredBy: z.string().describe("Qué vídeo de referencia inspira la idea y en qué se diferencia"),
});
const VideoIdeas = z.object({
  referenceInsights: z.array(z.string()).describe("Qué hace funcionar a los vídeos de referencia, según sus datos"),
  proposals: z.array(VideoIdea),
});
const Script = z.object({ script: z.string().describe("Guion completo para narración, de principio a fin") });

export type VideoProposalsT = { referenceInsights: string[]; proposals: (z.infer<typeof VideoIdea> & { script: string })[] };

const SYSTEM_WRITER =
  "Eres guionista jefe de canales de YouTube. Escribes ideas y guiones 100% originales: nunca copias títulos, frases ni guiones de los vídeos de referencia; " +
  "sólo extraes patrones (temas, estructura, ganchos). Escribe en el idioma indicado.";

export async function generateVideoIdeas(input: {
  brand: unknown;
  style: unknown;
  language: string;
  count: number;
  references: { title: string; views: number | null; durationSec: number | null; description?: string; publishedAt: string }[];
}): Promise<VideoProposalsT> {
  // Paso 1: ideas, ganchos y estructura a partir de los datos reales de las referencias.
  const ideas = await structured({
    schema: VideoIdeas,
    system: SYSTEM_WRITER,
    effort: "medium",
    prompt:
      `Idioma: ${input.language}\nMarca: ${JSON.stringify(input.brand)}\nEstilo aprobado: ${JSON.stringify(input.style)}\n\n` +
      `Vídeos de referencia con más vistas (datos reales de YouTube):\n` +
      input.references
        .map((r) => `- "${r.title}" | ${r.views ?? "?"} vistas | ${r.durationSec ?? "?"} s | ${r.publishedAt.slice(0, 10)} | ${(r.description ?? "").slice(0, 200).replace(/\s+/g, " ")}`)
        .join("\n") +
      `\n\nGenera exactamente ${input.count} propuestas de vídeo originales (sin guion todavía).`,
  });
  // Paso 2: guion completo de cada propuesta.
  const proposals: VideoProposalsT["proposals"] = [];
  for (const idea of ideas.proposals.slice(0, input.count)) {
    const { script } = await structured({
      schema: Script,
      system: SYSTEM_WRITER,
      effort: "medium",
      maxTokens: 16000,
      prompt:
        `Idioma: ${input.language}\nMarca: ${JSON.stringify(input.brand)}\nPropuesta: ${JSON.stringify(idea)}\n\n` +
        `Escribe el guion completo y original de narración para un vídeo de unos ${idea.durationMinutes} minutos, empezando por el gancho y siguiendo la estructura.`,
    });
    proposals.push({ ...idea, script });
  }
  return { referenceInsights: ideas.referenceInsights, proposals };
}
