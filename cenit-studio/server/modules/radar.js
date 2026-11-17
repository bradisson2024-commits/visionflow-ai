// Radar Viral, Radar de Canales, análisis de canal e investigación internacional (YouTube Data API v3).
import { sql } from '../db/index.js';
import * as yt from '../services/youtube.js';
import { AppError } from '../core/errors.js';
import { classifyVideo, channelProfile, measuredVelocity, mergeThresholds, emergingTrends, CATEGORY_LABELS, median } from './metrics.js';
import { monetizationFor, GROUP_LABELS } from './monetization.js';
import { getSetting } from './settings.js';

export const PERIODS = { '24h': 1, '3d': 3, '7d': 7, '30d': 30, '90d': 90, '365d': 365 };
export const LANGUAGES = [
  ['es', 'Español'], ['en', 'Inglés'], ['pt', 'Portugués'], ['tr', 'Turco'], ['ja', 'Japonés'], ['ko', 'Coreano'], ['hi', 'Hindi'],
  ['fr', 'Francés'], ['de', 'Alemán'], ['it', 'Italiano'], ['ar', 'Árabe'], ['ru', 'Ruso'], ['id', 'Indonesio'], ['vi', 'Vietnamita'],
];
export const NICHES = ['Misterios', 'Ciencia', 'Historia', 'Documentales', 'Entretenimiento', 'Contenido bíblico', 'Finanzas', 'Cocina', 'Animación', 'Educación', 'True crime', 'Curiosidades', 'Tecnología', 'Salud', 'Negocios'];

// RPM orientativo (USD por 1.000 vistas monetizadas) por idioma. Rango configurable en Ajustes; siempre se presenta como estimación.
export const DEFAULT_RPM = { es: [0.5, 2.5], en: [2, 8], pt: [0.4, 2], tr: [0.3, 1.5], ja: [1.5, 5], ko: [1, 4], hi: [0.2, 1], default: [0.5, 3] };

async function rpmFor(lang) {
  const conf = (await getSetting('rpm')) || DEFAULT_RPM;
  return conf[(lang || '').slice(0, 2)] || conf.default || DEFAULT_RPM.default;
}

/** Perfil de canales: subidas recientes (1–2 unidades por canal) para comparar cada vídeo con lo habitual. */
async function profiles(channels, perChannel = 20) {
  const out = new Map();
  for (const c of channels) {
    if (!c.uploads_playlist) { out.set(c.id, { channel: c, recent: [], profile: channelProfile(c, []) }); continue; }
    const ids = await yt.uploads(c.uploads_playlist, perChannel);
    const recent = ids.length ? await yt.videos(ids) : [];
    out.set(c.id, { channel: c, recent, profile: channelProfile(c, recent) });
  }
  return out;
}

const durationParam = (d) => (d === 'shorts' ? 'short' : d === 'medio' ? 'medium' : d === 'largo' ? 'long' : undefined);

export async function viralRadar(user, filters) {
  const T = mergeThresholds(filters.thresholds);
  const days = PERIODS[filters.period] || 7;
  const q = [filters.niche, filters.subniche, filters.keyword].filter(Boolean).join(' ').trim();
  if (!q) throw new AppError(400, 'Indica un nicho, un subnicho o una palabra clave.');
  const before = await yt.quotaToday();
  const langs = (filters.languages?.length ? filters.languages : [filters.language || 'es']).slice(0, 4);
  const ordered = [...langs].sort((a, b) => (a === 'es' ? -1 : b === 'es' ? 1 : 0)); // el español primero
  let ids = [];
  for (const lang of ordered) {
    const r = await yt.searchVideos({ q, publishedAfter: new Date(Date.now() - days * 86400e3).toISOString(), language: lang, region: filters.region || undefined, duration: durationParam(filters.duration), max: 50 });
    ids.push(...r.ids);
  }
  ids = [...new Set(ids)];
  let vids = ids.length ? await yt.videos(ids) : [];
  if (filters.duration === 'shorts') vids = vids.filter((v) => v.is_short);
  if (filters.duration === 'largos') vids = vids.filter((v) => !v.is_short);
  if (filters.minViews) vids = vids.filter((v) => (v.views || 0) >= Number(filters.minViews));
  const chans = vids.length ? await yt.channels({ ids: [...new Set(vids.map((v) => v.channel_id))] }) : [];
  const cmap = new Map(chans.map((c) => [c.id, c]));
  vids = vids.filter((v) => {
    const c = cmap.get(v.channel_id);
    if (!c) return false;
    if (filters.maxSubscribers && (c.subscribers == null || c.subscribers > Number(filters.maxSubscribers))) return false;
    if (filters.minSubscribers && (c.subscribers ?? 0) < Number(filters.minSubscribers)) return false;
    if (filters.channelMaxAgeDays && (!c.created_at_yt || Date.now() - Date.parse(c.created_at_yt) > Number(filters.channelMaxAgeDays) * 86400e3)) return false;
    return true;
  });
  // Perfiles sólo de los canales de los 30 mejores candidatos por vistas/hora (controla la cuota).
  const prelim = [...vids].sort((a, b) => b.views / Math.max(1, Date.now() - Date.parse(b.published_at)) - a.views / Math.max(1, Date.now() - Date.parse(a.published_at))).slice(0, 30);
  const prof = await profiles([...new Set(prelim.map((v) => v.channel_id))].map((id) => cmap.get(id)));
  const items = [];
  for (const v of prelim) {
    const p = prof.get(v.channel_id);
    const recentOthers = p.recent.filter((x) => x.id !== v.id);
    const profile = channelProfile(p.channel, recentOthers);
    const velocity = await measuredVelocity(v.id, v.published_at);
    const c = classifyVideo(v, { channel: p.channel, profile, velocity, thresholds: T });
    items.push({ video: v, channel: p.channel, profile, ...c });
  }
  for (const t of emergingTrends(items, T)) for (const x of items) if (t.videos.includes(x.video.id) && !x.categories.includes('tendencia')) { x.categories.push('tendencia'); x.explanation.push(`Tendencia emergente: «${t.term}» aparece en ${t.videos.length} vídeos recientes de ${t.channels} canales que rinden por encima de lo normal.`); }
  items.sort((a, b) => b.score - a.score);
  const used = (await yt.quotaToday()) - before;
  const [s] = await sql`insert into radar_searches(owner_id, kind, filters, thresholds, quota_used) values (${user.id}, 'viral', ${sql.json(filters)}, ${sql.json(T)}, ${used}) returning *`;
  for (const x of items) await sql`insert into radar_items(search_id, item_type, item_id, score, categories, evidence, explanation) values (${s.id}, 'video', ${x.video.id}, ${x.score}, ${x.categories}, ${sql.json({ metrics: x.metrics, profile: x.profile })}, ${sql.json(x.explanation)})`;
  return getSearch(user, s.id);
}

/** Nueva captura de los vídeos de una búsqueda: permite medir la velocidad real (vistas/hora entre capturas). */
export async function refreshSearch(user, id) {
  const [s] = await sql`select * from radar_searches where id = ${id} and owner_id = ${user.id}`;
  if (!s) throw new AppError(404, 'Búsqueda no encontrada');
  if (s.kind !== 'viral') throw new AppError(400, 'Sólo las búsquedas del Radar Viral se actualizan con capturas.');
  const items = await sql`select item_id from radar_items where search_id = ${id}`;
  const vids = await yt.videos(items.map((i) => i.item_id));
  for (const v of vids) {
    const [c] = await sql`select * from yt_channels where id = ${v.channel_id}`;
    const recent = await sql`select * from yt_videos where channel_id = ${v.channel_id} and id <> ${v.id} order by published_at desc limit 20`;
    const cls = classifyVideo(v, { channel: c, profile: channelProfile(c, recent), velocity: await measuredVelocity(v.id, v.published_at), thresholds: s.thresholds });
    await sql`update radar_items set score = ${cls.score}, categories = ${cls.categories}, evidence = ${sql.json({ metrics: cls.metrics, profile: channelProfile(c, recent) })}, explanation = ${sql.json(cls.explanation)} where search_id = ${id} and item_id = ${v.id}`;
  }
  return getSearch(user, id);
}

export async function channelRadar(user, filters) {
  const q = [filters.niche, filters.keyword].filter(Boolean).join(' ').trim();
  if (!q) throw new AppError(400, 'Indica un nicho o una palabra clave.');
  const maxSubs = Number(filters.maxSubscribers || 100000);
  const before = await yt.quotaToday();
  const langs = (filters.languages?.length ? filters.languages : [filters.language || 'es']).slice(0, 3).sort((a, b) => (a === 'es' ? -1 : b === 'es' ? 1 : 0));
  const createdAfter = filters.createdAfter ? new Date(filters.createdAfter).toISOString() : filters.channelMaxAgeDays ? new Date(Date.now() - Number(filters.channelMaxAgeDays) * 86400e3).toISOString() : null;
  const cand = new Set();
  for (const lang of langs) {
    // 1) canales del nicho creados después de la fecha indicada (filtro publishedAfter de search.list para canales)
    if (createdAfter) for (const id of (await yt.searchChannels({ q, publishedAfter: createdAfter, language: lang, region: filters.region || undefined })).ids) cand.add(id);
    // 2) canales detrás de vídeos recientes con muchas vistas
    const r = await yt.searchVideos({ q, publishedAfter: new Date(Date.now() - (PERIODS[filters.period] || 30) * 86400e3).toISOString(), language: lang, region: filters.region || undefined, max: 50 });
    if (r.ids.length) for (const v of await yt.videos(r.ids)) cand.add(v.channel_id);
  }
  let chans = cand.size ? await yt.channels({ ids: [...cand] }) : [];
  chans = chans.filter((c) => c.subscribers != null && c.subscribers <= maxSubs && (!createdAfter || (c.created_at_yt && c.created_at_yt >= createdAfter)));
  chans = chans.sort((a, b) => b.views / Math.max(1, b.subscribers) - a.views / Math.max(1, a.subscribers)).slice(0, 25);
  const prof = await profiles(chans, 30);
  const items = [];
  for (const c of chans) {
    const { recent, profile } = prof.get(c.id);
    const best = [...recent].sort((a, b) => b.views - a.views)[0];
    const recent30 = recent.filter((v) => Date.now() - Date.parse(v.published_at) <= 30 * 86400e3);
    const recentViews = recent30.reduce((a, v) => a + Number(v.views || 0), 0);
    const mon = await monetizationFor(user.id, c, recent);
    const ratio = best && c.subscribers ? best.views / Math.max(1, c.subscribers) : null;
    const why = [];
    if (c.created_at_yt) why.push(`Creado el ${new Date(c.created_at_yt).toLocaleDateString('es')} según YouTube (hace ${profile.ageDays} días).`);
    else why.push('YouTube no indica la fecha de creación: no se afirma que sea nuevo.');
    why.push(`${c.subscribers.toLocaleString('es')} suscriptores, ${c.views.toLocaleString('es')} visualizaciones totales y ${c.video_count} vídeos.`);
    if (best) why.push(`Vídeo más visto de la muestra: «${best.title}» con ${Number(best.views).toLocaleString('es')} vistas (${ratio.toFixed(1)}× sus suscriptores).`);
    if (recent30.length) why.push(`${recent30.length} vídeos publicados en 30 días suman ${recentViews.toLocaleString('es')} vistas.`);
    if (profile.uploadsPerWeek != null) why.push(`Publica ${profile.uploadsPerWeek} vídeos por semana (muestra de ${recent.length}).`);
    const young = profile.ageDays != null && profile.ageDays <= Number(filters.channelMaxAgeDays || 365);
    const score = Math.round(Math.min(100, (ratio ? Math.min(60, Math.log10(Math.max(1, ratio)) * 30) : 0) + (young ? 20 : 0) + Math.min(20, Math.log10(Math.max(1, recentViews)) * 3)));
    const cats = [];
    if (ratio && ratio >= 20) cats.push('canal_pequeno');
    if (young && profile.ageDays <= 90) cats.push('canal_nuevo');
    items.push({ channel: c, profile, best, recentViews, monetization: mon, score, categories: cats, explanation: why });
  }
  items.sort((a, b) => b.score - a.score);
  const used = (await yt.quotaToday()) - before;
  const [s] = await sql`insert into radar_searches(owner_id, kind, filters, thresholds, quota_used) values (${user.id}, 'canales', ${sql.json(filters)}, ${sql.json({ maxSubs })}, ${used}) returning *`;
  for (const x of items) await sql`insert into radar_items(search_id, item_type, item_id, score, categories, monetization, evidence, explanation) values (${s.id}, 'canal', ${x.channel.id}, ${x.score}, ${x.categories}, ${x.monetization.group}, ${sql.json({ profile: x.profile, best: x.best?.id || null, recentViews: x.recentViews, monetization: x.monetization })}, ${sql.json(x.explanation)})`;
  return getSearch(user, s.id);
}

/** Ficha / análisis de un canal por URL, @handle o id. */
export async function analyzeChannel(user, ref) {
  const r = yt.parseChannelRef(ref);
  if (!r) throw new AppError(400, 'Indica la URL del canal, su @handle o su id (UC…).');
  const [c] = r.id ? await yt.channels({ ids: [r.id] }) : await yt.channels({ handle: r.handle });
  if (!c) throw new AppError(404, 'YouTube no encontró ese canal.');
  const ids = c.uploads_playlist ? await yt.uploads(c.uploads_playlist, 50) : [];
  const vids = ids.length ? await yt.videos(ids) : [];
  const profile = channelProfile(c, vids);
  const now = Date.now();
  const last30 = vids.filter((v) => now - Date.parse(v.published_at) <= 30 * 86400e3);
  const views30 = last30.reduce((a, v) => a + Number(v.views || 0), 0);
  const [lo, hi] = await rpmFor(c.default_language || vids[0]?.language);
  const durs = vids.map((v) => v.duration_sec).filter(Boolean);
  const med = median(vids.map((v) => Number(v.views || 0)));
  const long = vids.filter((v) => !v.is_short), shorts = vids.filter((v) => v.is_short);
  const avg = (a) => (a.length ? Math.round(a.reduce((x, v) => x + Number(v.views || 0), 0) / a.length) : null);
  const analysis = {
    channel: c,
    stats: {
      subscribers: c.subscribers, views: c.views, videos: c.video_count,
      avgDurationSec: durs.length ? Math.round(durs.reduce((a, b) => a + b, 0) / durs.length) : null,
      uploadsPerWeek: profile.uploadsPerWeek,
      revenueEstimate: { low: Math.round((views30 / 1000) * lo), high: Math.round((views30 / 1000) * hi), basis: `Vistas de los ${last30.length} vídeos publicados en 30 días (${views30.toLocaleString('es')}) × RPM supuesto ${lo}–${hi} USD. Es una ESTIMACIÓN: los ingresos reales sólo los conoce el creador.` },
    },
    performance: {
      medianViews: med, longAvg: avg(long), shortsAvg: avg(shorts), longCount: long.length, shortsCount: shorts.length,
      top: [...vids].sort((a, b) => b.views - a.views).slice(0, 5).map((v) => ({ id: v.id, title: v.title, views: v.views, vsMedian: med ? +(v.views / med).toFixed(1) : null })),
      bottom: [...vids].sort((a, b) => a.views - b.views).slice(0, 3).map((v) => ({ id: v.id, title: v.title, views: v.views, vsMedian: med ? +(v.views / med).toFixed(2) : null })),
      engagement: vids.length ? +(vids.reduce((a, v) => a + (Number(v.likes || 0) + Number(v.comments || 0)) / Math.max(1, Number(v.views || 0)), 0) / vids.length * 100).toFixed(2) : null,
    },
    videos: vids.map((v) => ({ ...v, vsMedian: med ? +(v.views / med).toFixed(2) : null })),
    monetization: await monetizationFor(user.id, c, vids),
  };
  await sql`insert into radar_searches(owner_id, kind, filters, thresholds) values (${user.id}, 'canal', ${sql.json({ ref })}, ${sql.json({})})`;
  return analysis;
}

export async function getSearch(user, id) {
  const [s] = await sql`select * from radar_searches where id = ${id} and owner_id = ${user.id}`;
  if (!s) throw new AppError(404, 'Búsqueda no encontrada');
  const rows = await sql`select * from radar_items where search_id = ${id} order by score desc`;
  const vids = rows.filter((r) => r.item_type === 'video').map((r) => r.item_id);
  const chs = rows.filter((r) => r.item_type === 'canal').map((r) => r.item_id);
  const vmap = new Map((vids.length ? await sql`select * from yt_videos where id = any(${vids})` : []).map((v) => [v.id, v]));
  const allCh = [...chs, ...[...vmap.values()].map((v) => v.channel_id)];
  const cmap = new Map((allCh.length ? await sql`select * from yt_channels where id = any(${allCh})` : []).map((c) => [c.id, c]));
  return {
    ...s,
    labels: { categories: CATEGORY_LABELS, monetization: GROUP_LABELS },
    items: rows.map((r) => ({ ...r, video: vmap.get(r.item_id) || null, channel: r.item_type === 'canal' ? cmap.get(r.item_id) : cmap.get(vmap.get(r.item_id)?.channel_id) || null })),
  };
}

export const history = (user, kind) => sql`select id, kind, filters, quota_used, status, error, created_at, (select count(*)::int from radar_items i where i.search_id = s.id) as results from radar_searches s where owner_id = ${user.id} ${kind ? sql`and kind = ${kind}` : sql``} order by created_at desc limit 100`;

export async function addEvidence(user, channelId, sourceUrl, note) {
  if (!/^https?:\/\//.test(sourceUrl || '') || !note?.trim()) throw new AppError(400, 'Indica la URL de la fuente y qué demuestra.');
  await sql`insert into monetization_evidence(channel_id, owner_id, source_url, note) values (${channelId}, ${user.id}, ${sourceUrl}, ${note}) on conflict (channel_id, owner_id) do update set source_url = excluded.source_url, note = excluded.note, created_at = now()`;
}

/** Investigación internacional: ¿el formato tiene poca competencia en español? (1 búsqueda = 100 unidades) */
export async function spanishGap(q) {
  const r = await yt.searchVideos({ q, publishedAfter: new Date(Date.now() - 180 * 86400e3).toISOString(), language: 'es', max: 25 });
  const vs = r.ids.length ? await yt.videos(r.ids) : [];
  const strong = vs.filter((v) => (v.views || 0) >= 100000).length;
  return { query: q, spanishVideos: vs.length, over100k: strong, adaptable: strong <= 2, explanation: strong <= 2 ? `Sólo ${strong} vídeos en español superan 100.000 vistas en 6 meses: hueco para adaptarlo con un canal original.` : `${strong} vídeos en español ya superan 100.000 vistas: hay competencia.` };
}
