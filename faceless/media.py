"""Utilidades ffmpeg/ffprobe."""
from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path


def require_bin(name: str) -> str:
    path = shutil.which(name)
    if not path:
        raise RuntimeError(f"No se encuentra '{name}'. Instálalo (p. ej. 'apt install ffmpeg').")
    return path


def run(cmd: list[str]) -> None:
    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0:
        raise RuntimeError(f"Falló: {' '.join(cmd[:6])}...\n{proc.stderr[-1500:]}")


def probe(path: Path) -> dict:
    out = subprocess.run([require_bin("ffprobe"), "-v", "error", "-print_format", "json",
                          "-show_format", "-show_streams", str(path)],
                         capture_output=True, text=True, check=True).stdout
    return json.loads(out)


def duration(path: Path) -> float:
    return float(probe(path)["format"]["duration"])
