// Métricas y clasificaciones del Radar. Todo se calcula con datos públicos de la API y con capturas sucesivas
// guardadas por la aplicación. Cada etiqueta lleva su explicación con las cifras usadas.
import { sql } from '../db/index.js';

export const DEFAULT_THRESHOLDS = {
  maxAgeViralDays: 30,          // un vídeo más antiguo nunca se etiqueta como viral reciente
  despegando: { maxAgeHours: 72, minViewsPerHour: 300, minOutperformance: 2 },
  acelerado: { minAcceleration: 1.5, minViewsPerHour: 200 },
  viral: { minViews: 100000, minOutperformance: 3 },
  extraordinario: { minViews: 1000000, minOutperformance: 10 },
  canalPequeno: { maxSubscribers: 10000, minViewsPerSub: 20, minViews: 50000 },
  excepcional: { minOutperformance: 5, maxAgeDays: 90 },
  tendencia: { minVideos: 3, minChannels: 3, maxAgeDays: 14, minOutperformance: 2 },
};

export const CATEGORY_LABELS = {
  despegando: 'Despegando', acelerado: 'Crecimiento acelerado', viral: 'Viral', extraordinario: 'Viral extraordinario',
  canal_pequeno: 'Canal pequeño con vídeo gigante', excepcional: 'Vídeo con rendimiento excepcional', tendencia: 'Tendencia emergente',
};

export const mergeThresholds = (t = {}) => {
  const out = structuredClone(DEFAULT_THRESHOLDS);
  for (const [k, v] of Object.entries(t || {})) out[k] = typeof v === 'object' && v ? { ...out[k], ...v } : v;
  return out;
};

const median = (a) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const fmt = (n) => Math.round(n).toLocaleString('es');

/** Velocidad medida con capturas: vistas/hora entre las dos últimas y entre la penúltima y la anterior. */
export async function measuredVelocity(videoId, publishedAt) {
  const snaps = await sql`select taken_at, views from yt_video_snapshots where video_id = ${videoId} and views is not null order by taken_at desc limit 3`;
  const ageH = Math.max(1, (Date.now() - Date.parse(publishedAt)) / 3600e3);
  const avg = snaps[0] ? Number(snaps[0].views) / ageH : null;
  const rate = (a, b) => { const h = (a.taken_at - b.taken_at) / 3600e3; return h >= 0.25 ? (Number(a.views) - Number(b.views)) / h : null; };
  const last = snaps.length >= 2 ? rate(snaps[0], snaps[1]) : null;
  const prev = snaps.length >= 3 ? rate(snaps[1], snaps[2]) : null;
  return { averageSincePublish: avg, measured: last, previous: prev, snapshots: snaps.length, hoursBetween: snaps.length >= 2 ? +((snaps[0].taken_at - snaps[1].taken_at) / 3600e3).toFixed(2) : null };
}

/** Perfil del canal a partir de sus subidas recientes (para comparar el vídeo con lo habitual del canal). */
export function channelProfile(channel, recent) {
  const now = Date.now();
  const others = recent.filter((v) => v.views != null);
  const med = median(others.map((v) => Number(v.views)));
  const last90 = recent.filter((v) => now - Date.parse(v.published_at) <= 90 * 86400e3);
  const dates = recent.map((v) => Date.parse(v.published_at)).sort((a, b) => b - a);
  const spanDays = dates.length >= 2 ? (dates[0] - dates[dates.length - 1]) / 86400e3 : null;
  return {
    medianViews: med,
    uploadsPerWeek: spanDays ? +((dates.length - 1) / (spanDays / 7)).toFixed(2) : null,
    uploadsLast90: last90.length,
    successfulVideos: med ? others.filter((v) => Number(v.views) >= 3 * med).length : 0,
    sample: others.length,
    ageDays: channel.created_at_yt ? Math.floor((now - Date.parse(channel.created_at_yt)) / 86400e3) : null,
  };
}

/**
 * Clasifica un vídeo. `ctx`: { channel, profile, velocity, thresholds }.
 * Devuelve categorías, puntuación 0–100 y explicación (cada afirmación con su dato).
 */
export function classifyVideo(v, ctx) {
  const T = ctx.thresholds;
  const views = Number(v.views || 0);
  const ageH = Math.max(1, (Date.now() - Date.parse(v.published_at)) / 3600e3);
  const ageD = ageH / 24;
  const subs = ctx.channel?.subscribers ?? null;
  const med = ctx.profile?.medianViews;
  const out = med ? views / Math.max(1, med) : null;
  const vel = ctx.velocity || {};
  const vph = vel.measured ?? vel.averageSincePublish ?? views / ageH;
  const cats = [], why = [];
  why.push(`Publicado hace ${ageD < 2 ? `${Math.round(ageH)} horas` : `${Math.round(ageD)} días`}: ${fmt(views)} visualizaciones.`);
  if (vel.measured != null) why.push(`Velocidad medida entre capturas: ${fmt(vel.measured)} vistas/hora (en ${vel.hoursBetween} h).`);
  else why.push(`Velocidad media desde la publicación: ${fmt(views / ageH)} vistas/hora (aún sin dos capturas para medir la velocidad actual).`);
  if (out != null) why.push(`Rinde ${out.toFixed(1)}× la mediana del canal (${fmt(med)} vistas en sus ${ctx.profile.sample} subidas recientes).`);
  if (subs) why.push(`Relación vistas/suscriptores: ${(views / subs).toFixed(1)} (${fmt(subs)} suscriptores).`);
  else if (ctx.channel?.subscribers_hidden) why.push('El canal oculta sus suscriptores.');

  const recentOk = ageD <= T.maxAgeViralDays;
  if (!recentOk) why.push(`No se etiqueta como viral: tiene ${Math.round(ageD)} días (límite ${T.maxAgeViralDays}).`);
  if (recentOk && ageH <= T.despegando.maxAgeHours && vph >= T.despegando.minViewsPerHour && (out == null || out >= T.despegando.minOutperformance)) cats.push('despegando');
  if (vel.measured != null && vel.previous != null && vel.previous > 0 && vel.measured / vel.previous >= T.acelerado.minAcceleration && vel.measured >= T.acelerado.minViewsPerHour) {
    cats.push('acelerado'); why.push(`Acelera: ${fmt(vel.previous)} → ${fmt(vel.measured)} vistas/hora entre capturas.`);
  }
  if (recentOk && views >= T.extraordinario.minViews && out != null && out >= T.extraordinario.minOutperformance) cats.push('extraordinario');
  else if (recentOk && views >= T.viral.minViews && out != null && out >= T.viral.minOutperformance) cats.push('viral');
  if (subs && subs <= T.canalPequeno.maxSubscribers && views >= T.canalPequeno.minViews && views / subs >= T.canalPequeno.minViewsPerSub) cats.push('canal_pequeno');
  if (out != null && out >= T.excepcional.minOutperformance && ageD <= T.excepcional.maxAgeDays) cats.push('excepcional');

  const clamp = (x) => Math.max(0, Math.min(1, x));
  const score = Math.round(
    35 * clamp(Math.log10(Math.max(1, vph)) / 4) +
    30 * clamp((out ?? 1) / 20) +
    20 * clamp(subs ? views / subs / 50 : 0.3) +
    15 * clamp(1 - ageD / Math.max(1, T.maxAgeViralDays)),
  );
  return { categories: cats, score, explanation: why, metrics: { views, ageHours: Math.round(ageH), viewsPerHour: Math.round(vph), velocityMeasured: vel.measured != null, outperformance: out != null ? +out.toFixed(2) : null, viewsPerSub: subs ? +(views / subs).toFixed(2) : null } };
}

const STOP = new Set('de la el los las y en un una que por para con del al se su sus lo como más mas es son the of and to in a is for on with how why what this that you your i my it from are was por qué que cómo como'.split(' '));
/** Tendencia emergente: términos que comparten varios vídeos recientes de canales distintos que rinden por encima de lo normal. */
export function emergingTrends(items, T) {
  const q = items.filter((x) => x.metrics.ageHours / 24 <= T.tendencia.maxAgeDays && (x.metrics.outperformance ?? 0) >= T.tendencia.minOutperformance);
  const byTerm = new Map();
  for (const x of q) {
    const terms = new Set(String(x.video.title).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').split(/[^a-z0-9ñ]+/).filter((w) => w.length > 3 && !STOP.has(w)));
    for (const t of terms) { if (!byTerm.has(t)) byTerm.set(t, []); byTerm.get(t).push(x); }
  }
  const trends = [];
  for (const [term, list] of byTerm) {
    const chans = new Set(list.map((x) => x.video.channel_id));
    if (list.length >= T.tendencia.minVideos && chans.size >= T.tendencia.minChannels) trends.push({ term, videos: list.map((x) => x.video.id), channels: chans.size });
  }
  return trends.sort((a, b) => b.videos.length - a.videos.length).slice(0, 10);
}

export { median };
