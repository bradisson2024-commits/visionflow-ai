"""Prueba REAL de producción: voz (espeak-ng), imágenes, subtítulos y ffmpeg."""
import shutil

import pytest

from faceless import assemble, images, media, subtitles, tts

pytestmark = pytest.mark.skipif(not (shutil.which("ffmpeg") and shutil.which("espeak-ng")),
                                reason="requiere ffmpeg y espeak-ng")


def test_full_render(tmp_path, data_dir, monkeypatch):
    monkeypatch.delenv("PEXELS_API_KEY", raising=False)
    texts = ["Esto es una prueba.", "Segunda escena del vídeo."]
    wavs, durs, engine = tts.synthesize_scenes(texts, tmp_path / "v", {"engine": "espeak"})
    assert engine == "espeak" and all(d > 0.5 for d in durs)
    audio = tts.concat_audio(wavs, tmp_path / "voice.wav")
    ch = {"key": "test", "name": "TEST", "palette": ["#000000", "#222222", "#ffffff"]}
    imgs, credits = images.fetch_scene_images(ch, ["a", "b"], tmp_path / "img", (360, 640))
    assert [c["source"] for c in credits] == ["generated", "generated"]
    cues = subtitles.build_cues(texts, durs)
    ass = subtitles.write_ass(cues, tmp_path / "s.ass", 360, 640)
    out = assemble.assemble_video(imgs, durs, audio, ass, tmp_path / "out.mp4", 360, 640, 24)
    info = media.probe(out)
    kinds = {s["codec_type"] for s in info["streams"]}
    assert kinds == {"video", "audio"}
    v = next(s for s in info["streams"] if s["codec_type"] == "video")
    assert (v["width"], v["height"]) == (360, 640)
    assert abs(float(info["format"]["duration"]) - media.duration(audio)) < 0.3
