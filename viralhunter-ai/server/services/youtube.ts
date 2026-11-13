// Cliente de YouTube Data API v3 con contabilidad real de cuota.
import { env, requireCreds } from "../env";
import { sql } from "../db";
import type { ChannelInfo, VideoInfo } from "../../shared/types";

const BASE = "https://www.googleapis.com/youtube/v3";

/** Coste en unidades de cada método (documentación oficial de cuotas). */
export const QUOTA_COST: Record<string, number> = {
  search: 100,
  videos: 1,
  channels: 1,
  playlistItems: 1,
  videoCategories: 1,
};

export class YouTubeError extends Error {
  constructor(public status: number, public reason: string, message: string) {
    super(message);
  }
}

/** Día de cuota de Google (se reinicia a medianoche hora del Pacífico). */
export function quotaDay(d = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles" }).format(d);
}

export async function addQuota(units: number) {
  try {
    await sql()`insert into yt_quota_usage (day, units) values (${quotaDay()}, ${units})
      on conflict (day) do update set units = yt_quota_usage.units + ${units}, updated_at = now()`;
  } catch {
    /* sin BD, la búsqueda sigue funcionando; el contador no se persiste */
  }
}

export async function quotaUsedToday(): Promise<number> {
  try {
    const r = await sql()`select units from yt_quota_usage where day = ${quotaDay()}`;
    return r[0]?.units ?? 0;
  } catch {
    return 0;
  }
}

export interface Tracker {
  units: number;
}

async function call<T>(method: string, params: Record<string, string | number | undefined>, tracker?: Tracker): Promise<T> {
  requireCreds("YOUTUBE_API_KEY");
  const url = new URL(`${BASE}/${method}`);
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== "") url.searchParams.set(k, String(v));
  const res = await fetch(url, { headers: { "X-Goog-Api-Key": env.youtubeKey, Accept: "application/json" } });
  const cost = QUOTA_COST[method] ?? 1;
  if (tracker) tracker.units += cost;
  await addQuota(cost);
  const body = (await res.json().catch(() => ({}))) as any;
  if (!res.ok) {
    const reason = body?.error?.errors?.[0]?.reason ?? "unknown";
    let msg = body?.error?.message ?? `YouTube API ${res.status}`;
    if (reason === "quotaExceeded") msg = "Se agotó la cuota diaria de YouTube Data API. Se reinicia a medianoche (hora del Pacífico).";
    if (reason === "API_KEY_INVALID" || res.status === 400 && /API key/i.test(msg)) msg = "YOUTUBE_API_KEY no es válida.";
    throw new YouTubeError(res.status, reason, msg);
  }
  return body as T;
}

const num = (x: unknown): number | null => (x === undefined || x === null ? null : Number(x));

/** ISO-8601 (PT#H#M#S) → segundos */
export function parseDuration(iso?: string): number | null {
  if (!iso) return null;
  const m = /^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(iso);
  if (!m) return null;
  return (+(m[1] ?? 0)) * 86400 + (+(m[2] ?? 0)) * 3600 + (+(m[3] ?? 0)) * 60 + +(m[4] ?? 0);
}

const bestThumb = (t: any): string =>
  t?.maxres?.url ?? t?.standard?.url ?? t?.high?.url ?? t?.medium?.url ?? t?.default?.url ?? "";

export interface SearchHit {
  videoId: string;
  channelId: string;
  title: string;
  publishedAt: string;
}

export async function searchVideos(
  opts: {
    q: string;
    publishedAfter?: string;
    publishedBefore?: string;
    relevanceLanguage?: string;
    regionCode?: string;
    order?: "viewCount" | "relevance" | "date";
    maxResults?: number;
    channelId?: string;
    videoDuration?: "any" | "short" | "medium" | "long";
  },
  tracker?: Tracker,
): Promise<SearchHit[]> {
  const r = await call<any>(
    "search",
    {
      part: "snippet",
      type: "video",
      q: opts.q,
      order: opts.order ?? "viewCount",
      maxResults: opts.maxResults ?? 50,
      publishedAfter: opts.publishedAfter,
      publishedBefore: opts.publishedBefore,
      relevanceLanguage: opts.relevanceLanguage,
      regionCode: opts.regionCode,
      channelId: opts.channelId,
      videoDuration: opts.videoDuration,
      safeSearch: "moderate",
    },
    tracker,
  );
  return (r.items ?? [])
    .filter((i: any) => i.id?.videoId)
    .map((i: any) => ({
      videoId: i.id.videoId,
      channelId: i.snippet.channelId,
      title: i.snippet.title,
      publishedAt: i.snippet.publishedAt,
    }));
}

function chunks<T>(a: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < a.length; i += n) out.push(a.slice(i, i + n));
  return out;
}

export async function getVideos(ids: string[], tracker?: Tracker): Promise<VideoInfo[]> {
  const out: VideoInfo[] = [];
  for (const c of chunks([...new Set(ids)], 50)) {
    const r = await call<any>("videos", { part: "snippet,statistics,contentDetails", id: c.join(","), maxResults: 50 }, tracker);
    for (const v of r.items ?? []) {
      out.push({
        id: v.id,
        title: v.snippet.title,
        description: v.snippet.description,
        thumbnailUrl: bestThumb(v.snippet.thumbnails),
        publishedAt: v.snippet.publishedAt,
        viewCount: num(v.statistics?.viewCount),
        likeCount: num(v.statistics?.likeCount),
        commentCount: num(v.statistics?.commentCount),
        durationSec: parseDuration(v.contentDetails?.duration),
        defaultAudioLanguage: v.snippet.defaultAudioLanguage ?? v.snippet.defaultLanguage ?? null,
        tags: v.snippet.tags ?? [],
      });
    }
  }
  return out;
}

function mapChannel(c: any): ChannelInfo {
  return {
    id: c.id,
    title: c.snippet.title,
    description: c.snippet.description ?? "",
    customUrl: c.snippet.customUrl ?? null,
    thumbnailUrl: bestThumb(c.snippet.thumbnails),
    country: c.snippet.country ?? null,
    defaultLanguage: c.snippet.defaultLanguage ?? null,
    publishedAt: c.snippet.publishedAt,
    subscriberCount: c.statistics?.hiddenSubscriberCount ? null : num(c.statistics?.subscriberCount),
    subscribersHidden: !!c.statistics?.hiddenSubscriberCount,
    viewCount: Number(c.statistics?.viewCount ?? 0),
    videoCount: Number(c.statistics?.videoCount ?? 0),
    uploadsPlaylistId: c.contentDetails?.relatedPlaylists?.uploads ?? null,
  };
}

export async function getChannels(ids: string[], tracker?: Tracker): Promise<ChannelInfo[]> {
  const out: ChannelInfo[] = [];
  for (const c of chunks([...new Set(ids)], 50)) {
    const r = await call<any>("channels", { part: "snippet,statistics,contentDetails", id: c.join(","), maxResults: 50 }, tracker);
    out.push(...(r.items ?? []).map(mapChannel));
  }
  await cacheChannels(out);
  return out;
}

export async function getChannelBy(
  by: { id?: string; handle?: string; username?: string },
  tracker?: Tracker,
): Promise<ChannelInfo | null> {
  const r = await call<any>(
    "channels",
    { part: "snippet,statistics,contentDetails", id: by.id, forHandle: by.handle, forUsername: by.username },
    tracker,
  );
  const c = r.items?.[0];
  if (!c) return null;
  const ch = mapChannel(c);
  await cacheChannels([ch]);
  return ch;
}

/** Últimas subidas del canal (playlist "uploads"). */
export async function getUploads(playlistId: string, max = 50, tracker?: Tracker): Promise<string[]> {
  const ids: string[] = [];
  let pageToken: string | undefined;
  while (ids.length < max) {
    const r = await call<any>(
      "playlistItems",
      { part: "contentDetails", playlistId, maxResults: Math.min(50, max - ids.length), pageToken },
      tracker,
    );
    for (const i of r.items ?? []) ids.push(i.contentDetails.videoId);
    pageToken = r.nextPageToken;
    if (!pageToken) break;
  }
  return ids;
}

async function cacheChannels(chs: ChannelInfo[]) {
  if (!chs.length) return;
  try {
    const db = sql();
    for (const c of chs) {
      await db`insert into channels (id, title, description, custom_url, thumbnail_url, country, default_language,
          published_at, subscriber_count, subscribers_hidden, view_count, video_count, uploads_playlist_id, fetched_at)
        values (${c.id}, ${c.title}, ${c.description}, ${c.customUrl}, ${c.thumbnailUrl}, ${c.country}, ${c.defaultLanguage},
          ${c.publishedAt}, ${c.subscriberCount}, ${c.subscribersHidden}, ${c.viewCount}, ${c.videoCount}, ${c.uploadsPlaylistId}, now())
        on conflict (id) do update set title = excluded.title, description = excluded.description, custom_url = excluded.custom_url,
          thumbnail_url = excluded.thumbnail_url, country = excluded.country, default_language = excluded.default_language,
          subscriber_count = excluded.subscriber_count, subscribers_hidden = excluded.subscribers_hidden,
          view_count = excluded.view_count, video_count = excluded.video_count,
          uploads_playlist_id = excluded.uploads_playlist_id, fetched_at = now()`;
    }
  } catch {
    /* BD no disponible: no bloquea */
  }
}

/** Interpreta cualquier URL/identificador de canal de YouTube. */
export function parseChannelInput(input: string):
  | { kind: "id"; value: string }
  | { kind: "handle"; value: string }
  | { kind: "username"; value: string }
  | { kind: "custom"; value: string }
  | { kind: "video"; value: string }
  | null {
  const s = input.trim();
  if (/^UC[\w-]{22}$/.test(s)) return { kind: "id", value: s };
  if (/^@[\w.\-·]+$/.test(s)) return { kind: "handle", value: s };
  let u: URL;
  try {
    u = new URL(/^https?:\/\//.test(s) ? s : `https://${s}`);
  } catch {
    return null;
  }
  if (!/(^|\.)youtube\.com$|(^|\.)youtu\.be$/.test(u.hostname)) return null;
  if (u.hostname.endsWith("youtu.be")) return { kind: "video", value: u.pathname.slice(1) };
  const parts = u.pathname.split("/").filter(Boolean).map(decodeURIComponent);
  if (parts[0] === "channel" && parts[1]) return { kind: "id", value: parts[1] };
  if (parts[0]?.startsWith("@")) return { kind: "handle", value: parts[0] };
  if (parts[0] === "user" && parts[1]) return { kind: "username", value: parts[1] };
  if (parts[0] === "c" && parts[1]) return { kind: "custom", value: parts[1] };
  if (parts[0] === "watch" && u.searchParams.get("v")) return { kind: "video", value: u.searchParams.get("v")! };
  if (parts[0] === "shorts" && parts[1]) return { kind: "video", value: parts[1] };
  return null;
}

export async function resolveChannel(input: string, tracker?: Tracker): Promise<ChannelInfo | null> {
  const p = parseChannelInput(input);
  if (!p) return null;
  if (p.kind === "id") return getChannelBy({ id: p.value }, tracker);
  if (p.kind === "handle") return getChannelBy({ handle: p.value }, tracker);
  if (p.kind === "username") return getChannelBy({ username: p.value }, tracker);
  if (p.kind === "video") {
    const [v] = await call<any>("videos", { part: "snippet", id: p.value }, tracker).then((r) => r.items ?? []);
    return v ? getChannelBy({ id: v.snippet.channelId }, tracker) : null;
  }
  // URLs /c/Nombre antiguas: probar como handle; no hay endpoint oficial directo.
  return getChannelBy({ handle: `@${p.value}` }, tracker);
}
