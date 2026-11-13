// Tipos compartidos cliente/servidor.

export type TagId =
  | "viral_7d"
  | "viral_month"
  | "unique_format_es"
  | "faceless"
  | "faceless_ai"
  | "emerging_niche";

export const TAG_LABELS: Record<TagId, string> = {
  viral_7d: "Viral hace 7 días",
  viral_month: "Viral este mes",
  unique_format_es: "Formato único en español",
  faceless: "Faceless",
  faceless_ai: "Faceless con IA",
  emerging_niche: "Nicho emergente",
};

export interface OpportunityTag {
  id: TagId;
  label: string;
  /** Justificación con datos (o indicación de que proviene de análisis IA). */
  evidence: string;
  source: "youtube_data" | "ai_analysis";
}

export interface VideoInfo {
  id: string;
  title: string;
  description?: string;
  thumbnailUrl: string;
  publishedAt: string;
  viewCount: number | null;
  likeCount: number | null;
  commentCount: number | null;
  durationSec: number | null;
  defaultAudioLanguage?: string | null;
  tags?: string[];
}

export interface ChannelInfo {
  id: string;
  title: string;
  description: string;
  customUrl: string | null;
  thumbnailUrl: string;
  country: string | null;
  defaultLanguage: string | null;
  publishedAt: string;
  subscriberCount: number | null;
  subscribersHidden: boolean;
  viewCount: number;
  videoCount: number;
  uploadsPlaylistId: string | null;
}

export interface ScoreBreakdown {
  total: number;
  components: { key: string; label: string; points: number; max: number; value: string }[];
}

export interface RevenueEstimate {
  lowUsd: number;
  highUsd: number;
  views30d: number;
  rpmLow: number;
  rpmHigh: number;
  assumptions: string[];
  monetizationEligible: boolean | "unknown";
}

export interface ChannelResult {
  rank: number;
  channel: ChannelInfo;
  score: ScoreBreakdown;
  niche: string;
  language: string;
  languageSource: "channel_metadata" | "video_metadata" | "title_detection";
  tags: OpportunityTag[];
  featuredVideos: VideoInfo[];
  revenue: RevenueEstimate;
  channelUrl: string;
}

export interface ProgressEvent {
  type: "step";
  step: number;
  status: "running" | "done" | "error";
  label: string;
  detail?: string;
}

export interface SearchDoneEvent {
  type: "done";
  searchId: string;
  results: ChannelResult[];
  quotaUsed: number;
  note?: string;
}

export interface ErrorEvent {
  type: "error";
  message: string;
  missing?: MissingCredential[];
}

export type StreamEvent = ProgressEvent | SearchDoneEvent | ErrorEvent | { type: string; [k: string]: unknown };

export interface MissingCredential {
  env: string;
  service: string;
  howTo: string;
}

export interface ConfigStatus {
  youtube: boolean;
  ai: boolean;
  images: boolean;
  voice: boolean;
  database: boolean;
  missing: MissingCredential[];
  quota: { usedToday: number; dailyLimit: number; searchesLeftEstimate: number; costPerRecentSearch: number };
}

export interface NicheSearchParams {
  topic: string;
  language: string; // ISO 639-1, "" = cualquiera
  country: string; // ISO 3166-1 alpha-2, "" = cualquiera
  publishedAfter: string; // YYYY-MM-DD
  publishedBefore: string; // YYYY-MM-DD
}
