// Línea de tiempo narración ↔ imagen.
// Garantías (comprobadas en tests y en la verificación final):
//  - La imagen de la escena i es la única visible, al 100 %, durante toda su narración [start_i, audioEnd_i].
//  - El fundido hacia la escena i+1 ocurre dentro de la pausa entre narraciones, nunca encima de la voz.
//  - Ninguna imagen aparece antes de que termine la narración anterior.
//  - No hay huecos: la suma de clips cubre todo el video.

export const DEFAULTS = { lead: 0.5, gap: 0.45, sectionGap: 0.9, revealGap: 0.95, tail: 1.8, transition: 0.35 };

export function computeTimeline(scenes, opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  if (!scenes.length) throw new Error('No hay escenas.');
  const n = scenes.length;
  const starts = [o.lead];
  const gaps = [];
  for (let i = 0; i < n; i++) {
    const a = Number(scenes[i].audioDuration);
    if (!(a > 0)) throw new Error(`La escena ${scenes[i].n} no tiene duración de audio.`);
    if (i < n - 1) {
      const next = scenes[i + 1];
      const g = next.sfx === 'revelacion' ? o.revealGap : next.sectionIndex !== scenes[i].sectionIndex ? o.sectionGap : o.gap;
      gaps.push(g);
      starts.push(starts[i] + a + g);
    }
  }
  const total = starts[n - 1] + Number(scenes[n - 1].audioDuration) + o.tail;
  const trans = gaps.map((g) => Math.min(o.transition, Math.max(0, g - 0.05)));
  const entries = scenes.map((s, i) => {
    const start = starts[i];
    const audioEnd = start + Number(s.audioDuration);
    const next = i < n - 1 ? starts[i + 1] : total;
    const fadeIn = i === 0 ? 0 : trans[i - 1];
    const fadeOut = i < n - 1 ? trans[i] : 0;
    const visualStart = i === 0 ? 0 : start - fadeIn; // empieza a aparecer
    const fullFrom = i === 0 ? 0 : start;             // totalmente visible
    const fullUntil = next - fadeOut;                 // empieza a desaparecer
    const visualEnd = next;                           // ya no se ve
    const clip = i === 0 ? next : (next - start) + fadeIn;
    return { n: s.n, id: s.id, start: r3(start), audioEnd: r3(audioEnd), visualStart: r3(visualStart), fullFrom: r3(fullFrom), fullUntil: r3(fullUntil), visualEnd: r3(visualEnd), clip: r3(clip), transitionIn: r3(fadeIn), sfx: s.sfx || null };
  });
  return { total: r3(total), entries, options: o };
}

const r3 = (x) => Math.round(x * 1000) / 1000;

/** Errores de la línea de tiempo (vacío = correcta). */
export function validateTimeline(tl) {
  const errs = [];
  const E = tl.entries;
  E.forEach((e, i) => {
    if (e.fullFrom > e.start + 1e-3) errs.push(`Escena ${e.n}: la imagen no está completa cuando empieza su narración.`);
    if (e.fullUntil < e.audioEnd - 1e-3) errs.push(`Escena ${e.n}: la imagen empieza a desaparecer antes de que termine su narración.`);
    if (i > 0 && e.visualStart < E[i - 1].audioEnd - 1e-3) errs.push(`Escena ${e.n}: la imagen aparece antes de que termine la narración de la escena ${E[i - 1].n}.`);
    if (i > 0 && Math.abs(E[i - 1].visualEnd - e.start) > 1e-3) errs.push(`Escena ${e.n}: hueco o solapamiento en la secuencia.`);
    if (e.clip <= 0) errs.push(`Escena ${e.n}: duración de clip no válida.`);
  });
  const sum = E.reduce((a, e, i) => a + e.clip - (i > 0 ? e.transitionIn : 0), 0);
  if (Math.abs(sum - tl.total) > 0.01) errs.push(`La suma de clips (${sum.toFixed(3)} s) no coincide con la duración total (${tl.total} s).`);
  return errs;
}
