'use strict';
// Motor de exportación MP4 del Editor RaulitoShow IA (FFmpeg real).
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const storage = require('./storage');
const { probe, runFfmpeg } = require('./media');

const FPS = 30;
const ZOOM_AMOUNT = 0.08; // Movimiento suave: zoom digital de 1.00x a 1.08x durante cada escena.
const jobs = new Map();

const STEP_NAMES = [
  'Validar las imágenes',
  'Validar el audio',
  'Comprobar las duraciones',
  'Preparar las escenas',
  'Aplicar los efectos',
  'Incorporar el audio',
  'Generar el MP4',
  'Validar el archivo',
  'Mostrar dónde se guardó',
];

// Resolución de salida según la proporción de la primera imagen y la calidad elegida.
function outputSize(w, h, quality) {
  const base = quality === '720p' ? 720 : 1080;
  const r = w / h;
  let W, H;
  if (r >= 0.9 && r <= 1.1) { W = base; H = base; }                       // 1:1
  else if (r > 1.1 && r < 1.5) { W = Math.round(base * 4 / 3); H = base; } // 4:3
  else if (r >= 1.5) { W = Math.round(base * 16 / 9); H = base; }          // 16:9
  else { W = base; H = Math.round(base * 16 / 9); }                        // 9:16
  return { W: W - (W % 2), H: H - (H % 2) };
}

function newJob(projectId) {
  const id = crypto.randomUUID();
  const job = {
    id, projectId, state: 'running', createdAt: new Date().toISOString(),
    steps: STEP_NAMES.map(name => ({ name, status: 'pending', detail: '' })),
    percent: 0, warnings: [], error: null, output: null,
  };
  jobs.set(id, job);
  return job;
}

function getJob(id) { return jobs.get(id) || null; }

function stepStart(job, i, detail = '') { job.steps[i].status = 'running'; job.steps[i].detail = detail; }
function stepDone(job, i, detail) { job.steps[i].status = 'done'; if (detail != null) job.steps[i].detail = detail; }

// Pesos de cada etapa en el porcentaje total (la renderización de escenas es la parte larga).
const W_BEFORE = 5, W_SCENES = 80, W_MUX = 13;

async function runExport(job, opts) {
  const { projectId, scenes, audio, zoom, quality } = opts;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ya-export-'));
  let cur = 0;
  try {
    // 1. Validar imágenes
    stepStart(job, 0); cur = 0;
    if (!Array.isArray(scenes) || scenes.length === 0) throw new Error('No hay imágenes cargadas.');
    const imgs = [];
    for (let i = 0; i < scenes.length; i++) {
      const s = scenes[i];
      const kind = s.kind === 'flow' ? 'flow' : 'imagenes';
      const file = storage.filePath(projectId, kind, s.file);
      let info;
      try { info = await probe(file); } catch (e) { throw new Error(`La imagen de la escena ${i + 1} (${s.file}) no se puede leer: ${e.message}`); }
      if (!info.video || !info.video.width) throw new Error(`La escena ${i + 1} (${s.file}) no es una imagen válida.`);
      imgs.push({ file, width: info.video.width, height: info.video.height });
      job.steps[0].detail = `${i + 1}/${scenes.length}`;
    }
    stepDone(job, 0, `${imgs.length} imágenes válidas`);

    // 2. Validar audio
    stepStart(job, 1); cur = 1;
    if (!audio || !audio.file) throw new Error('Falta el audio (la voz). Carga un archivo MP3, WAV o M4A.');
    const audioFile = storage.filePath(projectId, 'audio', audio.file);
    let aInfo;
    try { aInfo = await probe(audioFile); } catch (e) { throw new Error(`El audio no se puede leer: ${e.message}`); }
    if (!aInfo.audio || !aInfo.duration) throw new Error('El archivo de audio no contiene una pista de audio válida.');
    stepDone(job, 1, `${aInfo.audio.codec}, ${aInfo.duration.toFixed(2)} s`);

    // 3. Comprobar duraciones
    stepStart(job, 2); cur = 2;
    const durations = scenes.map((s, i) => {
      const d = Number(s.duration);
      if (!isFinite(d) || d < 0.2) throw new Error(`La escena ${i + 1} tiene una duración no válida (${s.duration}). Mínimo 0.2 s.`);
      return d;
    });
    const frames = durations.map(d => Math.max(1, Math.round(d * FPS)));
    const total = frames.reduce((a, b) => a + b, 0) / FPS;
    const diff = aInfo.duration - total;
    if (diff > 0.5) job.warnings.push(`El audio dura ${aInfo.duration.toFixed(2)} s y las escenas ${total.toFixed(2)} s: los últimos ${diff.toFixed(2)} s de audio quedarán fuera. Usa "Repartir con el audio" para ajustarlo.`);
    if (diff < -0.5) job.warnings.push(`Las escenas duran ${total.toFixed(2)} s y el audio ${aInfo.duration.toFixed(2)} s: el final del video quedará en silencio.`);
    stepDone(job, 2, `Total del video: ${total.toFixed(2)} s`);

    // 4. Preparar escenas
    stepStart(job, 3); cur = 3;
    const { W, H } = outputSize(imgs[0].width, imgs[0].height, quality);
    stepDone(job, 3, `${W}x${H} a ${FPS} fps, ${scenes.length} escenas`);
    job.percent = W_BEFORE;

    // 5. Aplicar efectos (render de cada escena a un segmento H.264)
    stepStart(job, 4, zoom ? 'Movimiento suave (zoom lento digital)' : 'Sin movimiento'); cur = 4;
    const totalFrames = frames.reduce((a, b) => a + b, 0);
    let doneFrames = 0;
    const segs = [];
    for (let i = 0; i < imgs.length; i++) {
      const F = frames[i];
      const seg = path.join(tmp, `seg_${String(i + 1).padStart(4, '0')}.mp4`);
      const fit = `scale=${W * (zoom ? 2 : 1)}:${H * (zoom ? 2 : 1)}:force_original_aspect_ratio=decrease,` +
        `pad=${W * (zoom ? 2 : 1)}:${H * (zoom ? 2 : 1)}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1`;
      let args;
      if (zoom) {
        const vf = `${fit},zoompan=z='1+${ZOOM_AMOUNT}*on/${Math.max(1, F - 1)}':` +
          `x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${F}:s=${W}x${H}:fps=${FPS},format=yuv420p`;
        args = ['-i', imgs[i].file, '-vf', vf, '-frames:v', String(F)];
      } else {
        args = ['-loop', '1', '-framerate', String(FPS), '-i', imgs[i].file,
          '-vf', `${fit},format=yuv420p`, '-frames:v', String(F)];
      }
      args.push('-an', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-r', String(FPS),
        '-pix_fmt', 'yuv420p', '-video_track_timescale', '15360', seg);
      job.steps[4].detail = `Escena ${i + 1}/${imgs.length}`;
      await runFfmpeg(args, p => {
        if (p.frame != null) job.percent = W_BEFORE + W_SCENES * (doneFrames + Math.min(p.frame, F)) / totalFrames;
      });
      doneFrames += F;
      job.percent = W_BEFORE + W_SCENES * doneFrames / totalFrames;
      segs.push(seg);
    }
    stepDone(job, 4, `${imgs.length} escenas renderizadas`);

    // 6. Incorporar audio (normalizar a AAC con la duración exacta del video)
    stepStart(job, 5); cur = 5;
    const aac = path.join(tmp, 'audio.m4a');
    await runFfmpeg(['-i', audioFile, '-vn', '-af', 'apad', '-t', total.toFixed(3), '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', aac]);
    job.percent = W_BEFORE + W_SCENES + 3;
    stepDone(job, 5, 'Audio AAC 192 kbps preparado');

    // 7. Generar MP4
    stepStart(job, 6); cur = 6;
    const list = path.join(tmp, 'lista.txt');
    fs.writeFileSync(list, segs.map(s => `file '${s.replace(/'/g, "'\\''")}'`).join('\n'));
    const outDir = storage.kindDir(projectId, 'exportaciones');
    const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
    const out = storage.uniquePath(outDir, `video_${stamp}.mp4`);
    const partial = out + '.part.mp4';
    await runFfmpeg(['-f', 'concat', '-safe', '0', '-i', list, '-i', aac, '-map', '0:v:0', '-map', '1:a:0',
      '-c:v', 'copy', '-c:a', 'copy', '-movflags', '+faststart', '-t', total.toFixed(3), partial], p => {
      if (p.outTimeSec != null) job.percent = W_BEFORE + W_SCENES + 3 + 9 * Math.min(1, p.outTimeSec / total);
    });
    fs.renameSync(partial, out);
    stepDone(job, 6, path.basename(out));

    // 8. Validar archivo
    stepStart(job, 7); cur = 7;
    const v = await probe(out);
    if (!v.video || v.video.codec !== 'h264') throw new Error('Validación: el MP4 no contiene video H.264.');
    if (!v.audio || v.audio.codec !== 'aac') throw new Error('Validación: el MP4 no contiene audio AAC.');
    if (Math.abs(v.duration - total) > 0.25) throw new Error(`Validación: duración ${v.duration.toFixed(2)} s distinta de la esperada ${total.toFixed(2)} s.`);
    if (v.video.width !== W || v.video.height !== H) throw new Error('Validación: resolución inesperada.');
    const size = fs.statSync(out).size;
    stepDone(job, 7, `H.264 ${W}x${H} + AAC, ${v.duration.toFixed(2)} s, ${(size / 1048576).toFixed(1)} MB`);

    // 9. Mostrar dónde se guardó
    stepStart(job, 8); cur = 8;
    job.output = { name: path.basename(out), path: out, size, duration: v.duration, width: W, height: H };
    stepDone(job, 8, out);
    job.percent = 100;
    job.state = 'done';
  } catch (e) {
    job.steps[cur].status = 'error';
    job.steps[cur].detail = e.message;
    job.error = e.message;
    job.state = 'error';
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

function startExport(opts) {
  const job = newJob(opts.projectId);
  runExport(job, opts);
  return job;
}

module.exports = { startExport, getJob, outputSize, ZOOM_AMOUNT, FPS };
