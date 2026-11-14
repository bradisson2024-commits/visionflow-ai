"""Interfaz de línea de comandos: python -m faceless <comando>."""
from __future__ import annotations

import argparse
import json
import os
import shutil
import sys
from datetime import date, timedelta
from pathlib import Path

from . import pipeline, research, state, uploader
from .config import DATA_DIR, MissingCredential, load_settings


def _channels(settings, value):
    return list(settings.channels) if value in (None, "all") else [value]


def cmd_doctor(settings, args):
    checks = [
        ("ffmpeg", bool(shutil.which("ffmpeg")), "Montaje de vídeo (obligatorio)"),
        ("espeak-ng", bool(shutil.which("espeak-ng")), "Voz local de respaldo (opcional)"),
        ("YOUTUBE_API_KEY", bool(os.environ.get("YOUTUBE_API_KEY")), "Paso 1: investigación de nichos"),
        ("ANTHROPIC_API_KEY", bool(os.environ.get("ANTHROPIC_API_KEY")), "Paso 2: guiones con IA"),
        ("PEXELS_API_KEY", bool(os.environ.get("PEXELS_API_KEY")), "Paso 3: fotos de stock (si no, tarjetas generadas)"),
        ("ELEVENLABS_API_KEY", bool(os.environ.get("ELEVENLABS_API_KEY")), "Paso 3: voz premium (si no, edge-tts)"),
    ]
    try:
        uploader.client_secrets()
        checks.append(("client_secret.json", True, "Paso 4: OAuth de YouTube"))
    except MissingCredential:
        checks.append(("client_secret.json", False, "Paso 4: OAuth de YouTube"))
    for key, ch in settings.channels.items():
        checks.append((f"token {key}", uploader.token_path(key).is_file(), f"Paso 4: canal {ch['name']} conectado"))
        checks.append((f"channel_id {key}", bool(ch.get("youtube_channel_id")), f"Paso 4: ID de {ch['name']} en config"))
    for name, ok, what in checks:
        print(f"[{'OK' if ok else '--'}] {name:28s} {what}")


def cmd_plan_week(settings, args):
    start = date.fromisoformat(args.start) if args.start else date.today() + timedelta(days=(7 - date.today().weekday()) % 7 or 7)
    created = state.plan_week(settings, start, args.days)
    print(f"Creados {len(created)} huecos desde {start} (los existentes no se tocan).")
    cmd_calendar(settings, argparse.Namespace(channel=None, date=None, markdown=None))


def cmd_research(settings, args):
    for key in _channels(settings, args.channel):
        ch = settings.channel(key)
        results = research.find_top_videos(settings, ch, days=args.days, video_duration=args.duration)
        j, m = research.save_report(ch, results)
        print(f"\n== {ch['name']}: {len(results)} vídeos reales → {m}")
        for r in results[:args.show]:
            print(f"  {r['views_per_day']:>9,}/día  {r['views']:>11,} visitas  {r['title'][:70]}  {r['url']}")


def _sids(args):
    if args.slot:
        return [args.slot]
    return [s["id"] for s in state.list_slots(channel=args.channel if args.channel != "all" else None, day=args.date)]


def cmd_script(settings, args):
    for sid in _sids(args):
        if state.get_slot(sid)["status"] != "planned" and not args.force:
            print(f"{sid}: ya tiene guion (usa --force para regenerar)")
            continue
        slot = pipeline.step_script(settings, sid)
        print(f"{sid}: guion → {slot['artifacts']['script_path']}")


def cmd_import_script(settings, args):
    slot = pipeline.step_import_script(settings, args.slot, Path(args.file))
    print(f"{args.slot}: guion importado y validado → {slot['artifacts']['script_path']}")


def cmd_produce(settings, args):
    for sid in _sids(args):
        slot = pipeline.step_produce(settings, sid, Path(args.music) if args.music else None)
        print(f"{sid}: vídeo → {slot['artifacts']['video_path']} (voz: {slot['artifacts']['tts_engine']}, "
              f"imágenes: {', '.join(slot['artifacts']['image_sources'])})")


def cmd_auth(settings, args):
    me = uploader.authorize(args.channel)
    print(f"Conectado: {me['title']} ({me['id']}). Pon este ID en 'youtube_channel_id' de {args.channel}.")


def cmd_upload(settings, args):
    for sid in _sids(args):
        slot = pipeline.step_upload(settings, sid, captions=args.captions)
        yt = slot["artifacts"]["youtube"]
        print(f"{sid}: subido {yt['url']} — privado, se publica {yt['publish_at']}")


def cmd_run(settings, args):
    failures = 0
    for sid in _sids(args):
        try:
            slot = pipeline.run_slot(settings, sid, upload=not args.no_upload)
            print(f"[{slot['status'].upper()}] {sid}")
        except Exception as e:  # sigue con los demás canales
            failures += 1
            print(f"[ERROR] {sid}: {e}", file=sys.stderr)
    sys.exit(1 if failures else 0)


def cmd_calendar(settings, args):
    slots = state.list_slots(channel=args.channel, day=args.date)
    if not slots:
        print("Calendario vacío. Ejecuta 'plan-week'.")
        return
    rows = ["| Fecha | Hora local | Canal | Estado | Título | YouTube |", "|---|---|---|---|---|---|"]
    for s in slots:
        title = ""
        if s["artifacts"].get("script_path") and Path(s["artifacts"]["script_path"]).is_file():
            title = json.loads(Path(s["artifacts"]["script_path"]).read_text(encoding="utf-8"))["title"]
        yt = s["artifacts"].get("youtube", {}).get("url", "")
        rows.append(f"| {s['date']} | {settings.channels[s['channel']]['publish_time']} | "
                    f"{settings.channels[s['channel']]['name']} | {s['status']} | {title} | {yt} |")
    text = "\n".join(rows)
    print(text)
    if args.markdown:
        Path(args.markdown).write_text(f"# Calendario de publicaciones ({settings.timezone})\n\n{text}\n", encoding="utf-8")


def main(argv=None):
    p = argparse.ArgumentParser(prog="faceless", description="3 canales de YouTube sin cara")
    p.add_argument("--config", help="Ruta a channels.json")
    sub = p.add_subparsers(dest="cmd", required=True)

    sub.add_parser("doctor", help="Comprueba herramientas y credenciales")
    a = sub.add_parser("plan-week", help="Crea el calendario: 1 vídeo/día/canal")
    a.add_argument("--start", help="YYYY-MM-DD (por defecto, el próximo lunes)")
    a.add_argument("--days", type=int, default=7)
    a = sub.add_parser("research", help="Busca los vídeos que más funcionan en cada nicho")
    a.add_argument("--channel", default="all")
    a.add_argument("--days", type=int, default=30, help="Antigüedad máxima de los vídeos")
    a.add_argument("--duration", default="any", choices=["any", "short", "medium", "long"])
    a.add_argument("--show", type=int, default=10)
    for name, hlp in [("script", "Genera guiones con IA"), ("produce", "Voz IA + imágenes + subtítulos + montaje"),
                      ("upload", "Sube y programa en YouTube"), ("run", "Todo el flujo para los huecos elegidos")]:
        a = sub.add_parser(name, help=hlp)
        a.add_argument("--slot", help="ID del hueco, p. ej. 2026-11-16_caso_abierto")
        a.add_argument("--channel", default="all")
        a.add_argument("--date", help="YYYY-MM-DD")
        if name == "script":
            a.add_argument("--force", action="store_true")
        if name == "produce":
            a.add_argument("--music", help="MP3 de fondo (con licencia)")
        if name == "upload":
            a.add_argument("--captions", action="store_true", help="Sube también el SRT (+400 unidades de cuota)")
        if name == "run":
            a.add_argument("--no-upload", action="store_true")
    a = sub.add_parser("import-script", help="Importa y valida un guion JSON escrito a mano")
    a.add_argument("--slot", required=True)
    a.add_argument("--file", required=True)
    a = sub.add_parser("auth", help="Conecta un canal de YouTube (OAuth)")
    a.add_argument("--channel", required=True)
    a = sub.add_parser("calendar", help="Muestra el calendario")
    a.add_argument("--channel")
    a.add_argument("--date")
    a.add_argument("--markdown", help="Exportar a archivo .md")

    args = p.parse_args(argv)
    settings = load_settings(Path(args.config) if args.config else None)
    try:
        globals()[f"cmd_{args.cmd.replace('-', '_')}"](settings, args)
    except MissingCredential as e:
        print(f"FALTA CONFIGURACIÓN: {e}", file=sys.stderr)
        sys.exit(2)
    except (RuntimeError, ValueError, KeyError) as e:
        print(f"ERROR: {e}", file=sys.stderr)
        sys.exit(1)
