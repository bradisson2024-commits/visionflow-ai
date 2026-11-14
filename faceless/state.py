"""Calendario y estado de cada publicación.

Cada hueco del calendario solo avanza de estado cuando el paso correspondiente
se ha ejecutado de verdad y su resultado existe (archivo en disco o ID devuelto
por YouTube). Nada se marca como hecho de forma optimista.
"""
from __future__ import annotations

import json
from datetime import date, datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

from .config import DATA_DIR, Settings

STATUSES = ["planned", "scripted", "voiced", "rendered", "scheduled"]
CALENDAR_PATH = DATA_DIR / "calendar.json"


def _load(path: Path = None) -> dict:
    path = path or CALENDAR_PATH
    if path.exists():
        return json.loads(path.read_text(encoding="utf-8"))
    return {"slots": {}}


def _save(cal: dict, path: Path = None) -> None:
    path = path or CALENDAR_PATH
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(cal, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp.replace(path)


def slot_id(channel_key: str, day: date) -> str:
    return f"{day.isoformat()}_{channel_key}"


def publish_at_utc(settings: Settings, channel: dict, day: date) -> str:
    hh, mm = (int(x) for x in channel["publish_time"].split(":"))
    local = datetime(day.year, day.month, day.day, hh, mm, tzinfo=ZoneInfo(settings.timezone))
    return local.astimezone(ZoneInfo("UTC")).strftime("%Y-%m-%dT%H:%M:%SZ")


def plan_week(settings: Settings, start: date, days: int = 7, path: Path = None) -> list[dict]:
    """Crea 1 hueco diario por canal. No sobrescribe huecos ya existentes."""
    cal = _load(path)
    created = []
    for i in range(days):
        day = start + timedelta(days=i)
        for key, ch in settings.channels.items():
            sid = slot_id(key, day)
            if sid in cal["slots"]:
                continue
            slot = {
                "id": sid,
                "channel": key,
                "date": day.isoformat(),
                "publish_local": f"{day.isoformat()} {ch['publish_time']} ({settings.timezone})",
                "publish_at_utc": publish_at_utc(settings, {**ch}, day),
                "status": "planned",
                "artifacts": {},
                "history": [],
            }
            cal["slots"][sid] = slot
            created.append(slot)
    _save(cal, path)
    return created


def get_slot(sid: str, path: Path = None) -> dict:
    cal = _load(path)
    if sid not in cal["slots"]:
        raise KeyError(f"No existe el hueco {sid}. Ejecuta primero 'plan-week'.")
    return cal["slots"][sid]


def list_slots(path: Path = None, channel: str | None = None, day: str | None = None) -> list[dict]:
    slots = sorted(_load(path)["slots"].values(), key=lambda s: (s["date"], s["publish_at_utc"]))
    if channel:
        slots = [s for s in slots if s["channel"] == channel]
    if day:
        slots = [s for s in slots if s["date"] == day]
    return slots


def advance(sid: str, status: str, artifacts: dict, path: Path = None) -> dict:
    """Marca un paso como hecho. Verifica que los archivos declarados existen."""
    if status not in STATUSES:
        raise ValueError(status)
    for name, value in artifacts.items():
        if name.endswith("_path") and not Path(value).is_file():
            raise RuntimeError(f"No se puede marcar '{status}': {value} no existe")
    cal = _load(path)
    slot = cal["slots"][sid]
    if STATUSES.index(status) > STATUSES.index(slot["status"]):
        slot["status"] = status
    slot["artifacts"].update(artifacts)
    slot["history"].append({"status": status, "at": datetime.now(ZoneInfo("UTC")).isoformat()})
    _save(cal, path)
    return slot
