"""PASO 3c: subtítulos sincronizados (SRT para YouTube + ASS estilizado quemado en el vídeo).

La sincronía parte de la duración real del audio de cada escena; dentro de cada
escena el texto se divide en bloques cortos repartidos según su longitud.
"""
from __future__ import annotations

import re
from pathlib import Path


def chunk_words(text: str, max_words: int = 4) -> list[str]:
    chunks = []
    for sentence in re.split(r"(?<=[.!?¿¡…:;])\s+", text.strip()):
        words = sentence.split()
        if not words:
            continue
        n = -(-len(words) // max_words)  # bloques equilibrados: 5 palabras → 3+2, no 4+1
        size, extra = divmod(len(words), n)
        i = 0
        for k in range(n):
            step = size + (1 if k < extra else 0)
            chunks.append(" ".join(words[i:i + step]))
            i += step
    return [c for c in chunks if c]


def build_cues(texts: list[str], durations: list[float], gap: float = 0.25, max_words: int = 4) -> list[tuple[float, float, str]]:
    cues, t = [], 0.0
    for text, dur in zip(texts, durations):
        chunks = chunk_words(text, max_words)
        weights = [len(c) + 3 for c in chunks]
        total = sum(weights)
        start = t
        for c, wgt in zip(chunks, weights):
            end = start + dur * wgt / total
            cues.append((round(start, 3), round(end, 3), c))
            start = end
        t += dur + gap
    return cues


def _ts(sec: float, sep: str = ",") -> str:
    h, rem = divmod(sec, 3600)
    m, s = divmod(rem, 60)
    if sep == ",":
        return f"{int(h):02d}:{int(m):02d}:{int(s):02d},{int(round((s % 1) * 1000)) % 1000:03d}"
    return f"{int(h)}:{int(m):02d}:{s:05.2f}"


def write_srt(cues, path: Path) -> Path:
    lines = []
    for i, (a, b, text) in enumerate(cues, 1):
        lines += [str(i), f"{_ts(a)} --> {_ts(b)}", text, ""]
    path.write_text("\n".join(lines), encoding="utf-8")
    return path


def _ass_color(hex_color: str) -> str:
    h = hex_color.lstrip("#")
    return f"&H00{h[4:6]}{h[2:4]}{h[0:2]}".upper()


def write_ass(cues, path: Path, width: int, height: int, accent: str = "#FFD400") -> Path:
    vertical = height > width
    size = int(width * (0.085 if vertical else 0.05))
    margin_v = int(height * (0.28 if vertical else 0.08))
    header = f"""[Script Info]
ScriptType: v4.00+
PlayResX: {width}
PlayResY: {height}
WrapStyle: 0

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Main,DejaVu Sans,{size},&H00FFFFFF,{_ass_color(accent)},&H00000000,&H80000000,1,0,0,0,100,100,0,0,1,{max(4, size // 12)},2,2,60,60,{margin_v},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""
    events = []
    for a, b, text in cues:
        safe = text.replace("{", "(").replace("}", ")").upper()
        events.append(f"Dialogue: 0,{_ts(a, '.')},{_ts(b, '.')},Main,,0,0,0,,{{\\fad(60,40)}}{safe}")
    path.write_text(header + "\n".join(events) + "\n", encoding="utf-8")
    return path
