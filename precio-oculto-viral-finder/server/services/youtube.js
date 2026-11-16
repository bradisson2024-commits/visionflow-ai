// YouTube Data API v3 (datos reales). Coste de cuota según la documentación de Google:
// search.list = 100 unidades, videos.list = 1, channels.list = 1.
import { getSetting } from '../core/settings.js';
import { requestJson, ExternalError } from '../core/http-client.js';
import { all } from '../db/index.js';

const base = () => process.env.EPO_YOUTUBE_BASE || 'https://www.googleapis.com/youtube/v3';
export const DAILY_QUOTA = 10000;

function key() {
  const k = getSetting('YOUTUBE_API_KEY');
  if (!k) throw new ExternalError('YouTube', 'falta la clave YOUTUBE_API_KEY. Configúrala en Configuración → YouTube.');
  return k;
}

const call = (resource, params, units) =>
  requestJson('YouTube', resource, `${base()}/${resource}?${new URLSearchParams({ ...params, key: key() })}`, {}, { units, attempts: 2, timeout: 30000 });

export function parseDuration(iso) {
  const m = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(iso || '');
  if (!m) return null;
  return (+m[1] || 0) * 86400 + (+m[2] || 0) * 3600 + (+m[3] || 0) * 60 + (+m[4] || 0);
}

export function videoIdFrom(input) {
  const s = String(input || '').trim();
  if (/^[A-Za-z0-9_-]{11}$/.test(s)) return s;
  try {
    const u = new URL(s);
    if (/youtu\.be$/.test(u.hostname)) return u.pathname.slice(1, 12);
    const v = u.searchParams.get('v');
    if (v) return v.slice(0, 11);
    const m = /\/(shorts|embed|live)\/([A-Za-z0-9_-]{11})/.exec(u.pathname);
    return m ? m[2] : null;
  } catch { return null; }
}

/** Búsqueda: devuelve ids ordenados por vistas en el periodo. */
export async function searchIds({ q, days, language, max = 25, minMinutes = 4 }) {
  const params = {
    part: 'id', type: 'video', q, order: 'viewCount', maxResults: String(Math.min(50, max)),
    publishedAfter: new Date(Date.now() - days * 86400000).toISOString(),
    relevanceLanguage: language, safeSearch: 'none',
  };
  if (minMinutes >= 20) params.videoDuration = 'long';
  else if (minMinutes >= 4) params.videoDuration = 'medium';
  const r = await call('search', params, 100);
  return { ids: (r.items || []).map((i) => i.id?.videoId).filter(Boolean), units: 100, total: r.pageInfo?.totalResults ?? null };
}

export async function videos(ids) {
  const out = [];
  for (let i = 0; i < ids.length; i += 50) {
    const r = await call('videos', { part: 'snippet,statistics,contentDetails', id: ids.slice(i, i + 50).join(',') }, 1);
    for (const v of r.items || []) {
      const sn = v.snippet || {}, st = v.statistics || {};
      const th = sn.thumbnails || {};
      out.push({
        id: v.id, title: sn.title, description: sn.description || '', channel_id: sn.channelId, channel_title: sn.channelTitle,
        published_at: sn.publishedAt, duration_sec: parseDuration(v.contentDetails?.duration),
        views: st.viewCount != null ? Number(st.viewCount) : null, likes: st.likeCount != null ? Number(st.likeCount) : null,
        comments: st.commentCount != null ? Number(st.commentCount) : null,
        thumbnail: (th.maxres || th.high || th.medium || th.default || {}).url || null,
        language: sn.defaultAudioLanguage || sn.defaultLanguage || null, tags: sn.tags || [],
      });
    }
  }
  return out;
}

export async function channelSubscribers(ids) {
  const out = {};
  for (let i = 0; i < ids.length; i += 50) {
    const r = await call('channels', { part: 'statistics', id: ids.slice(i, i + 50).join(',') }, 1);
    for (const c of r.items || []) out[c.id] = c.statistics?.hiddenSubscriberCount ? null : Number(c.statistics?.subscriberCount ?? 0);
  }
  return out;
}

/** Cuota consumida hoy (hora del Pacífico, como la cuenta Google), según el registro real de llamadas. */
export function quotaUsedToday() {
  const rows = all(`SELECT units, created_at FROM api_log WHERE service = 'YouTube' AND created_at >= datetime('now', '-2 days')`);
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
  return rows.filter((r) => new Date(`${r.created_at}Z`).toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' }) === today)
    .reduce((a, r) => a + r.units, 0);
}
