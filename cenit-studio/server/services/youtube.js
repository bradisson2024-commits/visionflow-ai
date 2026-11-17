// YouTube Data API v3. Sólo endpoints y campos documentados por Google. Cuota: search.list = 100 unidades;
// videos.list, channels.list y playlistItems.list = 1 unidad. Cada respuesta se guarda y deja una captura (snapshot)
// para medir la velocidad de crecimiento real entre consultas sucesivas.
import { config } from '../config.js';
import { call } from '../core/http.js';
import { ServiceError } from '../core/errors.js';
import { sql } from '../db/index.js';

export const QUOTA_PER_DAY = 10000;
const key = () => { if (!config.youtubeKey) throw new ServiceError('YouTube', 'falta YOUTUBE_API_KEY en el servidor (Google Cloud → YouTube Data API v3 → Credenciales).', { status: 503 }); return config.youtubeKey; };
const api = (res, params, units) => call('YouTube', res, `${config.youtubeBase}/${res}?${new URLSearchParams({ ...params, key: key() })}`, {}, { units, attempts: 2, timeout: 30000 });

export function isoSeconds(iso) {
  const m = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(iso || '');
  return m ? (+m[1] || 0) * 86400 + (+m[2] || 0) * 3600 + (+m[3] || 0) * 60 + (+m[4] || 0) : null;
}

export function parseVideoId(s) {
  s = String(s || '').trim();
  if (/^[\w-]{11}$/.test(s)) return s;
  try { const u = new URL(s); if (u.hostname.endsWith('youtu.be')) return u.pathname.slice(1, 12); return u.searchParams.get('v')?.slice(0, 11) || /\/(shorts|embed|live)\/([\w-]{11})/.exec(u.pathname)?.[2] || null; } catch { return null; }
}

/** Identificador de canal desde URL, @handle o id. */
export function parseChannelRef(s) {
  s = String(s || '').trim();
  if (/^UC[\w-]{22}$/.test(s)) return { id: s };
  if (/^@[\w.-]+$/.test(s)) return { handle: s };
  try {
    const u = new URL(s);
    const m = /\/channel\/(UC[\w-]{22})/.exec(u.pathname); if (m) return { id: m[1] };
    const h = /\/(@[\w.%-]+)/.exec(u.pathname); if (h) return { handle: decodeURIComponent(h[1]) };
  } catch { /* no es URL */ }
  return s ? { handle: s.startsWith('@') ? s : `@${s}` } : null;
}

export async function searchVideos({ q, publishedAfter, language, region, duration, order = 'viewCount', max = 50, pageToken }) {
  const p = { part: 'id', type: 'video', q: q || '', order, maxResults: String(Math.min(50, max)) };
  if (publishedAfter) p.publishedAfter = publishedAfter;
  if (language) p.relevanceLanguage = language;
  if (region) p.regionCode = region;
  if (duration) p.videoDuration = duration; // short (<4 min) | medium (4–20) | long (>20)
  if (pageToken) p.pageToken = pageToken;
  const r = await api('search', p, 100);
  return { ids: (r.items || []).map((i) => i.id?.videoId).filter(Boolean), next: r.nextPageToken || null, units: 100 };
}

export async function searchChannels({ q, publishedAfter, language, region, max = 50 }) {
  const p = { part: 'id', type: 'channel', q: q || '', order: 'relevance', maxResults: String(Math.min(50, max)) };
  if (publishedAfter) p.publishedAfter = publishedAfter; // en búsquedas de canales filtra por fecha de creación del canal
  if (language) p.relevanceLanguage = language;
  if (region) p.regionCode = region;
  const r = await api('search', p, 100);
  return { ids: (r.items || []).map((i) => i.id?.channelId).filter(Boolean), units: 100 };
}

export async function videos(ids) {
  const out = [];
  for (let i = 0; i < ids.length; i += 50) {
    const r = await api('videos', { part: 'snippet,statistics,contentDetails,paidProductPlacementDetails', id: ids.slice(i, i + 50).join(',') }, 1);
    for (const v of r.items || []) {
      const sn = v.snippet || {}, st = v.statistics || {}, th = sn.thumbnails || {};
      const dur = isoSeconds(v.contentDetails?.duration);
      out.push({
        id: v.id, channel_id: sn.channelId, title: sn.title, description: sn.description || '', thumbnail: (th.maxres || th.high || th.medium || th.default || {}).url || null,
        published_at: sn.publishedAt, duration_sec: dur, is_short: dur != null && dur <= 180, language: sn.defaultAudioLanguage || sn.defaultLanguage || null,
        views: st.viewCount != null ? Number(st.viewCount) : null, likes: st.likeCount != null ? Number(st.likeCount) : null, comments: st.commentCount != null ? Number(st.commentCount) : null,
        paid_placement: v.paidProductPlacementDetails?.hasPaidProductPlacement ?? null, channel_title: sn.channelTitle,
      });
    }
  }
  await saveVideos(out);
  return out;
}

export async function channels({ ids = [], handle } = {}) {
  const out = [];
  const batches = handle ? [{ forHandle: handle }] : [];
  for (let i = 0; i < ids.length; i += 50) batches.push({ id: ids.slice(i, i + 50).join(',') });
  for (const b of batches) {
    const r = await api('channels', { part: 'snippet,statistics,contentDetails,brandingSettings', ...b }, 1);
    for (const c of r.items || []) {
      const sn = c.snippet || {}, st = c.statistics || {}, th = sn.thumbnails || {};
      out.push({
        id: c.id, title: sn.title, handle: sn.customUrl || null, description: sn.description || '', thumbnail: (th.high || th.medium || th.default || {}).url || null,
        country: sn.country || c.brandingSettings?.channel?.country || null, default_language: sn.defaultLanguage || c.brandingSettings?.channel?.defaultLanguage || null,
        created_at_yt: sn.publishedAt, subscribers_hidden: !!st.hiddenSubscriberCount, subscribers: st.hiddenSubscriberCount ? null : Number(st.subscriberCount ?? 0),
        views: Number(st.viewCount ?? 0), video_count: Number(st.videoCount ?? 0), uploads_playlist: c.contentDetails?.relatedPlaylists?.uploads || null,
      });
    }
  }
  await saveChannels(out);
  return out;
}

/** Últimos vídeos subidos por un canal (lista de «uploads»). */
export async function uploads(playlistId, max = 50) {
  const ids = [];
  let token;
  while (ids.length < max) {
    const r = await api('playlistItems', { part: 'contentDetails', playlistId, maxResults: '50', ...(token ? { pageToken: token } : {}) }, 1);
    ids.push(...(r.items || []).map((i) => i.contentDetails?.videoId).filter(Boolean));
    token = r.nextPageToken;
    if (!token) break;
  }
  return ids.slice(0, max);
}

async function saveVideos(list) {
  for (const v of list) {
    await sql`insert into yt_videos(id, channel_id, title, description, thumbnail, published_at, duration_sec, is_short, language, views, likes, comments, paid_placement, fetched_at)
      values (${v.id}, ${v.channel_id}, ${v.title}, ${v.description}, ${v.thumbnail}, ${v.published_at}, ${v.duration_sec}, ${v.is_short}, ${v.language}, ${v.views}, ${v.likes}, ${v.comments}, ${v.paid_placement}, now())
      on conflict (id) do update set title = excluded.title, description = excluded.description, thumbnail = excluded.thumbnail, views = excluded.views,
        likes = excluded.likes, comments = excluded.comments, paid_placement = excluded.paid_placement, fetched_at = now()`;
    await sql`insert into yt_video_snapshots(video_id, views, likes, comments) values (${v.id}, ${v.views}, ${v.likes}, ${v.comments}) on conflict do nothing`;
  }
}

async function saveChannels(list) {
  for (const c of list) {
    await sql`insert into yt_channels(id, title, handle, description, thumbnail, country, default_language, created_at_yt, subscribers, subscribers_hidden, views, video_count, uploads_playlist, fetched_at)
      values (${c.id}, ${c.title}, ${c.handle}, ${c.description}, ${c.thumbnail}, ${c.country}, ${c.default_language}, ${c.created_at_yt}, ${c.subscribers}, ${c.subscribers_hidden}, ${c.views}, ${c.video_count}, ${c.uploads_playlist}, now())
      on conflict (id) do update set title = excluded.title, handle = excluded.handle, description = excluded.description, thumbnail = excluded.thumbnail, country = excluded.country,
        default_language = excluded.default_language, subscribers = excluded.subscribers, subscribers_hidden = excluded.subscribers_hidden, views = excluded.views,
        video_count = excluded.video_count, uploads_playlist = excluded.uploads_playlist, fetched_at = now()`;
    await sql`insert into yt_channel_snapshots(channel_id, subscribers, views, video_count) values (${c.id}, ${c.subscribers}, ${c.views}, ${c.video_count}) on conflict do nothing`;
  }
}

/** Unidades de cuota gastadas hoy (día del Pacífico, como la consola de Google), según el registro real. */
export async function quotaToday() {
  const [{ n }] = await sql`select coalesce(sum(units), 0)::int as n from api_calls where service = 'YouTube' and (at at time zone 'America/Los_Angeles')::date = (now() at time zone 'America/Los_Angeles')::date`;
  return n;
}
