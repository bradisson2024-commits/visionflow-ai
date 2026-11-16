// Verificación final sobre los archivos reales. El proyecto sólo se marca «terminado» si todo pasa.
import fs from 'node:fs';
import { ffmpegRaw, probe, grayPixels } from '../services/ffmpeg.js';
import { checkTimeline } from './timeline.js';

const item = (id, nombre, ok, detalle, arreglo, aviso = false) => ({ id, nombre, ok, detalle, arreglo: ok ? null : arreglo, aviso });
const diff = (a, b) => { let d = 0; for (let i = 0; i < a.length; i++) d += Math.abs(a[i] - b[i]); return d / a.length; };

async function meanDb(file, from, len) {
  const { stderr } = await ffmpegRaw(['-ss', from.toFixed(3), '-t', len.toFixed(3), '-i', file, '-af', 'volumedetect', '-f', 'null', '-']);
  const m = /mean_volume:\s*(-?[\d.]+|-inf) dB/.exec(stderr);
  return m && m[1] !== '-inf' ? Number(m[1]) : -120;
}

/**
 * @param {{scenes:object[], timeline:object, images:string[], voice:string, bed:string, video:string, targetMinutes:number}} x
 */
export async function verify(x) {
  const out = [];
  const { scenes, timeline: tl } = x;
  const noImg = scenes.filter((s, i) => !fs.existsSync(x.images[i])).map((s) => s.n);
  out.push(item('imagenes', 'Todas las escenas tienen imagen', !noImg.length, noImg.length ? `Faltan: ${noImg.join(', ')}` : `${scenes.length} imágenes`, 'Genera las imágenes que faltan.'));
  const noAudio = scenes.filter((s) => !s.audio_file || !fs.existsSync(s.audio_file) || !(s.audio_sec > 0)).map((s) => s.n);
  out.push(item('audio', 'Todos los fragmentos tienen audio', !noAudio.length, noAudio.length ? `Sin audio: ${noAudio.join(', ')}` : `${scenes.length} fragmentos de voz`, 'Repite la etapa de voz.'));
  const notOk = scenes.filter((s) => !['aprobada', 'aprobada_manual'].includes(s.review?.state)).map((s) => s.n);
  out.push(item('coherencia', 'La narración coincide con las imágenes', !notOk.length, notOk.length ? `Sin aprobar: ${notOk.join(', ')}` : 'Todas aprobadas', 'Revisa esas escenas en el editor.'));
  const tlErr = checkTimeline(tl);
  out.push(item('orden', 'Imágenes en orden y sincronizadas', !tlErr.length, tlErr.length ? tlErr.slice(0, 4).join(' ') : 'Cada imagen cubre toda su narración; fundidos sólo en pausas', 'Vuelve a exportar.'));

  if (!fs.existsSync(x.video)) { out.push(item('mp4', 'Existe el MP4', false, 'No hay archivo', 'Exporta el video.')); return done(out); }
  const info = await probe(x.video);
  const v = info.streams.find((s) => s.codec_type === 'video'), a = info.streams.find((s) => s.codec_type === 'audio');
  let decode = '';
  try { decode = (await ffmpegRaw(['-v', 'error', '-i', x.video, '-f', 'null', '-'])).stderr.trim(); } catch (e) { decode = e.message; }
  out.push(item('reproducible', 'El MP4 se puede reproducir', v?.codec_name === 'h264' && a?.codec_name === 'aac' && !decode, `${v?.codec_name}/${a?.codec_name} ${v?.width}×${v?.height}${decode ? ` · errores: ${decode.slice(0, 200)}` : ' · decodificado completo sin errores'}`, 'Vuelve a exportar.'));
  const dur = Number(info.format.duration);
  out.push(item('duracion', 'Duración prevista', Math.abs(dur - tl.total) < 0.5, `${dur.toFixed(2)} s (prevista ${tl.total.toFixed(2)} s)`, 'Vuelve a exportar.'));
  const tm = x.targetMinutes;
  out.push(item('objetivo', `Cerca de la duración objetivo (${tm} min)`, Math.abs(dur / 60 - tm) <= 1.5, `${(dur / 60).toFixed(1)} min`, 'Ajusta la longitud del guion.', true));

  const { stderr: bd } = await ffmpegRaw(['-i', x.video, '-vf', 'blackdetect=d=0.1:pix_th=0.1', '-an', '-f', 'null', '-']);
  const blacks = [...bd.matchAll(/black_start:([\d.]+) black_end:([\d.]+)/g)].map((m) => `${m[1]}–${m[2]} s`);
  out.push(item('negros', 'Sin pantallas negras', !blacks.length, blacks.length ? blacks.join(', ') : 'Ninguna', 'Revisa las imágenes de esos tramos.'));

  const refs = [];
  for (const f of x.images) refs.push(fs.existsSync(f) ? await grayPixels(f) : null);
  const wrong = [], moving = [];
  for (const [i, it] of tl.items.entries()) {
    const mid = await grayPixels(x.video, { at: (it.speechStart + it.speechEnd) / 2 });
    let best = -1, bestD = Infinity;
    refs.forEach((r, k) => { if (r) { const d = diff(mid, r); if (d < bestD) { bestD = d; best = k; } } });
    if (best !== i && refs[i] && diff(mid, refs[i]) - bestD > 0.5) wrong.push(`${it.n}→muestra la ${best + 1}`);
    const early = await grayPixels(x.video, { at: it.speechStart + 0.05 });
    const late = await grayPixels(x.video, { at: Math.max(it.speechStart + 0.1, it.speechEnd - 0.1) });
    if (diff(early, late) > 1.5) moving.push(it.n);
  }
  out.push(item('sincronia', 'Cada narración muestra su imagen (comprobado en el MP4)', !wrong.length, wrong.length ? wrong.join(', ') : `${tl.items.length} fotogramas comprobados`, 'Vuelve a exportar.'));
  out.push(item('estatico', 'Imágenes estáticas, sin animación', !moving.length, moving.length ? `Cambian dentro de: ${moving.join(', ')}` : 'Cada imagen permanece fija', 'Vuelve a exportar.'));

  const quiet = [];
  let worst = Infinity;
  for (const it of tl.items) {
    const len = Math.max(0.2, it.speechEnd - it.speechStart);
    const voz = await meanDb(x.voice, it.speechStart, len);
    if (voz < -45) quiet.push(it.n);
    worst = Math.min(worst, voz - await meanDb(x.bed, it.speechStart, len));
  }
  out.push(item('voz', 'El audio no está cortado', !quiet.length, quiet.length ? `Sin voz audible en: ${quiet.join(', ')}` : 'Voz presente en todos los tramos', 'Repite la voz de esas escenas.'));
  out.push(item('musica', 'La música no tapa la voz', worst >= 12, `Margen mínimo voz–música: ${worst.toFixed(1)} dB (se exige 12 dB)`, 'Baja el nivel de la música en Configuración.'));
  return done(out);
}

const done = (checks) => ({ ok: checks.every((c) => c.ok || c.aviso), checks, at: new Date().toISOString() });
