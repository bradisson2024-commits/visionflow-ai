import type { TranscriptSegment, TranscriptWord } from "../../db/schema";

export type TranscriptionResult = {
  provider: string;
  model: string;
  language: string | null;
  text: string;
  segments: TranscriptSegment[];
  words: TranscriptWord[];
  /** true si los tiempos por palabra son estimados (proveedor local). */
  estimatedWordTimes?: boolean;
};

export type TranscribeInput = {
  /** Trozos de audio en orden, con su desplazamiento en segundos dentro del video. */
  chunks: { file: string; offsetSec: number; mime: string }[];
  /** WAV 16 kHz mono del audio completo (para el proveedor local). */
  wav16k: string;
  language?: string; // ISO-639-1 o "auto"
  signal?: AbortSignal;
  onProgress?: (pct: number) => void | Promise<void>;
};

export class ProviderConfigError extends Error {}
