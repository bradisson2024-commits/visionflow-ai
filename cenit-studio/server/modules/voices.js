// Voces: catálogo real de cada proveedor, vista previa, velocidad/tono y narración por escena.
//  - Gemini TTS: 30 voces precompuestas multilingües (siguen el idioma del texto).
//  - Microsoft Edge (gratis): catálogo en vivo con idioma, acento (región) y género.
//  - ElevenLabs (opcional): voces de tu cuenta, con sus etiquetas de género y acento.
import fs from 'node:fs';
import crypto from 'node:crypto';
import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts';
import { sql } from '../db/index.js';
import { config } from '../config.js';
import { AppError, ServiceError } from '../core/errors.js';
import { call } from '../core/http.js';
import { enqueue, defineJob } from '../core/jobs.js';
import { emit } from '../core/events.js';
import { charge } from '../core/credits.js';
import { put, localPath, scratch } from '../core/storage.js';
import * as gemini from '../services/gemini.js';
import { ffmpeg, duration } from '../services/ffmpeg.js';
import { own } from './projects.js';

// Descripciones publicadas por Google para cada voz de Gemini TTS.
const GEMINI_VOICES = [['Zephyr', 'Brillante'], ['Puck', 'Animada'], ['Charon', 'Informativa'], ['Kore', 'Firme'], ['Fenrir', 'Entusiasta'], ['Leda', 'Juvenil'], ['Orus', 'Firme'], ['Aoede', 'Ligera'], ['Callirrhoe', 'Relajada'], ['Autonoe', 'Brillante'], ['Enceladus', 'Susurrante'], ['Iapetus', 'Clara'], ['Umbriel', 'Relajada'], ['Algieba', 'Suave'], ['Despina', 'Suave'], ['Erinome', 'Clara'], ['Algenib', 'Grave'], ['Rasalgethi', 'Informativa'], ['Laomedeia', 'Animada'], ['Achernar', 'Suave'], ['Alnilam', 'Firme'], ['Schedar', 'Equilibrada'], ['Gacrux', 'Madura'], ['Pulcherrima', 'Directa'], ['Achird', 'Amigable'], ['Zubenelgenubi', 'Informal'], ['Vindemiatrix', 'Amable'], ['Sadachbia', 'Vivaz'], ['Sadaltager', 'Experta'], ['Sulafat', 'Cálida']];

let edgeCache = null;
async function edgeVoices() {
  if (edgeCache && Date.now() - edgeCache.at < 24 * 3600e3) return edgeCache.list;
  const tts = new MsEdgeTTS();
  const list = (await tts.getVoices()).map((v) => ({ provider: 'edge', id: v.ShortName, name: v.FriendlyName.replace(/^Microsoft /, '').replace(/ Online \(Natural\).*/, ''), gender: v.Gender === 'Male' ? 'masculina' : v.Gender === 'Female' ? 'femenina' : 'otra', locale: v.Locale, language: v.Locale.split('-')[0], accent: v.Locale, description: 'Neural (Microsoft Edge, gratuita)', pitch: true }));
  edgeCache = { at: Date.now(), list };
  return list;
}

async function elevenVoices() {
  if (!config.elevenKey) return [];
  const r = await call('ElevenLabs', 'voces', `${config.elevenBase}/v1/voices`, { headers: { 'xi-api-key': config.elevenKey } }, { attempts: 2, timeout: 20000 });
  return (r.voices || []).map((v) => ({ provider: 'elevenlabs', id: v.voice_id, name: v.name, gender: v.labels?.gender === 'male' ? 'masculina' : v.labels?.gender === 'female' ? 'femenina' : 'otra', locale: v.labels?.language || 'multilingüe', language: v.labels?.language || 'multi', accent: v.labels?.accent || '—', description: v.labels?.description || v.category || '', pitch: false }));
}

export async function catalog() {
  const out = { voices: [], errors: [] };
  if (config.geminiKey) out.voices.push(...GEMINI_VOICES.map(([id, d]) => ({ provider: 'gemini', id, name: id, gender: 'sin clasificar', locale: 'multilingüe', language: 'multi', accent: 'sigue el idioma del texto', description: d, pitch: false })));
  else out.errors.push('Gemini TTS: falta GEMINI_API_KEY.');
  try { out.voices.push(...await edgeVoices()); } catch (e) { out.errors.push(`Microsoft Edge: no se pudo obtener el catálogo (${e.message}).`); }
  try { out.voices.push(...await elevenVoices()); } catch (e) { out.errors.push(e.message); }
  if (!config.elevenKey) out.errors.push('ElevenLabs: sin clave (opcional).');
  return out;
}

const speedPct = (speed) => `${speed >= 1 ? '+' : ''}${Math.round((speed - 1) * 100)}%`;

/** Sintetiza `text` con la voz elegida → WAV 44,1 kHz mono normalizado. */
export async function synth({ provider, voiceId, speed = 1, pitch = 0, text, outFile, previous, next }) {
  const src = `${outFile}.src`;
  if (provider === 'gemini') {
    const pace = speed >= 1.15 ? 'a ritmo rápido' : speed <= 0.9 ? 'a ritmo pausado' : 'a ritmo natural';
    const r = await gemini.speech({ text, voice: voiceId, style: `Narra ${pace}, con entonación profesional y pausas naturales:` });
    fs.writeFileSync(`${src}.pcm`, r.pcm);
    await ffmpeg(['-f', 's16le', '-ar', String(r.rate), '-ac', '1', '-i', `${src}.pcm`, `${src}.wav`]);
    fs.rmSync(`${src}.pcm`, { force: true });
  } else if (provider === 'elevenlabs') {
    if (!config.elevenKey) throw new ServiceError('ElevenLabs', 'falta ELEVENLABS_API_KEY');
    const res = await call('ElevenLabs', 'tts', `${config.elevenBase}/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=mp3_44100_128`, {
      method: 'POST', headers: { 'xi-api-key': config.elevenKey, 'content-type': 'application/json' },
      body: JSON.stringify({ text, model_id: 'eleven_multilingual_v2', previous_text: previous || undefined, next_text: next || undefined, voice_settings: { stability: 0.45, similarity_boost: 0.8, speed: Math.max(0.7, Math.min(1.2, speed)) } }),
    }, { raw: true, timeout: 120000 });
    fs.writeFileSync(`${src}.wav`, Buffer.from(await res.arrayBuffer()));
  } else if (provider === 'edge') {
    const tts = new MsEdgeTTS({ synthesisTimeoutMs: 90000 });
    try {
      await tts.setMetadata(voiceId, OUTPUT_FORMAT.AUDIO_24KHZ_96KBITRATE_MONO_MP3);
      const { audioStream } = tts.toStream(text.replace(/[<>&]/g, ' '), { rate: speedPct(speed), pitch: `${pitch >= 0 ? '+' : ''}${Math.round(pitch)}Hz` });
      const chunks = [];
      await new Promise((ok, ko) => { audioStream.on('data', (d) => chunks.push(d)); audioStream.on('end', ok); audioStream.on('close', ok); audioStream.on('error', ko); });
      if (Buffer.concat(chunks).length < 1500) throw new Error('audio vacío');
      fs.writeFileSync(`${src}.wav`, Buffer.concat(chunks));
    } catch (e) { throw new ServiceError('Microsoft Edge TTS', `${e.message} (servicio gratuito sin garantía)`, { retryable: true }); } finally { tts.close(); }
  } else throw new AppError(400, 'Proveedor de voz desconocido');
  // Gemini no admite velocidad exacta: se ajusta el tempo sin cambiar el tono.
  const tempo = provider === 'gemini' && Math.abs(speed - 1) > 0.02 ? `,atempo=${Math.max(0.5, Math.min(2, speed)).toFixed(2)}` : '';
  await ffmpeg(['-i', `${src}.wav`, '-af', `silenceremove=start_periods=1:start_threshold=-50dB,areverse,silenceremove=start_periods=1:start_threshold=-50dB,areverse${tempo},loudnorm=I=-16:TP=-1.5`, '-ar', '44100', '-ac', '1', outFile]);
  fs.rmSync(`${src}.wav`, { force: true });
  return duration(outFile);
}

const opFor = (provider) => (provider === 'gemini' ? 'voz.gemini' : provider === 'elevenlabs' ? 'voz.elevenlabs' : 'voz.edge');
const words = (t) => String(t).split(/\s+/).filter(Boolean).length;

export async function preview(user, { provider, voiceId, speed, pitch, text }) {
  const sample = String(text || '¿Sabías que este detalle cambia por completo la historia? Quédate hasta el final.').slice(0, 300);
  const key = `usuarios/${user.id}/previas/${crypto.createHash('sha1').update(`${provider}|${voiceId}|${speed}|${pitch}|${sample}`).digest('hex')}.wav`;
  const f = scratch(key);
  if (!fs.existsSync(f)) {
    const ch = await charge(user.id, opFor(provider), words(sample), { preview: voiceId });
    try { await synth({ provider, voiceId, speed: Number(speed) || 1, pitch: Number(pitch) || 0, text: sample, outFile: f }); } catch (e) { await ch.refund(e.message); throw e; }
  }
  return key;
}

export async function requestVoice(user, projectId, sceneIds = null) {
  const p = await own(user, projectId);
  if (p.voice?.engine === 'audio_subido') return enqueue('proyecto.audio_cortar', { projectId: p.id }, { ownerId: user.id, projectId: p.id });
  if (!p.voice?.provider || !p.voice?.voiceId) throw new AppError(400, 'Elige una voz en la pestaña Voz.');
  const scenes = sceneIds ? await sql`select id from scenes where project_id = ${p.id} and id = any(${sceneIds})` : await sql`select id from scenes where project_id = ${p.id} order by idx`;
  if (!scenes.length) throw new AppError(400, 'Primero divide el guion en escenas.');
  for (const s of scenes) await sql`update scenes set audio_status = 'en_cola', audio_error = null where id = ${s.id}`;
  return enqueue('proyecto.voz', { projectId: p.id, sceneIds: scenes.map((s) => s.id) }, { ownerId: user.id, projectId: p.id });
}

defineJob('proyecto.voz', async (job, { progress }) => {
  const [p] = await sql`select * from projects where id = ${job.payload.projectId}`;
  const all = await sql`select * from scenes where project_id = ${p.id} order by idx`;
  const v = p.voice;
  let k = 0, failed = 0;
  for (const id of job.payload.sceneIds) {
    const s = all.find((x) => x.id === id);
    if (!s) continue;
    const i = all.indexOf(s);
    await sql`update scenes set audio_status = 'generando' where id = ${s.id}`;
    emit(p.owner_id, 'scene', { projectId: p.id, sceneId: s.id });
    let ch;
    try {
      ch = await charge(p.owner_id, opFor(v.provider), words(s.narration), { scene: s.idx }, p.id);
      const key = `proyectos/${p.id}/voz/${s.id}-${Date.now()}.wav`;
      const sec = await synth({ provider: v.provider, voiceId: v.voiceId, speed: v.speed || 1, pitch: v.pitch || 0, text: s.narration, outFile: scratch(key), previous: all[i - 1]?.narration, next: all[i + 1]?.narration });
      await put(key, scratch(key), 'audio/wav');
      await sql`update scenes set audio_path = ${key}, audio_sec = ${sec}, audio_status = 'lista', audio_error = null where id = ${s.id}`;
    } catch (e) {
      failed++;
      await ch?.refund(e.message);
      await sql`update scenes set audio_status = 'error', audio_error = ${e.message} where id = ${s.id}`;
    }
    emit(p.owner_id, 'scene', { projectId: p.id, sceneId: s.id });
    await progress(++k / job.payload.sceneIds.length, `Voz ${k}/${job.payload.sceneIds.length}`);
  }
  if (failed) throw new Error(`${failed} fragmento(s) fallaron; puedes regenerarlos individualmente.`);
  return `${k} fragmentos de voz generados.`;
});

/** Modo audio: la narración subida se corta por escenas según sus tiempos reales. */
defineJob('proyecto.audio_cortar', async (job) => {
  const [p] = await sql`select * from projects where id = ${job.payload.projectId}`;
  const scenes = await sql`select * from scenes where project_id = ${p.id} order by idx`;
  const src = await localPath(p.source.audio);
  const times = p.source.sceneTimes;
  if (!times || times.length !== scenes.length) throw new Error('Vuelve a dividir el guion en escenas: los tiempos del audio no coinciden con las escenas.');
  for (const [i, s] of scenes.entries()) {
    const { start, end } = times[i];
    const key = `proyectos/${p.id}/voz/${s.id}-subido.wav`;
    await ffmpeg(['-ss', start.toFixed(3), '-to', end.toFixed(3), '-i', src, '-ar', '44100', '-ac', '1', scratch(key)]);
    await put(key, scratch(key), 'audio/wav');
    await sql`update scenes set audio_path = ${key}, audio_sec = ${await duration(scratch(key))}, audio_status = 'lista' where id = ${s.id}`;
  }
  emit(p.owner_id, 'project', { projectId: p.id });
  return `Narración subida repartida en ${scenes.length} escenas.`;
});
