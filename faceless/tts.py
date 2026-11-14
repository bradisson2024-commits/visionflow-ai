"""PASO 3a: voz con IA.

Motores (por orden en modo 'auto'):
  elevenlabs — voz neuronal premium (ELEVENLABS_API_KEY + voice_id del canal)
  edge       — voces neuronales de Microsoft Edge vía 'edge-tts' (gratis, requiere internet)
  espeak     — espeak-ng local (sin internet; voz robótica, útil para pruebas)
Cada escena se sintetiza por separado y se mide su duración real para
sincronizar imágenes y subtítulos.
"""
from __future__ import annotations

import asyncio
import os
import shutil
from pathlib import Path

import requests

from .media import duration, require_bin, run

ENGINES = ("elevenlabs", "edge", "espeak")


def _to_wav(src: Path, dst: Path) -> None:
    run([require_bin("ffmpeg"), "-y", "-i", str(src), "-ar", "44100", "-ac", "1", str(dst)])


def _elevenlabs(text: str, out: Path, cfg: dict) -> None:
    key = os.environ.get("ELEVENLABS_API_KEY", "").strip()
    voice = cfg.get("elevenlabs_voice_id", "").strip()
    if not key or not voice:
        raise RuntimeError("ElevenLabs necesita ELEVENLABS_API_KEY en .env y 'elevenlabs_voice_id' en el canal")
    r = requests.post(f"https://api.elevenlabs.io/v1/text-to-speech/{voice}",
                      headers={"xi-api-key": key, "accept": "audio/mpeg"},
                      json={"text": text, "model_id": cfg.get("elevenlabs_model", "eleven_multilingual_v2")},
                      timeout=120)
    if r.status_code != 200:
        raise RuntimeError(f"ElevenLabs HTTP {r.status_code}: {r.text[:200]}")
    mp3 = out.with_suffix(".mp3")
    mp3.write_bytes(r.content)
    _to_wav(mp3, out)
    mp3.unlink()


def _edge(text: str, out: Path, cfg: dict) -> None:
    import edge_tts  # noqa: import tardío: dependencia opcional

    mp3 = out.with_suffix(".mp3")

    async def go():
        await edge_tts.Communicate(text, cfg.get("edge_voice", "es-ES-AlvaroNeural"),
                                   rate=cfg.get("edge_rate", "+5%")).save(str(mp3))
    asyncio.run(go())
    if not mp3.exists() or mp3.stat().st_size == 0:
        raise RuntimeError("edge-tts no devolvió audio")
    _to_wav(mp3, out)
    mp3.unlink()


def _espeak(text: str, out: Path, cfg: dict) -> None:
    exe = shutil.which("espeak-ng") or shutil.which("espeak")
    if not exe:
        raise RuntimeError("espeak-ng no está instalado ('apt install espeak-ng')")
    raw = out.with_name(out.stem + "_raw.wav")
    run([exe, "-v", cfg.get("espeak_voice", "es"), "-s", str(cfg.get("espeak_speed", 165)), "-w", str(raw), text])
    _to_wav(raw, out)
    raw.unlink()


_FUNCS = {"elevenlabs": _elevenlabs, "edge": _edge, "espeak": _espeak}


def available_engines(cfg: dict) -> list[str]:
    order = []
    if os.environ.get("ELEVENLABS_API_KEY") and cfg.get("elevenlabs_voice_id"):
        order.append("elevenlabs")
    order.append("edge")
    if shutil.which("espeak-ng") or shutil.which("espeak"):
        order.append("espeak")
    return order


def synthesize_scenes(texts: list[str], out_dir: Path, cfg: dict) -> tuple[list[Path], list[float], str]:
    """Devuelve (wavs, duraciones, motor_usado). Un mismo motor para todas las escenas."""
    out_dir.mkdir(parents=True, exist_ok=True)
    engine = cfg.get("engine", "auto")
    candidates = available_engines(cfg) if engine == "auto" else [engine]
    errors = []
    for name in candidates:
        if name not in _FUNCS:
            raise ValueError(f"Motor TTS desconocido: {name}")
        try:
            wavs, durs = [], []
            for i, text in enumerate(texts):
                wav = out_dir / f"scene_{i:02d}.wav"
                _FUNCS[name](text, wav, cfg)
                wavs.append(wav)
                durs.append(duration(wav))
            return wavs, durs, name
        except Exception as e:  # probar el siguiente motor
            errors.append(f"{name}: {e}")
    raise RuntimeError("Ningún motor de voz funcionó:\n  " + "\n  ".join(errors))


def concat_audio(wavs: list[Path], out: Path, gap: float = 0.25) -> Path:
    """Une las escenas con una pequeña pausa entre ellas."""
    ff = require_bin("ffmpeg")
    inputs, filters = [], []
    for i, w in enumerate(wavs):
        inputs += ["-i", str(w)]
        filters.append(f"[{i}:a]apad=pad_dur={gap}[a{i}]")
    chain = ";".join(filters) + ";" + "".join(f"[a{i}]" for i in range(len(wavs))) + \
        f"concat=n={len(wavs)}:v=0:a=1,loudnorm=I=-14:TP=-1.5:LRA=11[out]"
    run([ff, "-y", *inputs, "-filter_complex", chain, "-map", "[out]", "-ar", "44100", "-ac", "2", str(out)])
    return out
