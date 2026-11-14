"""Carga de configuración y rutas del proyecto."""
from __future__ import annotations

import json
import os
from dataclasses import dataclass
from pathlib import Path

try:
    from dotenv import load_dotenv
except ImportError:  # pragma: no cover
    load_dotenv = None

ROOT = Path(__file__).resolve().parent.parent
if load_dotenv:
    load_dotenv(ROOT / ".env")

DATA_DIR = Path(os.environ.get("FACELESS_DATA_DIR", ROOT / "data"))
CRED_DIR = Path(os.environ.get("FACELESS_CRED_DIR", ROOT / "credentials"))
CONFIG_PATH = Path(os.environ.get("FACELESS_CONFIG", ROOT / "config" / "channels.json"))


class MissingCredential(RuntimeError):
    """Falta una clave o cuenta externa. El mensaje explica qué conectar."""


def require_env(name: str, how: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        raise MissingCredential(f"Falta la variable {name} en .env. {how}")
    return value


@dataclass
class Settings:
    raw: dict

    @property
    def timezone(self) -> str:
        return self.raw.get("timezone", "UTC")

    @property
    def region_code(self) -> str:
        return self.raw.get("region_code", "ES")

    @property
    def language(self) -> str:
        return self.raw.get("language", "es")

    @property
    def video(self) -> dict:
        return self.raw.get("video", {"width": 1080, "height": 1920, "fps": 30})

    @property
    def channels(self) -> dict:
        return self.raw["channels"]

    def channel(self, key: str) -> dict:
        if key not in self.channels:
            raise KeyError(f"Canal desconocido '{key}'. Opciones: {', '.join(self.channels)}")
        return {"key": key, **self.channels[key]}


def load_settings(path: Path | None = None) -> Settings:
    with open(path or CONFIG_PATH, encoding="utf-8") as f:
        return Settings(json.load(f))


def channel_dir(channel_key: str, *parts: str) -> Path:
    p = DATA_DIR / channel_key
    for part in parts:
        p = p / part
    p.mkdir(parents=True, exist_ok=True)
    return p
