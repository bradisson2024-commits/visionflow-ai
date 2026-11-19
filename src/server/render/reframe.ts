/**
 * Planificación del encuadre a partir de las detecciones de rostros.
 *
 * Objetivos:
 *  - mantener visible al hablante principal y no cortarle la cabeza;
 *  - no saltar entre personas de forma errática: se mantiene el sujeto hasta
 *    que desaparece durante un tiempo, y entonces se cambia;
 *  - movimientos de cámara suaves (mediana + zona muerta + seguimiento amortiguado);
 *  - con dos personas presentes casi todo el tiempo y salida vertical, se
 *    propone el modo "dividido" (una persona arriba y otra abajo).
 */

export type FaceSample = { t: number; faces: [number, number, number, number, number][] };
export type Detections = { width: number; height: number; samples: FaceSample[] };

export type CropPlan = {
  mode: "track" | "center" | "manual" | "split";
  cropW: number;
  cropH: number;
  /** Keyframes de la esquina superior izquierda del recorte (s relativos al clip). */
  keys: { t: number; x: number; y: number }[];
  /** Para el modo dividido: un plan por persona (arriba/abajo). */
  split?: { cropW: number; cropH: number; keys: { t: number; x: number; y: number }[] }[];
  facesFound: number; // % de muestras con rostro
  note: string;
};

const even = (n: number) => Math.max(2, Math.floor(n / 2) * 2);
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Tamaño máximo de recorte de la fuente con la relación de aspecto de salida. */
export function cropBox(srcW: number, srcH: number, outAspect: number, zoom = 1) {
  let cw: number, ch: number;
  if (srcW / srcH > outAspect) {
    ch = srcH;
    cw = srcH * outAspect;
  } else {
    cw = srcW;
    ch = srcW / outAspect;
  }
  return { cropW: even(cw / zoom), cropH: even(ch / zoom) };
}

function median(a: number[]) {
  const s = [...a].sort((x, y) => x - y);
  return s[Math.floor(s.length / 2)];
}

/** Elige, muestra a muestra, la cara del sujeto con histéresis para evitar saltos. */
function followSubject(samples: FaceSample[], srcW: number, holdSec = 1.2) {
  const pts: ({ cx: number; cy: number; h: number } | null)[] = [];
  let cur: { cx: number; cy: number; h: number } | null = null;
  let lostFor = 0;
  let prevT = 0;
  for (const s of samples) {
    const dt = s.t - prevT;
    prevT = s.t;
    const faces = s.faces.filter((f) => f[4] >= 0.6);
    if (!faces.length) {
      lostFor += dt;
      pts.push(lostFor <= holdSec ? cur : null);
      if (lostFor > holdSec) cur = null;
      continue;
    }
    if (cur) {
      // la cara más cercana al sujeto actual
      const near = faces.reduce((b, f) => (Math.abs(f[0] - cur!.cx) < Math.abs(b[0] - cur!.cx) ? f : b));
      if (Math.abs(near[0] - cur.cx) < srcW * 0.15) {
        cur = { cx: near[0], cy: near[1], h: near[3] };
        lostFor = 0;
        pts.push(cur);
        continue;
      }
      lostFor += dt;
      if (lostFor <= holdSec) {
        pts.push(cur);
        continue;
      }
    }
    // sin sujeto (o perdido): la cara más grande
    const big = faces.reduce((b, f) => (f[2] * f[3] > b[2] * b[3] ? f : b));
    cur = { cx: big[0], cy: big[1], h: big[3] };
    lostFor = 0;
    pts.push(cur);
  }
  return pts;
}

/** Camino de cámara suave: mediana, zona muerta y seguimiento con velocidad limitada. */
function smoothPath(ts: number[], targets: (number | null)[], fallback: number, deadzone: number, maxSpeed: number) {
  const filled: number[] = [];
  let last = targets.find((v) => v != null) ?? fallback;
  for (const v of targets) {
    if (v != null) last = v;
    filled.push(last);
  }
  const med = filled.map((_, i) => median(filled.slice(Math.max(0, i - 2), i + 3)));
  const out: number[] = [];
  let cam = med[0];
  for (let i = 0; i < med.length; i++) {
    const dt = i ? ts[i] - ts[i - 1] : 0;
    const diff = med[i] - cam;
    if (Math.abs(diff) > deadzone) {
      const want = diff - Math.sign(diff) * deadzone * 0.5;
      const step = clamp(want, -maxSpeed * dt, maxSpeed * dt);
      cam += step;
    }
    out.push(cam);
  }
  return out;
}

/** Reduce keyframes a los puntos donde cambia la dirección o la velocidad. */
function simplify(keys: { t: number; x: number; y: number }[], tol = 2) {
  if (keys.length <= 2) return keys;
  const out = [keys[0]];
  for (let i = 1; i < keys.length - 1; i++) {
    const a = out[out.length - 1];
    const c = keys[i + 1];
    const b = keys[i];
    const r = (b.t - a.t) / (c.t - a.t || 1);
    const ix = a.x + (c.x - a.x) * r;
    const iy = a.y + (c.y - a.y) * r;
    if (Math.abs(ix - b.x) > tol || Math.abs(iy - b.y) > tol) out.push(b);
  }
  out.push(keys[keys.length - 1]);
  return out.slice(0, 120);
}

function trackPlan(det: Detections, cropW: number, cropH: number, pts: ({ cx: number; cy: number; h: number } | null)[]) {
  const { width: W, height: H, samples } = det;
  const ts = samples.map((s) => s.t);
  const xs = smoothPath(ts, pts.map((p) => (p ? p.cx : null)), W / 2, cropW * 0.08, cropW * 0.9);
  // Vertical: la cara en el tercio superior del recorte, sin cortar la cabeza.
  const ys = smoothPath(ts, pts.map((p) => (p ? p.cy - p.h * 0.15 : null)), H / 2, cropH * 0.08, cropH * 0.9);
  const keys = ts.map((t, i) => ({
    t,
    x: Math.round(clamp(xs[i] - cropW / 2, 0, W - cropW)),
    y: Math.round(clamp(ys[i] - cropH * 0.38, 0, H - cropH)),
  }));
  return simplify(keys);
}

export function planCrop(
  det: Detections | null,
  outAspect: number,
  opts: { mode: "auto" | "center" | "manual"; manualFocus?: { x: number; y: number }; zoom?: number; allowSplit: boolean },
  srcW: number,
  srcH: number,
): CropPlan {
  const zoom = clamp(opts.zoom ?? 1, 1, 3);
  const { cropW, cropH } = cropBox(srcW, srcH, outAspect, zoom);
  const centered = (fx = 0.5, fy = 0.5) => [{ t: 0, x: Math.round(clamp(fx * srcW - cropW / 2, 0, srcW - cropW)), y: Math.round(clamp(fy * srcH - cropH / 2, 0, srcH - cropH)) }];

  if (opts.mode === "manual") {
    const f = opts.manualFocus ?? { x: 0.5, y: 0.5 };
    return { mode: "manual", cropW, cropH, keys: centered(f.x, f.y), facesFound: 0, note: "Encuadre manual." };
  }
  if (opts.mode === "center" || cropW >= srcW - 2 && cropH >= srcH - 2)
    return { mode: "center", cropW, cropH, keys: centered(), facesFound: 0, note: cropW >= srcW - 2 && cropH >= srcH - 2 ? "La relación de aspecto coincide con la del video: sin recorte." : "Recorte centrado." };
  if (!det || det.samples.length === 0) return { mode: "center", cropW, cropH, keys: centered(), facesFound: 0, note: "No se pudo analizar el video para detectar rostros: recorte centrado." };

  const withFace = det.samples.filter((s) => s.faces.some((f) => f[4] >= 0.6));
  const facesFound = Math.round((withFace.length / det.samples.length) * 100);
  if (facesFound < 15) return { mode: "center", cropW, cropH, keys: centered(), facesFound, note: `Rostros visibles sólo en el ${facesFound}% del clip: recorte centrado. Puedes ajustar el encuadre manualmente.` };

  // ¿Dos personas separadas casi todo el tiempo? → modo dividido (sólo salida vertical).
  const two = det.samples.filter((s) => {
    const f = s.faces.filter((x) => x[4] >= 0.6).sort((a, b) => a[0] - b[0]);
    return f.length >= 2 && f[f.length - 1][0] - f[0][0] > cropW * 0.9;
  });
  if (opts.allowSplit && outAspect < 1 && two.length / det.samples.length > 0.6) {
    const halfAspect = outAspect * 2; // cada mitad es el doble de ancha que alta respecto al total
    const box = cropBox(srcW, srcH, halfAspect, zoom);
    const side = (pick: "left" | "right") =>
      det.samples.map((s) => {
        const f = s.faces.filter((x) => x[4] >= 0.6).sort((a, b) => a[0] - b[0]);
        if (!f.length) return null;
        const c = pick === "left" ? f[0] : f[f.length - 1];
        return { cx: c[0], cy: c[1], h: c[3] };
      });
    return {
      mode: "split",
      cropW,
      cropH,
      keys: centered(),
      split: [
        { ...box, keys: trackPlan(det, box.cropW, box.cropH, side("left")) },
        { ...box, keys: trackPlan(det, box.cropW, box.cropH, side("right")) },
      ],
      facesFound,
      note: "Dos personas detectadas: pantalla dividida (una arriba y otra abajo).",
    };
  }

  const pts = followSubject(det.samples, srcW);
  return { mode: "track", cropW, cropH, keys: trackPlan(det, cropW, cropH, pts), facesFound, note: `Seguimiento del rostro principal (visible en el ${facesFound}% del clip).` };
}

/** Expresión FFmpeg por tramos lineales para una coordenada a lo largo del tiempo `t`. */
export function piecewiseExpr(keys: { t: number; v: number }[]): string {
  if (keys.length === 1) return String(keys[0].v);
  let expr = String(keys[keys.length - 1].v);
  for (let i = keys.length - 2; i >= 0; i--) {
    const a = keys[i];
    const b = keys[i + 1];
    const span = Math.max(0.001, b.t - a.t);
    const seg = `${a.v}+(${b.v - a.v})*(t-${a.t.toFixed(3)})/${span.toFixed(3)}`;
    expr = `if(lt(t,${b.t.toFixed(3)}),${seg},${expr})`;
  }
  return `if(lt(t,${keys[0].t.toFixed(3)}),${keys[0].v},${expr})`;
}
