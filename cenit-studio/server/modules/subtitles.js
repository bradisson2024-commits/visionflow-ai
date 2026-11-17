// Subtítulos: generación automática sincronizada con la voz, edición manual y estilos (renderizados con libass).
import { execFileSync } from 'node:child_process';
import { AppError } from '../core/errors.js';

export const DEFAULT_STYLE = { font: 'DejaVu Sans', size: 64, position: 'abajo', primary: '#FFFFFF', highlight: '#FFD400', outline: '#000000', outlineWidth: 4, background: false, animation: 'pop', uppercase: false, maxWords: 6, bold: true };
export const PRESETS = {
  clasico: { ...DEFAULT_STYLE, animation: 'fade', size: 56, bold: false },
  impacto: { ...DEFAULT_STYLE, font: 'DejaVu Sans', uppercase: true, size: 76, animation: 'pop', highlight: '#FFD400' },
  karaoke: { ...DEFAULT_STYLE, animation: 'karaoke', highlight: '#3BA0FF' },
  caja: { ...DEFAULT_STYLE, background: true, outlineWidth: 0, animation: 'fade', size: 52 },
  minimal: { ...DEFAULT_STYLE, size: 44, outlineWidth: 2, animation: 'none', bold: false, position: 'abajo' },
};
export const ANIMATIONS = ['none', 'fade', 'pop', 'karaoke', 'deslizar'];

let fontCache;
/** Tipografías realmente instaladas en el servidor (libass sólo puede usar éstas). */
export function availableFonts() {
  if (fontCache) return fontCache;
  try { fontCache = [...new Set(execFileSync('fc-list', [':', 'family'], { encoding: 'utf8' }).split('\n').map((l) => l.split(',')[0].trim()).filter(Boolean))].sort(); }
  catch { fontCache = ['Arial', 'DejaVu Sans']; }
  return fontCache;
}

/** Cues a partir de la línea de tiempo: cada escena reparte su texto en grupos de `maxWords` según su audio. */
export function autoCues(timeline, maxWords = 6) {
  const cues = [];
  for (const t of timeline) {
    const w = t.narration.split(/\s+/).filter(Boolean);
    const groups = [];
    for (let i = 0; i < w.length; i += maxWords) groups.push(w.slice(i, i + maxWords).join(' '));
    const totalChars = groups.reduce((a, g) => a + g.length, 0) || 1;
    let at = t.voiceStart;
    for (const g of groups) {
      const len = (t.voiceSec * g.length) / totalChars;
      cues.push({ start: +at.toFixed(3), end: +(at + len).toFixed(3), text: g, scene: t.idx });
      at += len;
    }
  }
  return cues;
}

const assColor = (hex, alpha = 0) => { const m = /^#?([0-9a-f]{6})$/i.exec(hex || ''); if (!m) throw new AppError(400, `Color no válido: ${hex}`); const [r, g, b] = [0, 2, 4].map((i) => m[1].slice(i, i + 2)); return `&H${alpha.toString(16).padStart(2, '0').toUpperCase()}${b}${g}${r}`.toUpperCase(); };
const time = (s) => { const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = (s % 60).toFixed(2).padStart(5, '0'); return `${h}:${String(m).padStart(2, '0')}:${sec}`; };
const escapeAss = (t) => String(t).replace(/\\/g, '\\\\').replace(/[{}]/g, '').replace(/\n/g, '\\N');

export function buildAss(cues, style, [w, h]) {
  const s = { ...DEFAULT_STYLE, ...style };
  if (!ANIMATIONS.includes(s.animation)) throw new AppError(400, 'Animación de subtítulos no válida');
  const align = s.position === 'arriba' ? 8 : s.position === 'centro' ? 5 : 2;
  const marginV = Math.round(h * (s.position === 'centro' ? 0 : 0.08));
  const header = `[Script Info]\nScriptType: v4.00+\nPlayResX: ${w}\nPlayResY: ${h}\nWrapStyle: 0\nScaledBorderAndShadow: yes\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\n` +
    `Style: Cenit,${s.font},${s.size},${assColor(s.animation === 'karaoke' ? s.highlight : s.primary)},${assColor(s.primary)},${assColor(s.outline)},${assColor('#000000', s.background ? 0x40 : 0xFF)},${s.bold ? -1 : 0},0,0,0,100,100,0,0,${s.background ? 3 : 1},${s.outlineWidth},${s.background ? 0 : 1},${align},${Math.round(w * 0.06)},${Math.round(w * 0.06)},${marginV},1\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n`;
  const lines = cues.filter((c) => c.end > c.start && String(c.text).trim()).map((c) => {
    let text = escapeAss(s.uppercase ? String(c.text).toUpperCase() : c.text);
    if (s.animation === 'fade') text = `{\\fad(120,120)}${text}`;
    if (s.animation === 'pop') text = `{\\fscx70\\fscy70\\t(0,140,\\fscx100\\fscy100)}${text}`;
    if (s.animation === 'deslizar') text = `{\\fad(100,0)\\frx40\\t(0,180,\\frx0)}${text}`;
    if (s.animation === 'karaoke') {
      const ws = text.split(' ');
      const cs = Math.max(1, Math.round(((c.end - c.start) * 100) / ws.length));
      text = ws.map((x) => `{\\k${cs}}${x}`).join(' ');
    }
    return `Dialogue: 0,${time(c.start)},${time(c.end)},Cenit,,0,0,0,,${text}`;
  });
  return header + lines.join('\n') + '\n';
}
