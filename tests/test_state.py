from datetime import date

import pytest

from faceless import state


def test_plan_week_creates_one_per_channel_per_day(tmp_path, settings):
    cal = tmp_path / "cal.json"
    created = state.plan_week(settings, date(2026, 11, 16), 7, cal)
    assert len(created) == 21
    assert {s["channel"] for s in created} == set(settings.channels)
    for ch in settings.channels:
        assert len([s for s in created if s["channel"] == ch]) == 7
    # no duplica al re-ejecutar
    assert state.plan_week(settings, date(2026, 11, 16), 7, cal) == []


def test_publish_time_respects_timezone_and_dst(settings):
    ch = settings.channel("curiosidad_total")  # 13:00 Europe/Madrid
    assert state.publish_at_utc(settings, ch, date(2026, 11, 16)) == "2026-11-16T12:00:00Z"  # CET
    assert state.publish_at_utc(settings, ch, date(2026, 7, 16)) == "2026-07-16T11:00:00Z"   # CEST


def test_advance_refuses_missing_files(tmp_path, settings):
    cal = tmp_path / "cal.json"
    state.plan_week(settings, date(2026, 11, 16), 1, cal)
    sid = "2026-11-16_caso_abierto"
    with pytest.raises(RuntimeError):
        state.advance(sid, "rendered", {"video_path": str(tmp_path / "nope.mp4")}, cal)
    assert state.get_slot(sid, cal)["status"] == "planned"
    f = tmp_path / "v.mp4"
    f.write_bytes(b"x")
    assert state.advance(sid, "rendered", {"video_path": str(f)}, cal)["status"] == "rendered"
