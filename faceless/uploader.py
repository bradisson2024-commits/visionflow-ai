"""PASO 4: subir y programar en YouTube (YouTube Data API v3, OAuth por canal).

- Cada canal tiene su propio token OAuth en credentials/token_<canal>.json.
- El vídeo se sube como 'private' con status.publishAt → YouTube lo publica solo a esa hora.
- Antes de subir se comprueba que el token pertenece al canal configurado,
  para no publicar nunca en el canal equivocado.
Cuota: videos.insert = 1.600 unidades (≈6 subidas/día con la cuota por defecto de 10.000).
"""
from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from pathlib import Path

from .config import CRED_DIR, ROOT, MissingCredential

SCOPES = ["https://www.googleapis.com/auth/youtube.upload",
          "https://www.googleapis.com/auth/youtube.readonly",
          "https://www.googleapis.com/auth/youtube.force-ssl"]

HOW_OAUTH = ("Crea un ID de cliente OAuth tipo 'Aplicación de escritorio' en Google Cloud Console "
             "(mismo proyecto con YouTube Data API v3 habilitada), descarga el JSON y guárdalo en "
             "credentials/client_secret.json (o indica la ruta en YOUTUBE_CLIENT_SECRETS).")


def token_path(channel_key: str) -> Path:
    return CRED_DIR / f"token_{channel_key}.json"


def client_secrets() -> Path:
    p = Path(os.environ.get("YOUTUBE_CLIENT_SECRETS", "credentials/client_secret.json"))
    p = p if p.is_absolute() else ROOT / p
    if not p.is_file():
        raise MissingCredential(f"No existe {p}. {HOW_OAUTH}")
    return p


def authorize(channel_key: str) -> dict:
    """Abre el navegador para que elijas la cuenta/canal de marca. Guarda el token."""
    from google_auth_oauthlib.flow import InstalledAppFlow

    flow = InstalledAppFlow.from_client_secrets_file(str(client_secrets()), SCOPES)
    creds = flow.run_local_server(port=0, open_browser=True, prompt="consent",
                                  authorization_prompt_message="Abre esta URL y elige el canal: {url}")
    CRED_DIR.mkdir(parents=True, exist_ok=True)
    token_path(channel_key).write_text(creds.to_json(), encoding="utf-8")
    return whoami(channel_key)


def _service(channel_key: str):
    from google.auth.transport.requests import Request
    from google.oauth2.credentials import Credentials
    from googleapiclient.discovery import build

    tp = token_path(channel_key)
    if not tp.is_file():
        raise MissingCredential(f"El canal '{channel_key}' no está conectado. Ejecuta: "
                                f"python -m faceless auth --channel {channel_key}")
    creds = Credentials.from_authorized_user_file(str(tp), SCOPES)
    if not creds.valid and creds.refresh_token:
        creds.refresh(Request())
        tp.write_text(creds.to_json(), encoding="utf-8")
    return build("youtube", "v3", credentials=creds, cache_discovery=False)


def whoami(channel_key: str, service=None) -> dict:
    yt = service or _service(channel_key)
    items = yt.channels().list(part="snippet", mine=True).execute().get("items", [])
    if not items:
        raise RuntimeError("La cuenta autorizada no tiene canal de YouTube")
    return {"id": items[0]["id"], "title": items[0]["snippet"]["title"]}


def build_body(script: dict, channel: dict, publish_at_utc: str, language: str = "es",
               synthetic: bool = False) -> dict:
    when = datetime.strptime(publish_at_utc, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)
    if when <= datetime.now(timezone.utc):
        raise ValueError(f"publishAt {publish_at_utc} está en el pasado; YouTube lo rechazaría")
    tags, total = [], 0
    for t in list(dict.fromkeys(script.get("tags", []) + channel.get("default_tags", []))):
        if total + len(t) + 1 > 480:  # límite de 500 caracteres de YouTube
            break
        tags.append(t)
        total += len(t) + 1
    return {
        "snippet": {"title": script["title"][:100], "description": script["description"][:5000],
                    "tags": tags, "categoryId": channel.get("category_id", "27"),
                    "defaultLanguage": language, "defaultAudioLanguage": language},
        "status": {"privacyStatus": "private", "publishAt": publish_at_utc,
                   "selfDeclaredMadeForKids": False, "containsSyntheticMedia": synthetic},
    }


def upload_and_schedule(channel: dict, video: Path, body: dict, srt: Path | None = None, service=None) -> dict:
    from googleapiclient.http import MediaFileUpload

    yt = service or _service(channel["key"])
    me = whoami(channel["key"], yt)
    expected = channel.get("youtube_channel_id", "").strip()
    if not expected:
        raise MissingCredential(f"Rellena 'youtube_channel_id' de {channel['key']} en config/channels.json "
                                f"(el token conectado es del canal {me['title']} = {me['id']})")
    if me["id"] != expected:
        raise RuntimeError(f"El token de {channel['key']} es del canal {me['title']} ({me['id']}), "
                           f"no de {expected}. Vuelve a ejecutar 'auth'.")
    req = yt.videos().insert(part="snippet,status", body=body,
                             media_body=MediaFileUpload(str(video), mimetype="video/mp4",
                                                        chunksize=8 * 1024 * 1024, resumable=True))
    response = None
    while response is None:
        _, response = req.next_chunk()
    result = {"video_id": response["id"], "url": f"https://youtu.be/{response['id']}",
              "privacy": response["status"].get("privacyStatus"),
              "publish_at": response["status"].get("publishAt"),
              "upload_status": response["status"].get("uploadStatus")}
    if srt and srt.is_file():
        yt.captions().insert(part="snippet", body={"snippet": {
            "videoId": response["id"], "language": body["snippet"]["defaultLanguage"], "name": "Español"}},
            media_body=MediaFileUpload(str(srt), mimetype="application/octet-stream")).execute()
        result["captions"] = True
    return result
