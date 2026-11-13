// Puntuación, etiquetas e ingresos estimados a partir de métricas verificables.
import type { ChannelInfo, OpportunityTag, RevenueEstimate, ScoreBreakdown, VideoInfo } from "../../shared/types";
import { TAG_LABELS } from "../../shared/types";

const DAY = 86400_000;
export const daysSince = (iso: string, now = Date.now()) => Math.max(0, (now - new Date(iso).getTime()) / DAY);
const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));
const fmt = (n: number) => new Intl.NumberFormat("es-ES").format(Math.round(n));

export function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export interface ChannelMetrics {
  subs: number | null;
  ageDays: number;
  bestRecent: VideoInfo | null; // mejor vídeo de los últimos 30 días
  bestRecentViews: number;
  bestRecentViewsPerDay: number;
  views30d: number;
  uploads30d: number;
  medianViewsRecent: number; // mediana de las últimas subidas analizadas
  outlierRatio: number; // mejor vídeo reciente / suscriptores
}

export function computeMetrics(ch: ChannelInfo, videos: VideoInfo[], now = Date.now()): ChannelMetrics {
  const recent = videos.filter((v) => daysSince(v.publishedAt, now) <= 30);
  const bestRecent = recent.reduce<VideoInfo | null>((b, v) => ((v.viewCount ?? 0) > (b?.viewCount ?? -1) ? v : b), null);
  const bestRecentViews = bestRecent?.viewCount ?? 0;
  const age = bestRecent ? Math.max(1, daysSince(bestRecent.publishedAt, now)) : 1;
  const subs = ch.subscriberCount;
  return {
    subs,
    ageDays: daysSince(ch.publishedAt, now),
    bestRecent,
    bestRecentViews,
    bestRecentViewsPerDay: bestRecentViews / age,
    views30d: recent.reduce((s, v) => s + (v.viewCount ?? 0), 0),
    uploads30d: recent.length,
    medianViewsRecent: median(videos.slice(0, 15).map((v) => v.viewCount ?? 0)),
    outlierRatio: subs && subs > 0 ? bestRecentViews / subs : bestRecentViews > 0 ? Infinity : 0,
  };
}

/**
 * Puntuación ViralHunter (0–100). Fórmula pública:
 *  - Ratio vistas/suscriptores del mejor vídeo de 30 días (30 pts, log10: 1x=0 … 100x=30)
 *  - Velocidad: vistas/día del mejor vídeo reciente (25 pts, log10: 1k/día=8 … 100k/día=25)
 *  - Juventud del canal (15 pts: <90 días=15, lineal hasta 0 a los 3 años)
 *  - Tamaño pequeño (15 pts: <1k subs=15, log hasta 0 en 1M)
 *  - Consistencia: mediana de vistas recientes / suscriptores (15 pts, log10: 0.1x=0 … 10x=15)
 */
export function scoreChannel(ch: ChannelInfo, m: ChannelMetrics): ScoreBreakdown {
  const subs = m.subs ?? 0;
  const ratio = subs > 0 ? m.bestRecentViews / subs : m.bestRecentViews > 0 ? 100 : 0;
  const ratioPts = ratio <= 1 ? 0 : clamp((Math.log10(ratio) / 2) * 30, 0, 30);
  const velPts = m.bestRecentViewsPerDay <= 100 ? 0 : clamp(((Math.log10(m.bestRecentViewsPerDay) - 2) / 3) * 25, 0, 25);
  const youthPts = m.ageDays <= 90 ? 15 : clamp(15 * (1 - (m.ageDays - 90) / (1095 - 90)), 0, 15);
  const sizePts = m.subs === null ? 7 : subs <= 1000 ? 15 : clamp(15 * (1 - (Math.log10(subs) - 3) / 3), 0, 15);
  const cons = subs > 0 ? m.medianViewsRecent / subs : 0;
  const consPts = cons <= 0.1 ? 0 : clamp(((Math.log10(cons) + 1) / 2) * 15, 0, 15);
  const components = [
    { key: "ratio", label: "Vistas / suscriptores (mejor vídeo 30 días)", points: ratioPts, max: 30, value: subs > 0 ? `${ratio.toFixed(1)}x` : "subs ocultos" },
    { key: "velocity", label: "Velocidad (vistas/día)", points: velPts, max: 25, value: fmt(m.bestRecentViewsPerDay) },
    { key: "youth", label: "Antigüedad del canal", points: youthPts, max: 15, value: `${Math.round(m.ageDays)} días` },
    { key: "size", label: "Tamaño (canal pequeño)", points: sizePts, max: 15, value: m.subs === null ? "oculto" : fmt(subs) },
    { key: "consistency", label: "Consistencia (mediana vistas / subs)", points: consPts, max: 15, value: subs > 0 ? `${cons.toFixed(2)}x` : "—" },
  ].map((c) => ({ ...c, points: Math.round(c.points * 10) / 10 }));
  return { total: Math.round(components.reduce((s, c) => s + c.points, 0)), components };
}

/** Etiquetas basadas sólo en datos de YouTube. Las de IA se añaden aparte. */
export function dataTags(m: ChannelMetrics, videos: VideoInfo[], now = Date.now()): OpportunityTag[] {
  const tags: OpportunityTag[] = [];
  const subs = m.subs ?? 0;
  const isViral = (v: VideoInfo) => (v.viewCount ?? 0) >= 20000 && (subs === 0 ? true : (v.viewCount ?? 0) >= 3 * subs);
  const v7 = videos.filter((v) => daysSince(v.publishedAt, now) <= 7 && isViral(v)).sort((a, b) => (b.viewCount ?? 0) - (a.viewCount ?? 0))[0];
  const v30 = videos.filter((v) => daysSince(v.publishedAt, now) <= 30 && isViral(v)).sort((a, b) => (b.viewCount ?? 0) - (a.viewCount ?? 0))[0];
  if (v7)
    tags.push({
      id: "viral_7d",
      label: TAG_LABELS.viral_7d,
      source: "youtube_data",
      evidence: `"${v7.title}" — ${fmt(v7.viewCount ?? 0)} vistas en ${Math.max(1, Math.round(daysSince(v7.publishedAt, now)))} días${subs ? ` (${((v7.viewCount ?? 0) / subs).toFixed(1)}x sus suscriptores)` : ""}.`,
    });
  if (v30)
    tags.push({
      id: "viral_month",
      label: TAG_LABELS.viral_month,
      source: "youtube_data",
      evidence: `"${v30.title}" — ${fmt(v30.viewCount ?? 0)} vistas en ${Math.round(daysSince(v30.publishedAt, now))} días${subs ? ` (${((v30.viewCount ?? 0) / subs).toFixed(1)}x sus suscriptores)` : ""}.`,
    });
  return tags;
}

/** Nicho emergente: canales jóvenes dominan los resultados virales del nicho en los últimos 30 días. */
export function emergingNicheEvidence(channelAgesDays: number[], medianViews: number): string | null {
  if (channelAgesDays.length < 3) return null;
  const young = channelAgesDays.filter((d) => d <= 365).length;
  const share = young / channelAgesDays.length;
  if (share >= 0.4 && medianViews >= 10000)
    return `${young} de ${channelAgesDays.length} canales con vídeos virales este mes en el nicho tienen menos de 1 año; mediana de ${fmt(medianViews)} vistas.`;
  return null;
}

/** Hipótesis de RPM (USD por 1.000 vistas, ya descontada la parte de YouTube) por idioma y nicho. */
const RPM_BY_LANG: Record<string, [number, number]> = {
  es: [0.4, 1.8],
  pt: [0.4, 1.5],
  en: [1.5, 5],
  de: [1.5, 5],
  fr: [1, 3.5],
  default: [0.5, 2.5],
};
const HIGH_RPM_NICHE = /(finanz|financ|invers|dinero|money|crypto|cripto|negocio|business|tecnolog|tech|inteligencia artificial|\bai\b|\bia\b|seguro|insurance)/i;

export function estimateRevenue(m: ChannelMetrics, language: string, niche: string, videos: VideoInfo[]): RevenueEstimate {
  const [lo, hi] = RPM_BY_LANG[language] ?? RPM_BY_LANG.default;
  const mult = HIGH_RPM_NICHE.test(niche) ? 1.8 : 1;
  const recent = videos.filter((v) => daysSince(v.publishedAt) <= 30);
  const shortsShare = recent.length ? recent.filter((v) => (v.durationSec ?? 999) <= 60).length / recent.length : 0;
  // Los Shorts tienen RPM muy inferior: se reduce proporcionalmente (hipótesis ~0.05–0.1 USD).
  const shortsAdj = 1 - shortsShare * 0.9;
  const rpmLow = Math.round(lo * mult * shortsAdj * 100) / 100;
  const rpmHigh = Math.round(hi * mult * shortsAdj * 100) / 100;
  const eligible = m.subs === null ? "unknown" : m.subs >= 1000;
  const assumptions = [
    `Vistas base: ${fmt(m.views30d)} = suma de vistas actuales de los vídeos publicados en los últimos 30 días (dato de YouTube).`,
    `RPM supuesto ${rpmLow}–${rpmHigh} USD por 1.000 vistas (idioma "${language}"${mult > 1 ? ", nicho de RPM alto" : ""}${shortsShare > 0 ? `, ${Math.round(shortsShare * 100)}% Shorts` : ""}).`,
    "Hipótesis propia de ViralHunter, no es una cifra oficial: los ingresos reales sólo los conoce el creador.",
    eligible === false
      ? "El canal tiene menos de 1.000 suscriptores: probablemente aún no está en el Programa de Socios (ingreso real ≈ 0)."
      : "Supone que el canal está monetizado en el Programa de Socios de YouTube.",
  ];
  return {
    lowUsd: Math.round((m.views30d / 1000) * rpmLow),
    highUsd: Math.round((m.views30d / 1000) * rpmHigh),
    views30d: m.views30d,
    rpmLow,
    rpmHigh,
    assumptions,
    monetizationEligible: eligible,
  };
}

const STOP: Record<string, string[]> = {
  es: ["el", "la", "los", "las", "de", "que", "y", "en", "un", "una", "por", "con", "para", "es", "no", "lo", "como", "más", "pero", "sus", "le", "ya", "este", "esta", "porque", "cuando", "muy", "sin", "sobre", "también", "fue", "hay", "así", "qué", "cómo", "nunca", "historia"],
  en: ["the", "and", "of", "to", "in", "is", "you", "that", "it", "for", "with", "on", "this", "was", "are", "how", "what", "why", "my", "your", "i", "be", "from", "never", "story", "who"],
  pt: ["o", "a", "os", "as", "de", "que", "e", "do", "da", "em", "um", "uma", "para", "com", "não", "por", "mais", "como", "você", "isso"],
  fr: ["le", "la", "les", "de", "des", "et", "un", "une", "est", "que", "qui", "pour", "dans", "pas", "sur", "avec", "vous"],
  de: ["der", "die", "das", "und", "ist", "nicht", "ein", "eine", "zu", "mit", "den", "von", "ich", "du", "wie"],
};

/** Detección de idioma por palabras vacías en títulos (sólo si YouTube no lo declara). */
export function detectLanguage(texts: string[]): string | null {
  const words = texts.join(" ").toLowerCase().split(/[^a-záéíóúñüçãõâêôàèìòùäöß']+/).filter(Boolean);
  if (words.length < 5) return null;
  let best: string | null = null;
  let bestScore = 0;
  for (const [lang, sw] of Object.entries(STOP)) {
    const set = new Set(sw);
    const hits = words.filter((w) => set.has(w)).length / words.length;
    if (hits > bestScore) {
      bestScore = hits;
      best = lang;
    }
  }
  return bestScore >= 0.04 ? best : null;
}

export const LANGUAGE_NAMES: Record<string, string> = {
  es: "Español", en: "Inglés", pt: "Portugués", fr: "Francés", de: "Alemán", it: "Italiano", ja: "Japonés", ko: "Coreano", hi: "Hindi", ru: "Ruso", ar: "Árabe", tr: "Turco", id: "Indonesio",
};
