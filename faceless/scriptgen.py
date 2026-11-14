"""PASO 2: guiones originales con la estructura viral Gancho → Contexto → Giro → Final.

Usa la API de Claude con los vídeos reales encontrados en la investigación como
referencia de *estructura y temas que funcionan*. Se le prohíbe copiar.
También permite importar guiones escritos a mano (validate_script).
"""
from __future__ import annotations

import json
import os
import re
from pathlib import Path

import requests

from .config import channel_dir, require_env

SECTIONS = ["hook", "context", "twist", "ending"]
SECTION_ES = {"hook": "Gancho", "context": "Contexto", "twist": "Giro", "ending": "Final"}
HOW_KEY = "Créala en https://console.anthropic.com → API Keys (requiere saldo en la cuenta)."


class ScriptError(ValueError):
    pass


def narration(script: dict) -> str:
    return " ".join(s["text"].strip() for s in script["scenes"])


def _ngrams(text: str, n: int = 6) -> set[tuple]:
    words = re.findall(r"\w+", text.lower())
    return {tuple(words[i:i + n]) for i in range(len(words) - n + 1)}


def validate_script(script: dict, target_words: int | None = None,
                    references: list[dict] | None = None) -> dict:
    """Valida estructura, longitud y originalidad frente a las referencias."""
    for field in ("title", "description", "scenes"):
        if not script.get(field):
            raise ScriptError(f"Falta el campo '{field}'")
    if len(script["title"]) > 100:
        raise ScriptError("El título supera 100 caracteres (límite de YouTube)")
    if len(script["description"]) > 4900:
        raise ScriptError("La descripción es demasiado larga")
    if any(c in script["title"] + script["description"] for c in "<>"):
        raise ScriptError("YouTube no acepta '<' ni '>' en título/descripción")
    seen = []
    for sc in script["scenes"]:
        if sc.get("section") not in SECTIONS:
            raise ScriptError(f"Sección inválida: {sc.get('section')}")
        if not sc.get("text", "").strip():
            raise ScriptError("Hay una escena sin texto")
        if not sc.get("image_query", "").strip():
            raise ScriptError("Hay una escena sin 'image_query'")
        if not seen or seen[-1] != sc["section"]:
            seen.append(sc["section"])
    if seen != SECTIONS:
        raise ScriptError(f"Orden de secciones {seen}; se exige {SECTIONS}")
    words = len(narration(script).split())
    if target_words and not (0.6 * target_words <= words <= 1.5 * target_words):
        raise ScriptError(f"{words} palabras; objetivo ≈{target_words}")
    if references:
        mine = _ngrams(narration(script) + " " + script["title"])
        for ref in references:
            overlap = mine & _ngrams(ref.get("title", "") + " " + ref.get("description", ""))
            if overlap:
                raise ScriptError(f"Frase copiada de la referencia {ref.get('video_id')}: "
                                  f"{' '.join(next(iter(overlap)))}")
    script["word_count"] = words
    return script


def build_prompt(channel: dict, references: list[dict], used_topics: list[str]) -> tuple[str, str]:
    system = (
        "Eres guionista de canales de YouTube sin rostro (faceless) en español. "
        "Escribes guiones ORIGINALES. Puedes inspirarte en la estructura, el ritmo y el tipo de tema "
        "de los vídeos de referencia, pero nunca copies frases, títulos ni el mismo caso/dato exacto. "
        "Solo usa hechos reales y verificables; no inventes cifras, fechas ni nombres. "
        "En temas de crímenes o tragedias sé respetuoso con las víctimas. "
        "Responde únicamente con un objeto JSON válido, sin texto adicional."
    )
    refs = "\n".join(
        f"- [{r['video_id']}] \"{r['title']}\" — {r['views_per_day']:,} visitas/día, "
        f"{r['duration_s']}s, canal {r['channel_title']}" for r in references
    ) or "(sin referencias)"
    user = f"""Canal: {channel['name']} — nicho: {channel['niche']}.
Tono: {channel['tone']}.

Vídeos que MÁS están funcionando ahora en este nicho (datos reales de YouTube):
{refs}

Temas ya usados en el canal (no repetir): {', '.join(used_topics[-60:]) or 'ninguno'}

Tarea:
1. Analiza qué patrones comparten los vídeos de referencia (tipo de tema, promesa del título, gancho).
2. Elige un tema NUEVO y real que encaje con esos patrones.
3. Escribe un guion narrado de unas {channel['target_words']} palabras con 4 secciones en orden:
   hook (gancho, 1-2 frases que obligan a seguir viendo), context (contexto), twist (giro/revelación),
   ending (final con cierre y llamada a suscribirse breve).
   Divide cada sección en 1-3 escenas; cada escena lleva una búsqueda de imagen de stock en inglés
   (2-5 palabras, sin personas reconocibles ni caras en primer plano).

Formato JSON exacto:
{{"pattern_analysis": "...", "reference_video_ids": ["..."], "topic": "...",
  "title": "... (máx 70 caracteres, sin < >)", "description": "2-4 frases + hashtags",
  "tags": ["..."],
  "scenes": [{{"section": "hook", "text": "...", "image_query": "..."}}],
  "facts_to_verify": ["afirmaciones que una persona debe comprobar antes de publicar"]}}"""
    return system, user


def _extract_json(text: str) -> dict:
    text = text.strip()
    text = re.sub(r"^```(?:json)?\s*|\s*```$", "", text)
    start, end = text.find("{"), text.rfind("}")
    if start < 0 or end < 0:
        raise ScriptError("La respuesta no contiene JSON")
    return json.loads(text[start:end + 1])


def call_claude(system: str, user: str, session: requests.Session | None = None) -> str:
    key = require_env("ANTHROPIC_API_KEY", HOW_KEY)
    session = session or requests.Session()
    r = session.post(
        os.environ.get("ANTHROPIC_API_URL", "https://api.anthropic.com/v1/messages"),
        headers={"x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json"},
        json={"model": os.environ.get("ANTHROPIC_MODEL", "claude-sonnet-5-5"), "max_tokens": 4000,
              "system": system, "messages": [{"role": "user", "content": user}]},
        timeout=180,
    )
    if r.status_code != 200:
        raise RuntimeError(f"API de Claude HTTP {r.status_code}: {r.text[:300]}")
    return "".join(b.get("text", "") for b in r.json()["content"] if b.get("type") == "text")


def used_topics(channel_key: str) -> list[str]:
    topics = []
    for p in sorted(channel_dir(channel_key, "scripts").glob("*.json")):
        try:
            topics.append(json.loads(p.read_text(encoding="utf-8")).get("topic", ""))
        except json.JSONDecodeError:
            pass
    return [t for t in topics if t]


def generate_script(channel: dict, references: list[dict], attempts: int = 2,
                    session: requests.Session | None = None) -> dict:
    system, user = build_prompt(channel, references, used_topics(channel["key"]))
    last_error = None
    for _ in range(attempts):
        prompt = user if not last_error else f"{user}\n\nTu respuesta anterior fue rechazada: {last_error}. Corrígelo."
        try:
            script = _extract_json(call_claude(system, prompt, session))
            return validate_script(script, channel.get("target_words"), references)
        except (ScriptError, json.JSONDecodeError) as e:
            last_error = str(e)
    raise ScriptError(f"No se obtuvo un guion válido: {last_error}")


def save_script(channel_key: str, slot_id: str, script: dict) -> Path:
    path = channel_dir(channel_key, "scripts") / f"{slot_id}.json"
    path.write_text(json.dumps(script, ensure_ascii=False, indent=2), encoding="utf-8")
    return path
