/**
 * Subtítulos: agrupación de palabras en líneas, archivo ASS (grabado en el
 * video con libass) y SRT (archivo separado).
 */
import type { CaptionStyle, TranscriptWord } from "../db/schema";

export type CaptionLine = { s: number; e: number; words: TranscriptWord[] };

/** Palabras del clip con tiempos relativos al inicio del clip. */
export function clipWords(words: TranscriptWord[], startSec: number, endSec: number): TranscriptWord[] {
  return words
    .filter((w) => w.e > startSec + 0.05 && w.s < endSec - 0.05)
    .map((w) => ({ w: w.w, s: Math.max(0, w.s - startSec), e: Math.min(endSec - startSec, w.e - startSec) }));
}

/** Agrupa en líneas de N palabras, cortando también en finales de frase y pausas. */
export function groupLines(words: TranscriptWord[], perLine: number): CaptionLine[] {
  const lines: CaptionLine[] = [];
  let cur: TranscriptWord[] = [];
  const flush = () => {
    if (cur.length) lines.push({ s: cur[0].s, e: cur[cur.length - 1].e, words: cur });
    cur = [];
  };
  words.forEach((w, i) => {
    cur.push(w);
    const next = words[i + 1];
    if (cur.length >= perLine || /[.!?…]$/.test(w.w) || (next && next.s - w.e > 0.6)) flush();
  });
  flush();
  // Cada línea permanece hasta que empieza la siguiente si el hueco es corto.
  for (let i = 0; i < lines.length - 1; i++) if (lines[i + 1].s - lines[i].e < 0.4) lines[i].e = lines[i + 1].s;
  return lines;
}

/** #RRGGBB o #RRGGBBAA → &HAABBGGRR (ASS: alfa invertido, 00 = opaco). */
export function assColor(hex: string | null | undefined, fallback = "&H00FFFFFF"): string {
  if (!hex) return fallback;
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})?$/i.exec(hex.trim());
  if (!m) return fallback;
  const alpha = m[4] ? 255 - parseInt(m[4], 16) : 0;
  const h = (n: number) => n.toString(16).toUpperCase().padStart(2, "0");
  return `&H${h(alpha)}${m[3].toUpperCase()}${m[2].toUpperCase()}${m[1].toUpperCase()}`;
}

const assTime = (t: number) => {
  const cs = Math.max(0, Math.round(t * 100));
  const h = Math.floor(cs / 360000);
  const m = Math.floor((cs % 360000) / 6000);
  const s = Math.floor((cs % 6000) / 100);
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(cs % 100).padStart(2, "0")}`;
};
const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/[{}]/g, "").replace(/\n/g, " ");

/**
 * Genera el ASS. Los tamaños del estilo están pensados para un lado corto de
 * 1080 px y se escalan a la salida real.
 */
export function buildAss(words: TranscriptWord[], style: CaptionStyle, outW: number, outH: number): string {
  const k = Math.min(outW, outH) / 1080;
  const fontSize = Math.round(style.fontSize * k);
  const outline = style.outlineColor ? Math.max(0, style.outlineWidth * k) : 0;
  const boxed = !!style.backgroundColor;
  const align = style.position === "top" ? 8 : style.position === "middle" ? 5 : 2;
  const marginV = Math.round((style.position === "middle" ? 0 : style.position === "top" ? 0.1 : 0.14) * outH);
  const marginH = Math.round(outW * 0.07);
  const karaoke = style.highlightMode === "karaoke";
  // En karaoke: Primary = color tras ser dicho (resaltado), Secondary = antes.
  const primary = assColor(karaoke ? style.highlightColor : style.color);
  const secondary = assColor(style.color);
  const outlineCol = boxed ? assColor(style.backgroundColor) : assColor(style.outlineColor, "&H00000000");
  const back = boxed ? assColor(style.backgroundColor) : "&H96000000";
  const shadow = boxed ? 0 : style.outlineColor ? Math.round(2 * k) : Math.round(3 * k);

  const header = `[Script Info]
ScriptType: v4.00+
PlayResX: ${outW}
PlayResY: ${outH}
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Cap,${style.fontFamily},${fontSize},${primary},${secondary},${outlineCol},${back},0,0,0,0,100,100,0,0,${boxed ? 3 : 1},${boxed ? Math.round(14 * k) : outline.toFixed(1)},${shadow},${align},${marginH},${marginH},${marginV},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;
  if (!style.enabled) return header;
  const word = (w: string) => esc(style.uppercase ? w.toLocaleUpperCase("es") : w);
  const hl = assColor(style.highlightColor);
  const events: string[] = [];
  for (const line of groupLines(words, Math.max(1, style.wordsPerLine))) {
    if (style.highlightMode === "word") {
      // Un evento por palabra: la palabra activa en el color de resaltado.
      line.words.forEach((w, i) => {
        const s = i === 0 ? line.s : w.s;
        const e = i === line.words.length - 1 ? line.e : line.words[i + 1].s;
        const text = line.words.map((x, j) => (j === i ? `{\\c${hl}}${word(x.w)}{\\r}` : word(x.w))).join(" ");
        events.push(`Dialogue: 0,${assTime(s)},${assTime(Math.max(e, s + 0.05))},Cap,,0,0,0,,${text}`);
      });
    } else if (karaoke) {
      let t = line.s;
      const text = line.words
        .map((w) => {
          const lead = Math.max(0, Math.round((w.s - t) * 100));
          const dur = Math.max(1, Math.round((w.e - w.s) * 100));
          t = w.e;
          return `${lead ? `{\\k${lead}}` : ""}{\\k${dur}}${word(w.w)}`;
        })
        .join(" ");
      events.push(`Dialogue: 0,${assTime(line.s)},${assTime(line.e)},Cap,,0,0,0,,${text}`);
    } else {
      events.push(`Dialogue: 0,${assTime(line.s)},${assTime(line.e)},Cap,,0,0,0,,${line.words.map((w) => word(w.w)).join(" ")}`);
    }
  }
  return header + events.join("\n") + "\n";
}

const srtTime = (t: number) => {
  const ms = Math.max(0, Math.round(t * 1000));
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")},${String(ms % 1000).padStart(3, "0")}`;
};

export function buildSrt(words: TranscriptWord[], perLine = 7): string {
  return groupLines(words, perLine)
    .map((l, i) => `${i + 1}\n${srtTime(l.s)} --> ${srtTime(l.e)}\n${l.words.map((w) => w.w).join(" ")}\n`)
    .join("\n");
}
