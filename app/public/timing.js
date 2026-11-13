// Cálculo de tiempos de escenas del Editor RaulitoShow IA.
// Archivo compartido por el navegador (window.Timing) y las pruebas en Node (module.exports).
(function (root) {
  'use strict';

  function parseClock(s) {
    // Acepta h:mm:ss(.ms|,ms), mm:ss(.ms) o ss(.ms)
    const p = String(s).trim().replace(',', '.').split(':').map(Number);
    if (p.some(n => !isFinite(n))) return null;
    return p.reduce((acc, n) => acc * 60 + n, 0);
  }

  // Devuelve { mode: 'none'|'lines'|'timed', lines: [texto...], cues: [{start, end, text}] }
  function parseSceneText(raw) {
    const text = String(raw || '').replace(/^﻿/, '').replace(/\r\n?/g, '\n');
    const arrow = /(\d{1,2}:)?\d{1,2}:\d{2}[.,]\d{1,3}\s*-->\s*(\d{1,2}:)?\d{1,2}:\d{2}[.,]\d{1,3}/;
    if (arrow.test(text)) {
      // SRT / WebVTT
      const blocks = text.split(/\n\s*\n/);
      const cues = [];
      for (const b of blocks) {
        const ls = b.split('\n').map(l => l.trim()).filter(Boolean);
        const i = ls.findIndex(l => l.includes('-->'));
        if (i < 0) continue;
        const [a, z] = ls[i].split('-->').map(x => x.trim().split(/\s+/)[0]);
        const start = parseClock(a), end = parseClock(z);
        const t = ls.slice(i + 1).join(' ').replace(/<[^>]+>/g, '').trim();
        if (start != null && end != null) cues.push({ start, end, text: t });
      }
      if (cues.length) return { mode: 'timed', lines: cues.map(c => c.text), cues };
    }
    const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
    if (!lines.length) return { mode: 'none', lines: [], cues: [] };
    const stamp = /^\[?((?:\d{1,2}:)?\d{1,2}:\d{2}(?:[.,]\d{1,3})?)\]?\s*[-–—:]?\s*(.*)$/;
    const stamped = lines.map(l => stamp.exec(l));
    if (stamped.every(Boolean)) {
      const cues = stamped.map(m => ({ start: parseClock(m[1]), end: null, text: m[2].trim() }));
      const ordered = cues.every((c, i) => i === 0 || c.start >= cues[i - 1].start);
      if (ordered) return { mode: 'timed', lines: cues.map(c => c.text), cues };
    }
    return { mode: 'lines', lines, cues: [] };
  }

  const round = n => Math.round(n * 1000) / 1000;

  // Reparte `count` escenas sobre la duración del audio.
  // Devuelve { durations, method: 'marcas'|'aproximada'|'igual', approximate, message, warning }
  function distribute(count, audioDuration, parsed) {
    if (!count) throw new Error('No hay imágenes para repartir.');
    if (!(audioDuration > 0)) throw new Error('Carga primero el audio para poder repartir las escenas.');
    parsed = parsed || { mode: 'none', lines: [], cues: [] };

    if (parsed.mode === 'timed') {
      if (parsed.cues.length !== count) {
        // Sin correspondencia exacta no se pueden usar las marcas.
        const r = distribute(count, audioDuration, { mode: parsed.lines.length ? 'lines' : 'none', lines: parsed.lines, cues: [] });
        r.warning = `El texto tiene ${parsed.cues.length} marcas de tiempo y hay ${count} imágenes: no se pueden usar las marcas. ` + (r.warning || '');
        return r;
      }
      const starts = parsed.cues.map(c => c.start);
      starts[0] = 0; // la primera escena empieza siempre en 0
      const durations = starts.map((s, i) => (i + 1 < count ? starts[i + 1] : audioDuration) - s);
      if (durations.some(d => d < 0.2)) {
        const r = distribute(count, audioDuration, { mode: 'lines', lines: parsed.lines, cues: [] });
        r.warning = 'Las marcas de tiempo no son válidas para el audio (escenas de menos de 0.2 s o fuera de la duración). ' + (r.warning || '');
        return r;
      }
      return { durations: durations.map(round), method: 'marcas', approximate: false,
        message: `Escenas sincronizadas con las ${count} marcas de tiempo reales de la narración.` };
    }

    if (parsed.mode === 'lines' && parsed.lines.length) {
      const lens = [];
      for (let i = 0; i < count; i++) lens.push(parsed.lines[i] ? Math.max(1, parsed.lines[i].replace(/\s+/g, ' ').length) : null);
      const known = lens.filter(x => x != null);
      const avg = known.reduce((a, b) => a + b, 0) / known.length;
      const w = lens.map(x => (x == null ? avg : x));
      const sum = w.reduce((a, b) => a + b, 0);
      const durations = w.map(x => round(audioDuration * x / sum));
      fixTotal(durations, audioDuration);
      let warning = '';
      if (parsed.lines.length !== count) warning = `Hay ${parsed.lines.length} líneas de texto y ${count} imágenes; las escenas sin texto reciben la duración media.`;
      return { durations, method: 'aproximada', approximate: true, warning,
        message: 'Distribución APROXIMADA: estimada por la longitud del texto de cada escena (no hay marcas de tiempo reales).' };
    }

    const each = audioDuration / count;
    const durations = Array.from({ length: count }, () => round(each));
    fixTotal(durations, audioDuration);
    return { durations, method: 'igual', approximate: false,
      message: `Reparto igual: ${count} escenas de ${each.toFixed(2)} s para cubrir los ${audioDuration.toFixed(2)} s del audio.` };
  }

  // Ajusta la última duración para que la suma sea exactamente la del audio.
  function fixTotal(durations, total) {
    const s = durations.reduce((a, b) => a + b, 0);
    durations[durations.length - 1] = round(durations[durations.length - 1] + (total - s));
  }

  function starts(durations) {
    const out = []; let t = 0;
    for (const d of durations) { out.push(round(t)); t += d; }
    return out;
  }

  function total(durations) { return round(durations.reduce((a, b) => a + b, 0)); }

  function sceneAt(durations, t) {
    let acc = 0;
    for (let i = 0; i < durations.length; i++) { if (t < acc + durations[i]) return i; acc += durations[i]; }
    return Math.max(0, durations.length - 1);
  }

  function fmt(t, decimals = 1) {
    t = Math.max(0, t || 0);
    const m = Math.floor(t / 60);
    const s = t - m * 60;
    const ss = s.toFixed(decimals).padStart(decimals ? 3 + decimals : 2, '0');
    return `${m}:${ss}`;
  }

  const api = { parseSceneText, distribute, starts, total, sceneAt, fmt, parseClock };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Timing = api;
})(typeof window !== 'undefined' ? window : globalThis);
