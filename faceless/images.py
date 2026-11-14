"""PASO 3b: imágenes para cada escena.

Fuentes, en orden:
  1. Pexels (PEXELS_API_KEY) — fotos de stock gratuitas con licencia de uso comercial.
  2. Carpeta local data/<canal>/library/ con tus propias imágenes (jpg/png).
  3. Tarjeta gráfica generada con Pillow (fondo degradado + palabra clave) como último recurso.
"""
from __future__ import annotations

import hashlib
import os
import random
import textwrap
from pathlib import Path

import requests
from PIL import Image, ImageColor, ImageDraw, ImageFilter, ImageFont

from .config import channel_dir

FONT_CANDIDATES = [
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    "/usr/share/fonts/opentype/inter/Inter-Bold.otf",
    "/Library/Fonts/Arial Bold.ttf",
    "C:/Windows/Fonts/arialbd.ttf",
]


def _font(size: int):
    for f in FONT_CANDIDATES:
        if Path(f).exists():
            return ImageFont.truetype(f, size)
    return ImageFont.load_default(size)


def pexels_search(query: str, orientation: str, session: requests.Session | None = None) -> list[dict]:
    key = os.environ.get("PEXELS_API_KEY", "").strip()
    if not key:
        return []
    s = session or requests.Session()
    r = s.get("https://api.pexels.com/v1/search", headers={"Authorization": key},
              params={"query": query, "orientation": orientation, "per_page": 10}, timeout=30)
    if r.status_code != 200:
        raise RuntimeError(f"Pexels HTTP {r.status_code}: {r.text[:200]}")
    return r.json().get("photos", [])


def generated_card(text: str,  # texto visible (nombre del canal)
                   palette: list[str], size: tuple[int, int], out: Path) -> Path:
    w, h = size
    c1, c2, accent = (palette + ["#000000", "#333333", "#ffffff"])[:3]
    grad = Image.new("RGB", (1, 2))
    grad.putpixel((0, 0), ImageColor.getrgb(c1))
    grad.putpixel((0, 1), ImageColor.getrgb(c2))
    img = grad.resize((w, h), Image.BILINEAR)
    rnd = random.Random(hashlib.md5(text.encode()).hexdigest())
    draw = ImageDraw.Draw(img, "RGBA")
    for _ in range(18):  # formas suaves para dar textura
        x, y, r = rnd.randint(0, w), rnd.randint(0, h), rnd.randint(w // 10, w // 2)
        draw.ellipse([x - r, y - r, x + r, y + r], fill=(255, 255, 255, rnd.randint(6, 22)))
    img = img.filter(ImageFilter.GaussianBlur(30))
    draw = ImageDraw.Draw(img)
    font = _font(int(w * 0.06))
    lines = textwrap.wrap(text.upper(), 14)[:4]
    y = int(h * 0.12)
    for line in lines:
        tw = draw.textlength(line, font=font)
        draw.text(((w - tw) / 2, y), line, font=font, fill=accent, stroke_width=4, stroke_fill="#000000")
        y += int(font.size * 1.25)
    img.save(out, quality=92)
    return out


def fetch_scene_images(channel: dict, queries: list[str], out_dir: Path, size: tuple[int, int],
                       session: requests.Session | None = None) -> tuple[list[Path], list[dict]]:
    """Devuelve (rutas, créditos). Evita repetir la misma foto dentro de un vídeo."""
    out_dir.mkdir(parents=True, exist_ok=True)
    orientation = "portrait" if size[1] > size[0] else "landscape"
    library = sorted(p for p in channel_dir(channel["key"], "library").iterdir()
                     if p.suffix.lower() in {".jpg", ".jpeg", ".png", ".webp"})
    used, paths, credits = set(), [], []
    s = session or requests.Session()
    for i, q in enumerate(queries):
        out = out_dir / f"scene_{i:02d}.jpg"
        photo = next((p for p in pexels_search(q, orientation, s) if p["id"] not in used), None)
        if photo:
            used.add(photo["id"])
            r = s.get(photo["src"].get("large2x") or photo["src"]["original"], timeout=60)
            r.raise_for_status()
            out.write_bytes(r.content)
            Image.open(out).convert("RGB").save(out, quality=92)  # valida la imagen
            credits.append({"scene": i, "source": "pexels", "query": q, "url": photo["url"],
                            "photographer": photo.get("photographer")})
        elif library:
            src = library[i % len(library)]
            Image.open(src).convert("RGB").save(out, quality=92)
            credits.append({"scene": i, "source": "library", "file": src.name})
        else:
            generated_card(channel.get("name", ""), channel.get("palette", []), size, out)
            credits.append({"scene": i, "source": "generated", "query": q})
        paths.append(out)
    return paths, credits
