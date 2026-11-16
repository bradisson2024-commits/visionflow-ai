// Módulo 13 · Paso 8: revisión antes de exportar. Cada comprobación se mide sobre los archivos reales.
import fs from 'node:fs';
import { config } from './config.js';
import { run, probe, grayThumb } from './media.js';
import { validateTimeline } from './timeline.js';
import { isApproved } from './coherence.js';
import { audioLooksComplete } from './tts.js';

const check = (id, label, ok, detail, fix) => ({ id, label, ok, detail, fix: ok ? null : fix });

async function meanVolume(file, start, dur) {
  const { err } = await run(config.ffmpeg, ['-hide_banner', '-ss', start.toFixed(3), '-t', dur.toFixed(3), '-i', file, '-af', 'volumedetect', '-f', 'null', '-']);
  const m = err.match(/mean_volume:\s*(-?[\d.]+|-inf) dB/);
  return m ? (m[1] === '-inf' ? -120 : Number(m[1])) : -120;
}

function frameDiff(a, b) {
  let d = 0;
  for (let i = 0; i < a.length; i++) d += Math.abs(a[i] - b[i]);
  return d / a.length;
}

/**
 * @param {object} p proyecto
 * @param {(scene)=>string} imageOf
 * @param {(scene)=>string} wavOf
 * @param {{video:string, narration:string, bed:string}} files
 */
export async function verifyProject({ p, imageOf, wavOf, files, timeline }) {
  const scenes = p.scenes;
  const checks = [];

  // 1. Todas las escenas tienen imagen
  const noImg = scenes.filter((s) => !fs.existsSync(imageOf(s))).map((s) => s.n);
  checks.push(check('imagenes', 'Todas las escenas tienen imagen', !noImg.length, noImg.length ? `Faltan imágenes en escenas: ${noImg.join(', ')}` : `${scenes.length} imágenes`, 'Genera las imágenes que faltan.'));

  // 2. Todos los fragmentos tienen audio completo
  const badAudio = [];
  for (const s of scenes) {
    if (!fs.existsSync(wavOf(s)) || !s.audio) { badAudio.push(`${s.n} (sin audio)`); continue; }
    const c = audioLooksComplete(s.audio);
    if (!c.ok) badAudio.push(`${s.n} (${c.reason})`);
  }
  checks.push(check('audio', 'Todos los fragmentos tienen audio completo', !badAudio.length, badAudio.length ? `Problemas: ${badAudio.join('; ')}` : `${scenes.length} fragmentos de voz`, 'Regenera la voz de esas escenas.'));

  // 3. Coherencia narración–imagen aprobada
  const notApproved = scenes.filter((s) => !isApproved(s)).map((s) => `${s.n} (${s.review?.state || 'sin revisar'})`);
  checks.push(check('coherencia', 'La narración coincide con las imágenes', !notApproved.length, notApproved.length ? `Sin aprobar: ${notApproved.join(', ')}` : 'Todas las escenas aprobadas (IA o revisión manual)', 'Revisa, corrige o aprueba esas escenas en la pestaña Escenas.'));

  // 4. Línea de tiempo correcta (orden, sin huecos, imagen cubre toda su narración)
  const tlErrs = validateTimeline(timeline);
  const ordered = timeline.entries.every((e, i) => e.n === i + 1) && scenes.every((s, i) => s.n === i + 1);
  checks.push(check('linea_tiempo', 'Imágenes en orden y sincronizadas con su narración', !tlErrs.length && ordered, tlErrs.length ? tlErrs.slice(0, 5).join(' ') : 'Cada imagen cubre por completo su narración; transiciones sólo en las pausas', 'Vuelve a montar el video.'));

  const videoExists = fs.existsSync(files.video);
  if (!videoExists) {
    checks.push(check('mp4', 'El archivo MP4 existe', false, 'No se encontró el MP4 final.', 'Ejecuta el montaje.'));
    return summarize(checks);
  }

  // 5. MP4 reproducible: contenedor, flujos y decodificación completa sin errores
  let info;
  try { info = await probe(files.video); } catch (e) { info = null; checks.push(check('mp4', 'El MP4 se puede reproducir', false, e.message, 'Vuelve a montar el video.')); }
  if (info) {
    const v = info.streams.find((s) => s.codec_type === 'video');
    const a = info.streams.find((s) => s.codec_type === 'audio');
    let decodeErr = '';
    try {
      const { err } = await run(config.ffmpeg, ['-hide_banner', '-v', 'error', '-i', files.video, '-f', 'null', '-']);
      decodeErr = err.trim();
    } catch (e) { decodeErr = e.message; }
    const ok = v?.codec_name === 'h264' && a?.codec_name === 'aac' && v.width === 1920 && v.height === 1080 && !decodeErr;
    checks.push(check('mp4', 'El MP4 se puede reproducir', ok,
      `${v?.codec_name}/${a?.codec_name} ${v?.width}x${v?.height}${decodeErr ? ` · errores al decodificar: ${decodeErr.slice(0, 300)}` : ' · decodificado completo sin errores'}`,
      'Vuelve a montar el video.'));

    // 6. Duración prevista
    const dur = Number(info.format.duration);
    const durOk = Math.abs(dur - timeline.total) <= 0.5;
    checks.push(check('duracion', 'El video tiene la duración prevista', durOk, `Duración real ${dur.toFixed(2)} s · prevista ${timeline.total.toFixed(2)} s`, 'Vuelve a montar el video.'));
    const [minM, maxM] = config.targetMinutes;
    const inTarget = dur >= minM * 60 - 30 && dur <= maxM * 60 + 30;
    checks.push({ ...check('duracion_objetivo', `Duración dentro del objetivo (${minM}–${maxM} min)`, inTarget, `${(dur / 60).toFixed(2)} min`, 'Amplía o recorta el guion y regenera.'), warning: true });
  }

  // 7. Sin espacios negros accidentales
  {
    const { err } = await run(config.ffmpeg, ['-hide_banner', '-i', files.video, '-vf', 'blackdetect=d=0.1:pix_th=0.10:pic_th=0.95', '-an', '-f', 'null', '-']).catch((e) => ({ err: e.stderr || e.message }));
    const blacks = [...err.matchAll(/black_start:([\d.]+) black_end:([\d.]+)/g)].map((m) => `${m[1]}–${m[2]} s`);
    checks.push(check('negros', 'Sin espacios negros', !blacks.length, blacks.length ? `Tramos negros: ${blacks.join(', ')}` : 'Ningún tramo negro detectado (blackdetect)', 'Revisa las imágenes de esos tramos y vuelve a montar.'));
  }

  // 8. Cada imagen aparece en su escena: se extrae un fotograma a mitad de cada narración y se compara con todas las imágenes
  {
    const wrong = [];
    const thumbs = [];
    for (const s of scenes) thumbs.push(fs.existsSync(imageOf(s)) ? await grayThumb(imageOf(s)) : null);
    for (const [i, e] of timeline.entries.entries()) {
      const tMid = (e.start + e.audioEnd) / 2;
      let frame;
      try { frame = await grayThumb(files.video, 32, 18, ['-ss', tMid.toFixed(3)]); } catch { wrong.push(`${e.n} (sin fotograma)`); continue; }
      let best = -1, bestD = Infinity;
      thumbs.forEach((t, k) => { if (t) { const d = frameDiff(frame, t); if (d < bestD) { bestD = d; best = k; } } });
      const own = thumbs[i] ? frameDiff(frame, thumbs[i]) : Infinity;
      if (best !== i && own - bestD > 0.5) wrong.push(`${e.n} (se ve la imagen de la escena ${best + 1})`);
      else if (own > 12) wrong.push(`${e.n} (fotograma distinto de su imagen, diferencia ${own.toFixed(1)})`);
    }
    checks.push(check('orden_real', 'En el MP4, cada narración muestra su propia imagen', !wrong.length, wrong.length ? `Escenas: ${wrong.join('; ')}` : `${scenes.length} fotogramas comprobados a mitad de cada narración`, 'Vuelve a montar el video.'));
  }

  // 9. La narración del MP4 no está cortada: hay voz en cada tramo y el final llega
  {
    const silentScenes = [];
    for (const e of timeline.entries) {
      const vol = await meanVolume(files.narration, e.start, Math.max(0.2, e.audioEnd - e.start));
      if (vol < -45) silentScenes.push(e.n);
    }
    checks.push(check('audio_cortado', 'El audio no está cortado', !silentScenes.length, silentScenes.length ? `Sin voz audible en escenas: ${silentScenes.join(', ')}` : 'Voz presente en todos los tramos de narración', 'Regenera la voz de esas escenas.'));
  }

  // 10. La música no tapa la voz: diferencia de nivel medida en cada tramo hablado
  {
    let worst = Infinity, worstScene = null;
    const step = Math.max(1, Math.floor(timeline.entries.length / 25));
    for (let i = 0; i < timeline.entries.length; i += step) {
      const e = timeline.entries[i];
      const d = Math.max(0.2, e.audioEnd - e.start);
      const voice = await meanVolume(files.narration, e.start, d);
      const bed = await meanVolume(files.bed, e.start, d);
      const diff = voice - bed;
      if (diff < worst) { worst = diff; worstScene = e.n; }
    }
    checks.push(check('musica', 'La música no tapa la voz', worst >= 12, `Margen mínimo voz–música: ${worst.toFixed(1)} dB (escena ${worstScene}); se exige ≥ 12 dB`, 'Baja el volumen de la música o usa otra pista y vuelve a montar.'));
  }

  // 11. Imagen fija: los personajes no se animan (la imagen no cambia dentro de su tramo)
  {
    const moving = [];
    const sample = timeline.entries.filter((_, i) => i % Math.max(1, Math.floor(timeline.entries.length / 12)) === 0);
    for (const e of sample) {
      const a = await grayThumb(files.video, 32, 18, ['-ss', (e.start + 0.05).toFixed(3)]).catch(() => null);
      const b = await grayThumb(files.video, 32, 18, ['-ss', Math.max(e.start + 0.1, e.audioEnd - 0.1).toFixed(3)]).catch(() => null);
      if (a && b && frameDiff(a, b) > 1.5) moving.push(e.n);
    }
    checks.push(check('estatico', 'Ilustraciones estáticas (sin animación)', !moving.length, moving.length ? `Cambios dentro de la escena: ${moving.join(', ')}` : 'Las imágenes permanecen fijas durante su narración', 'Vuelve a montar el video.'));
  }

  return summarize(checks);
}

function summarize(checks) {
  const blocking = checks.filter((c) => !c.ok && !c.warning);
  return { at: new Date().toISOString(), passed: blocking.length === 0, checks };
}
