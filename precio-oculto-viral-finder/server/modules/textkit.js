// Utilidades de texto del guion. Las referencias a fuentes se escriben como [1], [2]…
const REF_RE = /\s*\[(\d+(?:\s*,\s*\d+)*)\]/g;
const ABBR = new Set(['sr', 'sra', 'dr', 'dra', 'ee.uu', 'etc', 'aprox', 'vs', 'no', 'núm', 'inc', 'corp', 'co', 'st']);

export const stripRefs = (t) => String(t).replace(REF_RE, '').replace(/\s+([,.;:!?…])/g, '$1').replace(/\s{2,}/g, ' ').trim();
export const refsIn = (t) => [...String(t).matchAll(REF_RE)].flatMap((m) => m[1].split(/\s*,\s*/).map(Number));
export const words = (t) => stripRefs(t).split(/\s+/).filter(Boolean).length;
export const fold = (t) => String(t).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9ñ\s]/g, ' ').replace(/\s+/g, ' ').trim();

/** Oraciones, sin cortar cifras (1.500, 3,5) ni abreviaturas; la referencia [n] queda con su oración. */
export function sentences(text) {
  const src = String(text).replace(/\s+/g, ' ').trim();
  const out = [];
  let start = 0;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (!/[.!?…]/.test(c)) continue;
    if (c === '.' && /\d/.test(src[i - 1] || '') && /\d/.test(src[i + 1] || '')) continue;
    if (c === '.' && /[A-Za-zÁÉÍÓÚÑ]/.test(src[i + 1] || '')) continue; // siglas como EE.UU.
    let end = i + 1;
    while (end < src.length && /[.!?…"»”')]/.test(src[end])) end++;
    const ref = /^\s*\[\d+(?:\s*,\s*\d+)*\]/.exec(src.slice(end));
    if (ref) end += ref[0].length;
    const word = (src.slice(start, i).split(/\s+/).pop() || '').toLowerCase().replace(/^[¿¡("«]+/, '');
    if (c === '.' && ABBR.has(word)) continue;
    const rest = src.slice(end).trimStart();
    if (rest && !/^[A-ZÁÉÍÓÚÑ¿¡"«“0-9]/.test(rest)) continue;
    out.push(src.slice(start, end).trim());
    start = end;
    i = end - 1;
  }
  if (src.slice(start).trim()) out.push(src.slice(start).trim());
  return out;
}

/** Oraciones con cifras sin fuente, y referencias a fuentes inexistentes. */
export function auditFacts(paragraphs, sourceCount) {
  const missing = [], invalid = [];
  for (const p of paragraphs) for (const s of sentences(p)) {
    const refs = refsIn(s);
    if (refs.some((r) => r < 1 || r > sourceCount)) invalid.push(s);
    if (/\d/.test(stripRefs(s)) && !refs.length) missing.push(s);
  }
  return { missing, invalid };
}

/** Proporción de frases de 7 palabras del texto nuevo que aparecen literalmente en el original. */
export function copiedRatio(newText, original, n = 7) {
  if (!original) return null;
  const grams = (t) => { const w = fold(stripRefs(t)).split(' '); const s = new Set(); for (let i = 0; i + n <= w.length; i++) s.add(w.slice(i, i + n).join(' ')); return s; };
  const a = grams(newText), b = grams(original);
  if (!a.size) return 0;
  let k = 0;
  for (const g of a) if (b.has(g)) k++;
  return k / a.size;
}

/** ¿La cita aparece de verdad en el texto? (ignora mayúsculas, acentos y puntuación) */
export function quoteFound(quote, text) {
  const q = fold(quote), t = fold(text);
  if (q.split(' ').length < 4) return false;
  if (t.includes(q)) return true;
  const w = q.split(' ');
  for (let i = 0; i + 6 <= w.length; i++) if (t.includes(w.slice(i, i + 6).join(' '))) return true;
  return false;
}

/** Limpia una transcripción .srt / .vtt / texto con marcas de tiempo. */
export function cleanTranscript(raw) {
  return String(raw || '').replace(/^﻿/, '').split(/\r?\n/)
    .filter((l) => !/^\s*\d+\s*$/.test(l) && !/-->/.test(l) && !/^(WEBVTT|NOTE|Kind:|Language:)/.test(l.trim()))
    .map((l) => l.replace(/<[^>]+>/g, '').replace(/^\[?\d{1,2}:\d{2}(?::\d{2})?\]?\s*/, '').trim())
    .filter(Boolean).filter((l, i, a) => l !== a[i - 1]).join(' ').replace(/\s+/g, ' ').trim();
}
