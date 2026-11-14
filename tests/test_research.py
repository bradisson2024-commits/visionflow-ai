"""Prueba la lógica de investigación con respuestas SIMULADAS de la API
(mismo formato JSON que la YouTube Data API v3). No son datos reales."""
from datetime import datetime, timezone

import pytest

from faceless import research
from faceless.config import MissingCredential


class FakeResp:
    def __init__(self, data, code=200):
        self._d, self.status_code, self.text = data, code, str(data)

    def json(self):
        return self._d


class FakeSession:
    def __init__(self):
        self.calls = []

    def get(self, url, params=None, timeout=None):
        ep = url.rsplit("/", 1)[-1]
        self.calls.append((ep, params))
        if ep == "search":
            return FakeResp({"items": [{"id": {"videoId": "A"}}, {"id": {"videoId": "B"}}]})
        if ep == "videos":
            mk = lambda vid, ch, views, pub, dur: {"id": vid, "snippet": {
                "title": f"t{vid}", "channelId": ch, "channelTitle": ch, "publishedAt": pub},
                "statistics": {"viewCount": str(views), "likeCount": "10"},
                "contentDetails": {"duration": dur}}
            return FakeResp({"items": [mk("A", "c1", 1000, "2026-11-04T00:00:00Z", "PT59S"),
                                       mk("B", "c2", 900, "2026-11-13T00:00:00Z", "PT12M3S")]})
        if ep == "channels":
            return FakeResp({"items": [{"id": "c1", "statistics": {"subscriberCount": "100"}},
                                       {"id": "c2", "statistics": {"hiddenSubscriberCount": True}}]})
        raise AssertionError(ep)


def test_requires_key(monkeypatch, settings):
    monkeypatch.delenv("YOUTUBE_API_KEY", raising=False)
    with pytest.raises(MissingCredential):
        research.find_top_videos(settings, settings.channel("caso_abierto"))


def test_ranks_by_views_per_day(monkeypatch, settings, data_dir):
    monkeypatch.setenv("YOUTUBE_API_KEY", "k")
    s = FakeSession()
    now = datetime(2026, 11, 14, tzinfo=timezone.utc)
    res = research.find_top_videos(settings, settings.channel("caso_abierto"), session=s, now=now)
    assert [r["video_id"] for r in res] == ["B", "A"]   # 900/1 día > 1000/10 días
    assert res[0]["views_per_day"] == 900 and res[1]["views_per_day"] == 100
    assert res[1]["outlier_ratio"] == 10.0 and res[0]["outlier_ratio"] is None
    assert res[0]["duration_s"] == 723 and res[1]["is_short_length"]
    search_calls = [p for ep, p in s.calls if ep == "search"]
    assert len(search_calls) == 4 and search_calls[0]["order"] == "viewCount"
    assert search_calls[0]["publishedAfter"] == "2026-10-15T00:00:00Z"
    j, m = research.save_report(settings.channel("caso_abierto"), res)
    assert j.exists() and "Visitas/día" in m.read_text()
    assert research.latest_report("caso_abierto")["videos"][0]["video_id"] == "B"


def test_api_error_is_reported(monkeypatch, settings):
    monkeypatch.setenv("YOUTUBE_API_KEY", "k")

    class Bad:
        def get(self, *a, **k):
            return FakeResp({"error": {"message": "quotaExceeded"}}, 403)
    with pytest.raises(research.YouTubeAPIError, match="quotaExceeded"):
        research.find_top_videos(settings, settings.channel("caso_abierto"), session=Bad())


def test_iso_duration():
    assert research.parse_iso_duration("PT1H2M3S") == 3723
    assert research.parse_iso_duration("P1DT1S") == 86401
