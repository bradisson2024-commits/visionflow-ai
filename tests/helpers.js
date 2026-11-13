'use strict';
// Utilidades de prueba: genera medios reales con FFmpeg en una carpeta temporal.
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

function makeMedia(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const imgs = [];
  const colors = ['red', 'green', 'blue', 'yellow'];
  colors.forEach((c, i) => {
    const f = path.join(dir, `escena_${String(i + 1).padStart(3, '0')}.png`);
    execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'lavfi', '-i', `color=c=${c}:s=1280x720`, '-vf',
      `drawtext=text='${i + 1}':fontsize=300:fontcolor=white:x=(w-tw)/2:y=(h-th)/2`, '-frames:v', '1', f]);
    imgs.push(f);
  });
  const audio = path.join(dir, 'voz.mp3');
  execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=6', '-c:a', 'libmp3lame', audio]);
  const wav = path.join(dir, 'voz.wav');
  execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=330:duration=3', wav]);
  const m4a = path.join(dir, 'voz.m4a');
  execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=550:duration=2', '-c:a', 'aac', m4a]);
  const txt = path.join(dir, 'escenas_narracion.txt');
  fs.writeFileSync(txt, 'Había una vez un zorro.\nEl zorro corrió por el bosque durante muchas horas sin descanso.\nLlegó al río.\nY allí se quedó a vivir para siempre.\n');
  return { imgs, audio, wav, m4a, txt };
}

function tmpDir(prefix) { return fs.mkdtempSync(path.join(os.tmpdir(), prefix)); }

module.exports = { makeMedia, tmpDir };
