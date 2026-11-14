"""Lógica de subida con un cliente de YouTube SIMULADO (no sube nada real)."""
import pytest

from faceless import uploader
from faceless.config import MissingCredential

SCRIPT = {"title": "T", "description": "D", "tags": ["a", "b"]}


def test_body_is_private_with_publish_at(settings):
    body = uploader.build_body(SCRIPT, settings.channel("caso_abierto"), "2099-01-01T20:00:00Z")
    assert body["status"]["privacyStatus"] == "private"
    assert body["status"]["publishAt"] == "2099-01-01T20:00:00Z"
    assert body["snippet"]["categoryId"] == "24" and "misterio" in body["snippet"]["tags"]


def test_body_rejects_past_date(settings):
    with pytest.raises(ValueError):
        uploader.build_body(SCRIPT, settings.channel("caso_abierto"), "2020-01-01T00:00:00Z")


class Exec:
    def __init__(self, v):
        self.v = v

    def execute(self):
        return self.v


class FakeInsert:
    def __init__(self, body):
        self.body = body

    def next_chunk(self):
        return None, {"id": "VID123", "status": {"privacyStatus": "private",
                                                 "publishAt": self.body["status"]["publishAt"], "uploadStatus": "uploaded"}}


class FakeYT:
    def __init__(self, channel_id):
        self.cid, self.inserted = channel_id, []

    def channels(self):
        return self

    def list(self, **k):
        return Exec({"items": [{"id": self.cid, "snippet": {"title": "Canal"}}]})

    def videos(self):
        return self

    def insert(self, part, body, media_body):
        self.inserted.append(body)
        return FakeInsert(body)


def test_upload_checks_channel_identity(settings, tmp_path):
    video = tmp_path / "v.mp4"
    video.write_bytes(b"\x00" * 10)
    ch = {**settings.channel("caso_abierto"), "youtube_channel_id": "UC_OK"}
    body = uploader.build_body(SCRIPT, ch, "2099-01-01T20:00:00Z")
    with pytest.raises(RuntimeError, match="no de UC_OK"):
        uploader.upload_and_schedule(ch, video, body, service=FakeYT("UC_OTHER"))
    yt = FakeYT("UC_OK")
    res = uploader.upload_and_schedule(ch, video, body, service=yt)
    assert res["video_id"] == "VID123" and res["publish_at"] == "2099-01-01T20:00:00Z"
    assert len(yt.inserted) == 1


def test_upload_requires_channel_id(settings, tmp_path):
    video = tmp_path / "v.mp4"
    video.write_bytes(b"\x00")
    body = uploader.build_body(SCRIPT, settings.channel("caso_abierto"), "2099-01-01T20:00:00Z")
    with pytest.raises(MissingCredential):
        uploader.upload_and_schedule(settings.channel("caso_abierto"), video, body, service=FakeYT("X"))
