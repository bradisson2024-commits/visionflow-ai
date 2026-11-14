"""PASO 1-2: encontrar los vídeos que más funcionan en cada nicho.

Usa la YouTube Data API v3 oficial (datos reales). Nunca inventa cifras: si
no hay clave de API, lanza MissingCredential.

Coste de cuota por ejecución y canal: 100 unidades por consulta de búsqueda
+ 1 por cada llamada a videos.list / channels.list (cuota diaria por defecto:
10.000 unidades).
"""
from __future__ import annotations

import json
import re
from datetime import datetime, timedelta, timezone
from pathlib import Path

import requests

from .config import Settings, channel_dir, require_env

API = "https://www.googleapis.com/youtube/v3"
HOW_KEY = ("Créala en https://console.cloud.google.com → APIs y servicios → "
           "habilita 'YouTube Data API v3' → Credenciales → Crear clave de API.")


class YouTubeAPIError(RuntimeError):
    pass


def _get(session: requests.Session, endpoint: str, params: dict) -> dict:
    r = session.get(f"{API}/{endpoint}", params=params, timeout=30)
    if r.status_code != 200:
        try:
            msg = r.json()["error"]["message"]
        except Exception:
            msg = r.text[:300]
        raise YouTubeAPIError(f"{endpoint} HTTP {r.status_code}: {msg}")
    return r.json()


def parse_iso_duration(value: str) -> int:
    m = re.fullmatch(r"P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?", value or "")
    if not m:
        return 0
    d, h, mi, s = (int(x or 0) for x in m.groups())
    return d * 86400 + h * 3600 + mi * 60 + s


def _chunks(seq, n):
    for i in range(0, len(seq), n):
        yield seq[i:i + n]


def find_top_videos(settings: Settings, channel: dict, days: int = 30, per_query: int = 25,
                    video_duration: str = "any", session: requests.Session | None = None,
                    now: datetime | None = None) -> list[dict]:
    """Busca vídeos recientes del nicho y los ordena por visitas/día."""
    key = require_env("YOUTUBE_API_KEY", HOW_KEY)
    session = session or requests.Session()
    now = now or datetime.now(timezone.utc)
    published_after = (now - timedelta(days=days)).strftime("%Y-%m-%dT%H:%M:%SZ")

    ids: dict[str, str] = {}
    for q in channel["research_queries"]:
        data = _get(session, "search", {
            "key": key, "part": "snippet", "type": "video", "q": q, "order": "viewCount",
            "publishedAfter": published_after, "maxResults": min(per_query, 50),
            "regionCode": settings.region_code, "relevanceLanguage": settings.language,
            "videoDuration": video_duration,
        })
        for item in data.get("items", []):
            vid = item.get("id", {}).get("videoId")
            if vid and vid not in ids:
                ids[vid] = q
    if not ids:
        return []

    videos = []
    for batch in _chunks(list(ids), 50):
        data = _get(session, "videos", {"key": key, "part": "snippet,statistics,contentDetails",
                                         "id": ",".join(batch)})
        videos.extend(data.get("items", []))

    channel_ids = sorted({v["snippet"]["channelId"] for v in videos})
    subs: dict[str, int | None] = {}
    for batch in _chunks(channel_ids, 50):
        data = _get(session, "channels", {"key": key, "part": "statistics", "id": ",".join(batch)})
        for c in data.get("items", []):
            st = c.get("statistics", {})
            subs[c["id"]] = None if st.get("hiddenSubscriberCount") else int(st.get("subscriberCount", 0))

    results = []
    for v in videos:
        sn, st = v["snippet"], v.get("statistics", {})
        published = datetime.fromisoformat(sn["publishedAt"].replace("Z", "+00:00"))
        age_days = max((now - published).total_seconds() / 86400, 0.5)
        views = int(st.get("viewCount", 0))
        ch_subs = subs.get(sn["channelId"])
        duration = parse_iso_duration(v["contentDetails"].get("duration", ""))
        results.append({
            "video_id": v["id"],
            "url": f"https://www.youtube.com/watch?v={v['id']}",
            "title": sn["title"],
            "description": sn.get("description", "")[:500],
            "tags": sn.get("tags", [])[:15],
            "channel_title": sn["channelTitle"],
            "channel_id": sn["channelId"],
            "published_at": sn["publishedAt"],
            "duration_s": duration,
            "is_short_length": duration <= 180,
            "views": views,
            "likes": int(st["likeCount"]) if "likeCount" in st else None,
            "comments": int(st["commentCount"]) if "commentCount" in st else None,
            "views_per_day": round(views / age_days),
            "channel_subscribers": ch_subs,
            "outlier_ratio": round(views / ch_subs, 2) if ch_subs else None,
            "matched_query": ids[v["id"]],
        })
    results.sort(key=lambda r: r["views_per_day"], reverse=True)
    return results


def save_report(channel: dict, results: list[dict], top: int = 20) -> tuple[Path, Path]:
    stamp = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    out = channel_dir(channel["key"], "research")
    jpath = out / f"{stamp}.json"
    jpath.write_text(json.dumps({"channel": channel["key"], "fetched_at": stamp,
                                 "source": "YouTube Data API v3", "videos": results},
                                ensure_ascii=False, indent=2), encoding="utf-8")
    lines = [f"# Investigación {channel['name']} ({channel['niche']}) — {stamp}",
             "", "Fuente: YouTube Data API v3. Orden: visitas por día desde la publicación.", "",
             "| # | Título | Canal | Visitas | Visitas/día | Ratio vs subs | Duración |",
             "|---|---|---|---:|---:|---:|---:|"]
    for i, r in enumerate(results[:top], 1):
        title = r["title"].replace("|", "/")
        lines.append(f"| {i} | [{title}]({r['url']}) | {r['channel_title']} | {r['views']:,} | "
                     f"{r['views_per_day']:,} | {r['outlier_ratio'] if r['outlier_ratio'] is not None else '—'} | "
                     f"{r['duration_s']}s |")
    mpath = out / f"{stamp}.md"
    mpath.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return jpath, mpath


def latest_report(channel_key: str) -> dict | None:
    files = sorted(channel_dir(channel_key, "research").glob("*.json"))
    return json.loads(files[-1].read_text(encoding="utf-8")) if files else None
