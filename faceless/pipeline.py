"""Orquestación por hueco del calendario: guion → voz → imágenes → subtítulos → vídeo → subida."""
from __future__ import annotations

import json
from pathlib import Path

from . import assemble, images, research, scriptgen, state, subtitles, tts, uploader
from .config import Settings, channel_dir

GAP = 0.25


def step_script(settings: Settings, sid: str, top_refs: int = 15) -> dict:
    slot = state.get_slot(sid)
    channel = settings.channel(slot["channel"])
    report = research.latest_report(channel["key"])
    if not report or not report["videos"]:
        raise RuntimeError(f"No hay investigación para {channel['key']}. Ejecuta: "
                           f"python -m faceless research --channel {channel['key']}")
    refs = report["videos"][:top_refs]
    script = scriptgen.generate_script(channel, refs)
    script["research_file"] = report["fetched_at"]
    path = scriptgen.save_script(channel["key"], sid, script)
    return state.advance(sid, "scripted", {"script_path": str(path)})


def step_import_script(settings: Settings, sid: str, file: Path) -> dict:
    slot = state.get_slot(sid)
    channel = settings.channel(slot["channel"])
    script = json.loads(Path(file).read_text(encoding="utf-8"))
    report = research.latest_report(channel["key"])
    scriptgen.validate_script(script, channel.get("target_words"), report["videos"][:15] if report else None)
    path = scriptgen.save_script(channel["key"], sid, script)
    return state.advance(sid, "scripted", {"script_path": str(path)})


def step_produce(settings: Settings, sid: str, music: Path | None = None) -> dict:
    slot = state.get_slot(sid)
    if slot["status"] == "planned":
        raise RuntimeError(f"{sid} no tiene guion todavía")
    channel = settings.channel(slot["channel"])
    script = json.loads(Path(slot["artifacts"]["script_path"]).read_text(encoding="utf-8"))
    v = settings.video
    w, h, fps = v["width"], v["height"], v["fps"]
    work = channel_dir(channel["key"], "build", sid)
    texts = [s["text"] for s in script["scenes"]]

    wavs, durs, engine = tts.synthesize_scenes(texts, work / "voice", channel.get("tts", {}))
    voice = tts.concat_audio(wavs, work / "voice.wav", GAP)
    state.advance(sid, "voiced", {"voice_path": str(voice), "tts_engine": engine})

    imgs, credits = images.fetch_scene_images(channel, [s["image_query"] for s in script["scenes"]],
                                              work / "images", (w, h))
    cues = subtitles.build_cues(texts, durs, GAP)
    srt = subtitles.write_srt(cues, work / "subtitles.srt")
    ass = subtitles.write_ass(cues, work / "subtitles.ass", w, h, (channel.get("palette") or ["", "", "#FFD400"])[2])
    out = channel_dir(channel["key"], "videos") / f"{sid}.mp4"
    assemble.assemble_video(imgs, durs, voice, ass, out, w, h, fps, GAP, music)
    (work / "credits.json").write_text(json.dumps(credits, ensure_ascii=False, indent=2), encoding="utf-8")
    return state.advance(sid, "rendered", {"video_path": str(out), "srt_path": str(srt),
                                           "image_sources": sorted({c["source"] for c in credits})})


def step_upload(settings: Settings, sid: str, captions: bool = False) -> dict:
    slot = state.get_slot(sid)
    if slot["status"] != "rendered":
        raise RuntimeError(f"{sid} está en estado '{slot['status']}', debe estar 'rendered'")
    channel = settings.channel(slot["channel"])
    script = json.loads(Path(slot["artifacts"]["script_path"]).read_text(encoding="utf-8"))
    body = uploader.build_body(script, channel, slot["publish_at_utc"], settings.language,
                               synthetic=bool(channel.get("contains_synthetic_media", False)))
    res = uploader.upload_and_schedule(channel, Path(slot["artifacts"]["video_path"]), body,
                                       Path(slot["artifacts"]["srt_path"]) if captions else None)
    if not res.get("video_id"):
        raise RuntimeError(f"YouTube no devolvió ID de vídeo: {res}")
    return state.advance(sid, "scheduled", {"youtube": res})


def run_slot(settings: Settings, sid: str, upload: bool = True) -> dict:
    slot = state.get_slot(sid)
    if slot["status"] == "planned":
        slot = step_script(settings, sid)
    if slot["status"] in ("scripted", "voiced"):
        slot = step_produce(settings, sid)
    if upload and slot["status"] == "rendered":
        slot = step_upload(settings, sid)
    return slot
