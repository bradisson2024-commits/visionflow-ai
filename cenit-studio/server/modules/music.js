// Biblioteca de música y efectos. La biblioteca común se compone aquí mismo con osciladores de FFmpeg
// (obras originales de Cenit Studio, sin derechos de terceros). Cada usuario puede subir sus propias pistas
// indicando su licencia.
import fs from 'node:fs';
import { sql } from '../db/index.js';
import { put, scratch } from '../core/storage.js';
import { ffmpeg, duration } from '../services/ffmpeg.js';

const slug = (t) => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-');
const LICENSE = 'Obra original generada por Cenit Studio. Uso libre en tus vídeos, también monetizados.';
const chordTrack = (chords, sec, colour) => {
  const per = sec / chords.length;
  return chords.map((c) => `aevalsrc='(${c.map((f) => `0.08*sin(2*PI*${f}*t)`).join('+')}+0.06*sin(2*PI*${c[0] / 2}*t)*exp(-2*mod(t\\,${(per / 4).toFixed(2)})))*min(1\\,t/0.6)*min(1\\,(${per}-t)/0.6)':s=44100:d=${per}`).map((src) => ['-f', 'lavfi', '-i', src]).flat().concat(['-filter_complex', `${chords.map((_, i) => `[${i}:a]`).join('')}concat=n=${chords.length}:v=0:a=1,${colour},aformat=channel_layouts=stereo[m]`, '-map', '[m]']);
};

const TRACKS = [
  ['Misterio en la penumbra', 'misterio', [[146.83, 174.61, 220], [116.54, 146.83, 174.61], [130.81, 164.81, 196], [110, 130.81, 164.81]], 'lowpass=f=1800,aecho=0.7:0.5:240:0.3'],
  ['Marcha épica', 'épica', [[98, 123.47, 146.83], [87.31, 110, 130.81], [130.81, 164.81, 196], [110, 138.59, 164.81]], 'lowpass=f=3000,aecho=0.8:0.6:120|240:0.25|0.15'],
  ['Pulso de tensión', 'tensión', [[73.42, 87.31, 110], [77.78, 92.5, 116.54], [73.42, 87.31, 110], [69.3, 82.41, 103.83]], 'lowpass=f=1200,tremolo=f=2:d=0.5'],
  ['Horizonte inspirador', 'inspiradora', [[130.81, 164.81, 196], [196, 246.94, 293.66], [220, 261.63, 329.63], [174.61, 220, 261.63]], 'lowpass=f=4000,aecho=0.6:0.4:180:0.2'],
  ['Calma documental', 'calma', [[164.81, 196, 246.94], [146.83, 185, 220], [130.81, 164.81, 196], [146.83, 185, 220]], 'lowpass=f=2500'],
];
const SFX = [
  ['Whoosh de transición', 'transición', "anoisesrc=c=pink:a=0.5:d=0.7:r=44100,highpass=f=500,afade=t=in:d=0.35,afade=t=out:st=0.35:d=0.35"],
  ['Impacto grave', 'impacto', "aevalsrc='0.9*sin(2*PI*50*t)*exp(-4*t)':s=44100:d=1.4"],
  ['Revelación', 'revelación', "aevalsrc='0.5*sin(2*PI*65*t)*exp(-2.5*t)+0.2*sin(2*PI*988*t)*exp(-3*t)+0.15*sin(2*PI*1319*t)*exp(-3*t)':s=44100:d=1.6"],
  ['Campana', 'campana', "aevalsrc='0.4*sin(2*PI*880*t)*exp(-2*t)+0.2*sin(2*PI*1760*t)*exp(-3*t)':s=44100:d=2"],
  ['Latido', 'suspense', "aevalsrc='0.8*sin(2*PI*55*t)*(exp(-25*mod(t\\,0.9))+0.6*exp(-25*mod(t-0.18\\,0.9))*gte(t\\,0.18))':s=44100:d=3.6"],
];

export async function seedLibrary() {
  const [{ n }] = await sql`select count(*)::int as n from music_tracks where owner_id is null`;
  if (n >= TRACKS.length + SFX.length) return;
  await sql`delete from music_tracks where owner_id is null`;
  for (const [title, mood, chords, colour] of TRACKS) {
    const key = `biblioteca/musica/${slug(mood)}.mp3`;
    const f = scratch(key);
    await ffmpeg([...chordTrack([...chords, ...chords], 32, colour), '-c:a', 'libmp3lame', '-b:a', '160k', f]);
    await put(key, f, 'audio/mpeg');
    await sql`insert into music_tracks(kind, title, mood, path, duration, license) values ('musica', ${title}, ${mood}, ${key}, ${await duration(f)}, ${LICENSE})`;
  }
  for (const [title, mood, src] of SFX) {
    const key = `biblioteca/efectos/${slug(mood)}.mp3`;
    const f = scratch(key);
    await ffmpeg(['-f', 'lavfi', '-i', src, '-af', 'aformat=channel_layouts=stereo', '-c:a', 'libmp3lame', '-b:a', '160k', f]);
    await put(key, f, 'audio/mpeg');
    await sql`insert into music_tracks(kind, title, mood, path, duration, license) values ('efecto', ${title}, ${mood}, ${key}, ${await duration(f)}, ${LICENSE})`;
  }
}

export const listTracks = (userId) => sql`select * from music_tracks where owner_id is null or owner_id = ${userId} order by kind, owner_id nulls first, title`;

export async function uploadTrack(userId, { filename, buffer, kind, title, license }) {
  if (!['musica', 'efecto'].includes(kind)) throw Object.assign(new Error('Tipo no válido'), { status: 400 });
  if (!license?.trim()) throw Object.assign(new Error('Indica la licencia o el origen de la pista: sólo se admite audio con derechos adecuados.'), { status: 400 });
  const ext = (/\.(mp3|wav|m4a|ogg|flac|aac)$/i.exec(filename || '') || [])[1];
  if (!ext) throw Object.assign(new Error('Formato no admitido (mp3, wav, m4a, ogg, flac, aac).'), { status: 400 });
  const key = `usuarios/${userId}/audio/${Date.now()}.${ext.toLowerCase()}`;
  const f = scratch(key);
  fs.writeFileSync(f, buffer);
  let d;
  try { d = await duration(f); } catch { fs.rmSync(f, { force: true }); throw Object.assign(new Error('El archivo no es un audio válido.'), { status: 400 }); }
  await put(key, f, `audio/${ext}`);
  const [t] = await sql`insert into music_tracks(owner_id, kind, title, mood, path, duration, license) values (${userId}, ${kind}, ${title || filename}, 'propia', ${key}, ${d}, ${license}) returning *`;
  return t;
}
