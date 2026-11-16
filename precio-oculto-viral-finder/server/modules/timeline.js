// Editor automático: calcula cuándo suena cada fragmento y cuándo se ve cada imagen.
// Regla central: mientras suena la narración de la escena N, en pantalla está SOLO y COMPLETA la imagen N.
// El fundido hacia la imagen siguiente ocurre en la pausa entre narraciones.
export const GAPS = { intro: 0.6, normal: 0.4, cambioParte: 0.8, revelacion: 1.0, final: 2.0, fundido: 0.3 };

export function buildTimeline(scenes, g = GAPS) {
  if (!scenes.length) throw new Error('No hay escenas.');
  const items = [];
  let t = g.intro;
  scenes.forEach((s, i) => {
    if (!(s.audio_sec > 0)) throw new Error(`La escena ${s.n} no tiene audio medido.`);
    const next = scenes[i + 1];
    const pause = !next ? g.final : next.sfx === 'revelacion' ? g.revelacion : next.part !== s.part ? g.cambioParte : g.normal;
    items.push({ n: s.n, speechStart: t, speechEnd: t + s.audio_sec, pause, sfx: s.sfx || null });
    t += s.audio_sec + pause;
  });
  const total = t;
  items.forEach((it, i) => {
    const prev = items[i - 1], next = items[i + 1];
    it.fadeIn = prev ? Math.min(g.fundido, prev.pause - 0.05) : 0;
    it.showFrom = prev ? it.speechStart - it.fadeIn : 0;         // empieza a aparecer (en la pausa anterior)
    it.fullFrom = prev ? it.speechStart : 0;                       // completamente visible
    it.hideAt = next ? next.speechStart : total;                   // ya reemplazada por la siguiente
  });
  // fullUntil depende del fundido de la siguiente: segunda pasada
  items.forEach((it, i) => { const next = items[i + 1]; it.fullUntil = next ? next.speechStart - next.fadeIn : total; });
  items.forEach((it) => { it.clip = it.hideAt - it.showFrom; });
  return { total: r(total), items: items.map((it) => Object.fromEntries(Object.entries(it).map(([k, v]) => [k, typeof v === 'number' ? r(v) : v]))) };
}

const r = (x) => Math.round(x * 1000) / 1000;

/** Problemas de sincronización (lista vacía = correcta). */
export function checkTimeline(tl) {
  const errs = [];
  tl.items.forEach((it, i) => {
    const prev = tl.items[i - 1];
    if (it.fullFrom > it.speechStart + 1e-3) errs.push(`Escena ${it.n}: la imagen no está completa al empezar su narración.`);
    if (it.fullUntil < it.speechEnd - 1e-3) errs.push(`Escena ${it.n}: la imagen se va antes de terminar su narración.`);
    if (prev && it.showFrom < prev.speechEnd - 1e-3) errs.push(`Escena ${it.n}: aparece mientras aún se narra la escena ${prev.n}.`);
    if (prev && Math.abs(prev.hideAt - it.speechStart) > 1e-3) errs.push(`Escena ${it.n}: hueco o solapamiento.`);
    if (it.n !== i + 1) errs.push(`Escena ${it.n}: fuera de orden.`);
  });
  const covered = tl.items.reduce((a, it) => a + it.clip - it.fadeIn, 0);
  if (Math.abs(covered - tl.total) > 0.01) errs.push(`Las imágenes cubren ${covered.toFixed(2)} s de ${tl.total} s.`);
  return errs;
}
