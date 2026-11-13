// Motor de descubrimiento de canales ganadores. Cada paso de progreso corresponde a una operación real.
import type { ChannelInfo, ChannelResult, NicheSearchParams, OpportunityTag, ProgressEvent, VideoInfo } from "../../shared/types";
import { TAG_LABELS } from "../../shared/types";
import { env, missing, aiCredKeys, aiProvider } from "../env";
import { aiHasVision } from "./llm";
import { sql } from "../db";
import * as yt from "./youtube";
import { classifyChannels, type ChannelClassificationT } from "./ai";
import { nichesOfTheDay } from "./niches";
import {
  computeMetrics, dataTags, daysSince, detectLanguage, emergingNicheEvidence, estimateRevenue, median, scoreChannel, LANGUAGE_NAMES,
} from "./scoring";

export const STEP_LABELS = [
  "Eligiendo los nichos del día",
  "Buscando virales de esta semana y de este mes",
  "Generando lista de nichos",
  "Descubriendo canales con pocas suscripciones y muchas visualizaciones",
  "Buscando formatos y estrategias que todavía no están replicados en español",
  "Analizando vídeos y rendimiento",
  "Clasificando canales",
  "Preparando resultados",
  "Listo",
];

export type Emit = (e: ProgressEvent) => void;

const isoDaysAgo = (d: number) => new Date(Date.now() - d * 86400_000).toISOString();
const MAX_SUBS = 100_000; // "pocas suscripciones"
const MIN_VIEWS = 10_000;
const MAX_DEEP = 20; // canales analizados en profundidad
const RESULTS = 10;

interface Query {
  niche: string;
  q: string;
  lang: string;
  window: "7d" | "30d" | "custom";
  publishedAfter: string;
  publishedBefore?: string;
  regionCode?: string;
  order?: "viewCount" | "relevance";
}

interface Hit {
  video: VideoInfo;
  channelId: string;
  niche: string;
  queryLang: string;
}

const normLang = (l?: string | null) => (l ? l.toLowerCase().split(/[-_]/)[0] : null);

function resolveLanguage(ch: ChannelInfo, videos: VideoInfo[]): { lang: string; source: ChannelResult["languageSource"] } {
  const cl = normLang(ch.defaultLanguage);
  if (cl) return { lang: cl, source: "channel_metadata" };
  const counts = new Map<string, number>();
  for (const v of videos) {
    const l = normLang(v.defaultAudioLanguage);
    if (l) counts.set(l, (counts.get(l) ?? 0) + 1);
  }
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  if (top) return { lang: top[0], source: "video_metadata" };
  return { lang: detectLanguage(videos.map((v) => v.title)) ?? "desconocido", source: "title_detection" };
}

export async function runSearch(
  kind: "recent" | "niche",
  params: NicheSearchParams | null,
  emit: Emit,
): Promise<{ searchId: string; results: ChannelResult[]; quotaUsed: number; note?: string }> {
  const tracker: yt.Tracker = { units: 0 };
  const aiAvailable = missing(...aiCredKeys()).length === 0;
  const vision = aiHasVision();
  let step = 0;
  const start = (n: number, detail?: string) => {
    step = n;
    emit({ type: "step", step: n, status: "running", label: STEP_LABELS[n - 1], detail });
  };
  const done = (n: number, detail?: string) => emit({ type: "step", step: n, status: "done", label: STEP_LABELS[n - 1], detail });

  const [search] = await sql()`insert into searches (kind, params) values (${kind}, ${sql().json((params ?? {}) as any)}) returning id`;
  const searchId: string = search.id;

  try {
    // 1 · Nichos del día / nicho elegido
    start(1);
    const queries: Query[] = [];
    let nicheNames: string[];
    if (kind === "recent") {
      const niches = nichesOfTheDay();
      nicheNames = niches.map((n) => n.label);
      for (const n of niches) {
        queries.push({ niche: n.label, q: n.es, lang: "es", window: "7d", publishedAfter: isoDaysAgo(7) });
        queries.push({ niche: n.label, q: n.es, lang: "es", window: "30d", publishedAfter: isoDaysAgo(30) });
        queries.push({ niche: n.label, q: n.en, lang: "en", window: "30d", publishedAfter: isoDaysAgo(30) });
      }
    } else {
      const p = params!;
      nicheNames = [p.topic];
      const after = p.publishedAfter ? new Date(p.publishedAfter).toISOString() : isoDaysAgo(30);
      const before = p.publishedBefore ? new Date(`${p.publishedBefore}T23:59:59Z`).toISOString() : undefined;
      const base = { niche: p.topic, q: p.topic, lang: p.language || "", publishedAfter: after, publishedBefore: before, regionCode: p.country || undefined };
      queries.push({ ...base, window: "custom", order: "viewCount" });
      queries.push({ ...base, window: "custom", order: "relevance" });
      if (!p.publishedAfter) queries.push({ ...base, window: "7d", publishedAfter: isoDaysAgo(7), order: "viewCount" });
    }
    await sql()`update searches set niches = ${sql().json(nicheNames)} where id = ${searchId}`;
    done(1, nicheNames.join(" · "));

    // 2 · Búsqueda real de vídeos virales (search.list + videos.list)
    start(2, `${queries.length} búsquedas en YouTube`);
    const hits: Hit[] = [];
    const rawHits: { id: string; channelId: string; niche: string; lang: string }[] = [];
    for (const q of queries) {
      const r = await yt.searchVideos(
        { q: q.q, publishedAfter: q.publishedAfter, publishedBefore: q.publishedBefore, relevanceLanguage: q.lang || undefined, regionCode: q.regionCode, order: q.order ?? "viewCount", maxResults: 50 },
        tracker,
      );
      rawHits.push(...r.map((h) => ({ id: h.videoId, channelId: h.channelId, niche: q.niche, lang: q.lang })));
    }
    const videos = await yt.getVideos(rawHits.map((h) => h.id), tracker);
    const vMap = new Map(videos.map((v) => [v.id, v]));
    const seen = new Set<string>();
    for (const h of rawHits) {
      const v = vMap.get(h.id);
      if (!v || seen.has(h.id)) continue;
      seen.add(h.id);
      hits.push({ video: v, channelId: h.channelId, niche: h.niche, queryLang: h.lang });
    }
    const viral7 = hits.filter((h) => daysSince(h.video.publishedAt) <= 7).length;
    done(2, `${hits.length} vídeos reales (${viral7} de los últimos 7 días)`);

    // 3 · Lista de nichos con sus métricas reales
    start(3);
    const byNiche = new Map<string, Hit[]>();
    for (const h of hits) byNiche.set(h.niche, [...(byNiche.get(h.niche) ?? []), h]);
    const nicheStats = [...byNiche.entries()].map(([name, hs]) => ({
      name,
      videos: hs.length,
      medianViews: median(hs.map((h) => h.video.viewCount ?? 0)),
    }));
    done(3, nicheStats.map((n) => `${n.name}: ${n.videos} vídeos, mediana ${Math.round(n.medianViews).toLocaleString("es-ES")} vistas`).join(" · "));

    // 4 · Canales pequeños con muchas vistas (channels.list)
    start(4);
    const channelIds = [...new Set(hits.map((h) => h.channelId))];
    const channels = await yt.getChannels(channelIds, tracker);
    const chMap = new Map(channels.map((c) => [c.id, c]));
    // nicho emergente: edad de los canales con vídeos > MIN_VIEWS por nicho
    const emerging = new Map<string, string | null>();
    for (const [name, hs] of byNiche) {
      const strong = hs.filter((h) => (h.video.viewCount ?? 0) >= MIN_VIEWS);
      const ages = [...new Set(strong.map((h) => h.channelId))].map((id) => chMap.get(id)).filter(Boolean).map((c) => daysSince(c!.publishedAt));
      emerging.set(name, emergingNicheEvidence(ages, median(strong.map((h) => h.video.viewCount ?? 0))));
    }
    const candidates = channels
      .map((c) => {
        const own = hits.filter((h) => h.channelId === c.id);
        const best = own.reduce((b, h) => ((h.video.viewCount ?? 0) > (b.video.viewCount ?? 0) ? h : b), own[0]);
        const views = best?.video.viewCount ?? 0;
        const subs = c.subscriberCount;
        const ratio = subs ? views / subs : views > 0 ? 50 : 0;
        return { c, best, own, ratio, views };
      })
      .filter((x) => x.best && x.views >= MIN_VIEWS && (x.c.subscriberCount === null || x.c.subscriberCount <= MAX_SUBS) && x.ratio >= 2)
      .sort((a, b) => b.ratio - a.ratio)
      .slice(0, MAX_DEEP);
    done(4, `${channels.length} canales revisados → ${candidates.length} con ≤${MAX_SUBS.toLocaleString("es-ES")} suscriptores y ≥2x vistas/suscriptores`);

    if (!candidates.length) {
      for (let s = 5; s <= 8; s++) { start(s); done(s, "Sin candidatos que cumplan los criterios"); }
      start(9);
      await finish(searchId, tracker.units);
      done(9, "0 canales verificados");
      return { searchId, results: [], quotaUsed: tracker.units, note: "No se encontraron canales que cumplan los criterios con los datos reales de hoy." };
    }

    // 5 · Formatos no replicados en español (IA para describir el formato + búsqueda real en español)
    start(5);
    let classification: ChannelClassificationT | null = null;
    const uniqueTags = new Map<string, OpportunityTag>();
    let detail5 = "";
    if (aiAvailable) {
      classification = { channels: [] };
      for (let i = 0; i < candidates.length; i += 7) {
        const batch = candidates.slice(i, i + 7);
        const r = await classifyChannels(
          batch.map((x) => ({
            channelId: x.c.id,
            title: x.c.title,
            description: x.c.description,
            videos: x.own.slice(0, 3).map((h) => ({ title: h.video.title, thumbnailUrl: h.video.thumbnailUrl })),
          })),
        );
        classification.channels.push(...r.channels);
      }
      const nonEs = candidates.filter((x) => resolveLanguage(x.c, x.own.map((h) => h.video)).lang !== "es").slice(0, 4);
      for (const x of nonEs) {
        const cl = classification.channels.find((c) => c.channelId === x.c.id);
        if (!cl?.spanishSearchQuery) continue;
        const r = await yt.searchVideos({ q: cl.spanishSearchQuery, relevanceLanguage: "es", publishedAfter: isoDaysAgo(180), order: "viewCount", maxResults: 25 }, tracker);
        const vids = await yt.getVideos(r.map((h) => h.videoId), tracker);
        const esStrong = vids.filter((v) => (v.viewCount ?? 0) >= 50_000 && (normLang(v.defaultAudioLanguage) === "es" || detectLanguage([v.title, v.description ?? ""]) === "es"));
        if (esStrong.length <= 2) {
          uniqueTags.set(x.c.id, {
            id: "unique_format_es",
            label: TAG_LABELS.unique_format_es,
            source: "youtube_data",
            evidence: `Formato: ${cl.format}. Búsqueda real en español «${cl.spanishSearchQuery}» (últimos 6 meses): sólo ${esStrong.length} vídeos en español superan 50.000 vistas.`,
          });
        }
      }
      detail5 = `${classification.channels.length} canales clasificados por IA (${aiProvider()}${vision ? "" : ", sin visión: no se etiqueta Faceless"}) · ${nonEs.length} formatos comprobados en español · ${uniqueTags.size} sin réplica fuerte`;
    } else {
      detail5 = `IA no configurada (${aiCredKeys().join(", ")}): se omiten las etiquetas de formato y faceless`;
    }
    done(5, detail5);

    // 6 · Análisis de vídeos del canal (uploads + estadísticas)
    start(6);
    const deep: { x: (typeof candidates)[number]; uploads: VideoInfo[] }[] = [];
    for (const x of candidates) {
      let uploads: VideoInfo[] = [];
      if (x.c.uploadsPlaylistId) {
        try {
          const ids = await yt.getUploads(x.c.uploadsPlaylistId, 30, tracker);
          uploads = await yt.getVideos(ids, tracker);
        } catch (e) {
          if (e instanceof yt.YouTubeError && e.reason === "quotaExceeded") throw e;
        }
      }
      // incluye los vídeos encontrados en la búsqueda aunque no estén entre las 30 últimas subidas
      const all = new Map(uploads.map((v) => [v.id, v]));
      for (const h of x.own) all.set(h.video.id, h.video);
      deep.push({ x, uploads: [...all.values()].sort((a, b) => +new Date(b.publishedAt) - +new Date(a.publishedAt)) });
    }
    done(6, `${deep.reduce((s, d) => s + d.uploads.length, 0)} vídeos analizados de ${deep.length} canales`);

    // 7 · Clasificación y puntuación
    start(7);
    const ranked: ChannelResult[] = deep.map(({ x, uploads }) => {
      const metrics = computeMetrics(x.c, uploads);
      const score = scoreChannel(x.c, metrics);
      const { lang, source } = resolveLanguage(x.c, uploads);
      const cl = classification?.channels.find((c) => c.channelId === x.c.id);
      const tags: OpportunityTag[] = [...dataTags(metrics, uploads)];
      const u = uniqueTags.get(x.c.id);
      if (u) tags.push(u);
      if (vision && cl?.faceless && cl.aiGeneratedVisuals)
        tags.push({ id: "faceless_ai", label: TAG_LABELS.faceless_ai, source: "ai_analysis", evidence: `Análisis IA de miniaturas: ${cl.aiEvidence}` });
      else if (vision && cl?.faceless)
        tags.push({ id: "faceless", label: TAG_LABELS.faceless, source: "ai_analysis", evidence: `Análisis IA de miniaturas: ${cl.facelessEvidence}` });
      const em = emerging.get(x.best.niche);
      if (em) tags.push({ id: "emerging_niche", label: TAG_LABELS.emerging_niche, source: "youtube_data", evidence: em });
      const niche = cl?.nicheLabel ? `${cl.nicheLabel}` : x.best.niche;
      const featured = [...uploads].sort((a, b) => (b.viewCount ?? 0) - (a.viewCount ?? 0)).slice(0, 3);
      return {
        rank: 0,
        channel: x.c,
        score,
        niche,
        language: lang,
        languageSource: source,
        tags,
        featuredVideos: featured,
        revenue: estimateRevenue(metrics, lang, `${niche} ${x.best.niche}`, uploads),
        channelUrl: x.c.customUrl ? `https://www.youtube.com/${x.c.customUrl}` : `https://www.youtube.com/channel/${x.c.id}`,
      };
    });
    // Prioridad editorial (no altera la puntuación): español u formato único en español primero ante empate.
    const priority = (r: ChannelResult) => r.score.total + (r.language === "es" ? 5 : 0) + (r.tags.some((t) => t.id === "unique_format_es") ? 5 : 0);
    ranked.sort((a, b) => priority(b) - priority(a));
    const results = ranked.slice(0, RESULTS).map((r, i) => ({ ...r, rank: i + 1 }));
    done(7, `${ranked.length} canales puntuados (0–100)`);

    // 8 · Guardado
    start(8);
    const db = sql();
    for (const r of results) {
      await db`insert into search_results (search_id, channel_id, rank, score, score_breakdown, niche, language, language_source, tags, featured_videos, revenue_estimate, ai_insights)
        values (${searchId}, ${r.channel.id}, ${r.rank}, ${r.score.total}, ${db.json(r.score as any)}, ${r.niche}, ${r.language}, ${r.languageSource},
          ${db.json(r.tags as any)}, ${db.json(r.featuredVideos as any)}, ${db.json(r.revenue as any)},
          ${db.json((classification?.channels.find((c) => c.channelId === r.channel.id) ?? null) as any)})`;
    }
    done(8, `${results.length} canales guardados`);

    start(9);
    await finish(searchId, tracker.units);
    done(9, `${results.length} canales verificados · ${tracker.units} unidades de cuota`);
    return {
      searchId,
      results,
      quotaUsed: tracker.units,
      note: results.length < RESULTS ? `Sólo ${results.length} canales cumplen los criterios con datos reales.` : undefined,
    };
  } catch (e) {
    emit({ type: "step", step, status: "error", label: STEP_LABELS[step - 1] ?? "", detail: (e as Error).message });
    await sql()`update searches set status = 'error', error = ${(e as Error).message}, quota_units = ${tracker.units}, finished_at = now() where id = ${searchId}`.catch(() => {});
    throw e;
  }
}

async function finish(id: string, units: number) {
  await sql()`update searches set status = 'done', quota_units = ${units}, finished_at = now() where id = ${id}`;
}

export async function loadSearch(id: string) {
  const db = sql();
  const [s] = await db`select * from searches where id = ${id}`;
  if (!s) return null;
  const rows = await db`select r.*, row_to_json(c.*) as ch from search_results r join channels c on c.id = r.channel_id where r.search_id = ${id} order by r.rank`;
  const results: ChannelResult[] = rows.map((r: any) => ({
    rank: r.rank,
    channel: {
      id: r.ch.id, title: r.ch.title, description: r.ch.description ?? "", customUrl: r.ch.custom_url, thumbnailUrl: r.ch.thumbnail_url,
      country: r.ch.country, defaultLanguage: r.ch.default_language, publishedAt: r.ch.published_at, subscriberCount: r.ch.subscriber_count === null ? null : Number(r.ch.subscriber_count),
      subscribersHidden: r.ch.subscribers_hidden, viewCount: Number(r.ch.view_count), videoCount: r.ch.video_count, uploadsPlaylistId: r.ch.uploads_playlist_id,
    },
    score: r.score_breakdown,
    niche: r.niche,
    language: r.language,
    languageSource: r.language_source,
    tags: r.tags,
    featuredVideos: r.featured_videos,
    revenue: r.revenue_estimate,
    channelUrl: r.ch.custom_url ? `https://www.youtube.com/${r.ch.custom_url}` : `https://www.youtube.com/channel/${r.ch.id}`,
  }));
  return { search: s, results };
}

