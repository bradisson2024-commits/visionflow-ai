// Datos reales de YouTube. Con YOUTUBE_API_KEY: búsqueda y estadísticas. Sin clave: sólo oEmbed (título, canal, miniatura).
import { config } from './config.js';
import { fetchJson, ServiceError } from './http.js';

const API = 'https://www.googleapis.com/youtube/v3';

export function parseVideoId(input) {
  const s = String(input || '').trim();
  if (/^[\w-]{11}$/.test(s)) return s;
  try {
    const u = new URL(s);
    if (u.hostname.includes('youtu.be')) return u.pathname.slice(1, 12) || null;
    if (u.searchParams.get('v')) return u.searchParams.get('v').slice(0, 11);
    const m = u.pathname.match(/\/(?:shorts|embed|live|v)\/([\w-]{11})/);
    return m ? m[1] : null;
  } catch { return null; }
}

/** ISO 8601 (PT1H2M3S) → segundos */
export function isoDurationToSeconds(iso) {
  const m = String(iso || '').match(/^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/);
  if (!m) return null;
  const [, d, h, mi, s] = m.map((x) => Number(x || 0));
  return d * 86400 + h * 3600 + mi * 60 + s;
}

function needKey() {
  if (!config.youtubeKey) throw new ServiceError('YouTube', 'Falta YOUTUBE_API_KEY. Créala gratis en console.cloud.google.com → APIs y servicios → habilitar «YouTube Data API v3» → Credenciales.');
}

function mapVideo(v) {
  const sn = v.snippet || {}, st = v.statistics || {}, cd = v.contentDetails || {};
  const thumbs = sn.thumbnails || {};
  return {
    id: v.id,
    url: `https://www.youtube.com/watch?v=${v.id}`,
    title: sn.title,
    description: sn.description || '',
    channelTitle: sn.channelTitle,
    channelId: sn.channelId,
    publishedAt: sn.publishedAt,
    tags: sn.tags || [],
    language: sn.defaultAudioLanguage || sn.defaultLanguage || null,
    views: st.viewCount != null ? Number(st.viewCount) : null,
    likes: st.likeCount != null ? Number(st.likeCount) : null,
    comments: st.commentCount != null ? Number(st.commentCount) : null,
    durationSec: isoDurationToSeconds(cd.duration),
    captionsAvailable: cd.caption === 'true',
    thumbnail: (thumbs.maxres || thumbs.high || thumbs.medium || thumbs.default || {}).url || `https://i.ytimg.com/vi/${v.id}/hqdefault.jpg`,
    dataSource: 'YouTube Data API v3',
  };
}

export async function searchViral({ q, days = 30, lang = 'es', max = 20, minDurationMin = 4 }) {
  needKey();
  const after = new Date(Date.now() - days * 86400000).toISOString();
  const params = new URLSearchParams({
    part: 'snippet', type: 'video', order: 'viewCount', maxResults: String(Math.min(50, max)),
    q, publishedAfter: after, relevanceLanguage: lang, key: config.youtubeKey,
  });
  if (minDurationMin >= 4) params.set('videoDuration', minDurationMin >= 20 ? 'long' : 'medium');
  const s = await fetchJson('YouTube', `${API}/search?${params}`);
  const ids = (s.items || []).map((i) => i.id?.videoId).filter(Boolean);
  if (!ids.length) return [];
  const vids = await getVideos(ids);
  const chIds = [...new Set(vids.map((v) => v.channelId))];
  const subs = await getChannelSubs(chIds);
  return vids.map((v) => {
    const subscribers = subs[v.channelId] ?? null;
    const ageDays = Math.max(1, (Date.now() - Date.parse(v.publishedAt)) / 86400000);
    return {
      ...v, subscribers,
      viewsPerDay: v.views != null ? Math.round(v.views / ageDays) : null,
      viewsPerSub: v.views != null && subscribers ? +(v.views / subscribers).toFixed(2) : null,
    };
  }).sort((a, b) => (b.viewsPerDay ?? 0) - (a.viewsPerDay ?? 0));
}

export async function getVideos(ids) {
  needKey();
  const out = [];
  for (let i = 0; i < ids.length; i += 50) {
    const p = new URLSearchParams({ part: 'snippet,statistics,contentDetails', id: ids.slice(i, i + 50).join(','), key: config.youtubeKey });
    const r = await fetchJson('YouTube', `${API}/videos?${p}`);
    out.push(...(r.items || []).map(mapVideo));
  }
  return out;
}

async function getChannelSubs(ids) {
  const map = {};
  for (let i = 0; i < ids.length; i += 50) {
    const p = new URLSearchParams({ part: 'statistics', id: ids.slice(i, i + 50).join(','), key: config.youtubeKey });
    const r = await fetchJson('YouTube', `${API}/channels?${p}`);
    for (const c of r.items || []) map[c.id] = c.statistics?.hiddenSubscriberCount ? null : Number(c.statistics?.subscriberCount ?? 0);
  }
  return map;
}

/** Datos del video a replicar. Indica explícitamente qué campos no se pudieron obtener. */
export async function getVideoInfo(urlOrId) {
  const id = parseVideoId(urlOrId);
  if (!id) throw new ServiceError('YouTube', 'Enlace de YouTube no válido.');
  if (config.youtubeKey) {
    const [v] = await getVideos([id]);
    if (!v) throw new ServiceError('YouTube', 'El video no existe, es privado o fue eliminado.');
    return { ...v, unavailable: [] };
  }
  const o = await fetchJson('YouTube oEmbed', `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(`https://www.youtube.com/watch?v=${id}`)}`);
  return {
    id, url: `https://www.youtube.com/watch?v=${id}`, title: o.title, channelTitle: o.author_name, channelUrl: o.author_url,
    description: null, publishedAt: null, views: null, likes: null, comments: null, durationSec: null,
    thumbnail: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`, dataSource: 'YouTube oEmbed (sin clave)',
    unavailable: ['descripción', 'fecha de publicación', 'visualizaciones', 'duración', 'me gusta'],
  };
}
