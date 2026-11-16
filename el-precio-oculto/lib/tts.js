// Módulo 13 · Paso 6: voz real en español latino, generada escena por escena y guardada en el proyecto.
import fs from 'node:fs';
import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts';
import { config, ttsProviderName } from './config.js';
import { fetchRetry, fetchJson, ServiceError } from './http.js';
import { ffmpeg, durationOf } from './media.js';

/** Texto listo para locución: sin referencias [F1], sin símbolos que la voz lea mal. */
export function speakable(text) {
  return String(text)
    .replace(/\s*\[F\d+(?:\s*,\s*F\d+)*\]/g, '')
    .replace(/(\d)\s?%/g, '$1 por ciento')
    .replace(/US\$\s?/g, 'dólares ')
    .replace(/&/g, ' y ')
    .replace(/[*_#<>{}\[\]]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const escXml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

async function edgeTts(text, outMp3) {
  const tts = new MsEdgeTTS({ synthesisTimeoutMs: 90000 });
  try {
    await tts.setMetadata(config.edgeVoice, OUTPUT_FORMAT.AUDIO_24KHZ_96KBITRATE_MONO_MP3);
    const { audioStream } = tts.toStream(escXml(text), { rate: config.edgeRate });
    const chunks = [];
    await new Promise((resolve, reject) => {
      audioStream.on('data', (d) => chunks.push(d));
      audioStream.on('end', resolve);
      audioStream.on('close', resolve);
      audioStream.on('error', reject);
    });
    const buf = Buffer.concat(chunks);
    if (buf.length < 2000) throw new ServiceError('Edge TTS', 'audio vacío o incompleto');
    fs.writeFileSync(outMp3, buf);
  } catch (e) {
    throw e instanceof ServiceError ? e : new ServiceError('Edge TTS', `${e.message}. (Servicio gratuito de Microsoft; si falla de forma persistente usa ElevenLabs o Gemini TTS.)`, { retriable: true });
  } finally { tts.close(); }
}

async function elevenTts(text, outMp3, ctx) {
  if (!config.elevenKey || !config.elevenVoice) throw new ServiceError('ElevenLabs', 'faltan ELEVENLABS_API_KEY y/o ELEVENLABS_VOICE_ID');
  const res = await fetchRetry('ElevenLabs', `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(config.elevenVoice)}?output_format=mp3_44100_128`, {
    method: 'POST',
    headers: { 'xi-api-key': config.elevenKey, 'content-type': 'application/json', accept: 'audio/mpeg' },
    body: JSON.stringify({
      text, model_id: config.elevenModel,
      previous_text: ctx.prev || undefined, next_text: ctx.next || undefined,
      voice_settings: { stability: 0.45, similarity_boost: 0.8, style: 0.25, use_speaker_boost: true },
    }),
  }, { retries: 3, timeoutMs: 120000 });
  fs.writeFileSync(outMp3, Buffer.from(await res.arrayBuffer()));
}

async function geminiTts(text, outWav) {
  if (!config.geminiKey) throw new ServiceError('Gemini TTS', 'falta GEMINI_API_KEY');
  const res = await fetchJson('Gemini TTS', `https://generativelanguage.googleapis.com/v1beta/models/${config.geminiTtsModel}:generateContent?key=${encodeURIComponent(config.geminiKey)}`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: `Narra en español latino neutro, con voz de documental intrigante, ritmo ágil y pausas naturales: ${text}` }] }],
      generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: config.geminiVoice } } } },
    }),
  }, { retries: 3, timeoutMs: 180000, backoffMs: 15000 });
  const part = res.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data);
  if (!part) throw new ServiceError('Gemini TTS', 'no devolvió audio');
  const pcm = `${outWav}.pcm`;
  fs.writeFileSync(pcm, Buffer.from(part.inlineData.data, 'base64'));
  const rate = Number((part.inlineData.mimeType || '').match(/rate=(\d+)/)?.[1] || 24000);
  try { await ffmpeg(['-f', 's16le', '-ar', String(rate), '-ac', '1', '-i', pcm, outWav]); } finally { fs.rmSync(pcm, { force: true }); }
}

/**
 * Genera la narración de una escena → WAV 44.1 kHz mono normalizado, recortando silencios de los extremos.
 * @returns {{provider:string, voice:string, durationSec:number, wordsPerSec:number}}
 */
export async function synthesizeScene({ text, outWav, prev, next }) {
  const provider = ttsProviderName();
  const clean = speakable(text);
  if (!clean) throw new Error('La escena no tiene texto para narrar.');
  const tmp = `${outWav}.src.${provider === 'gemini' ? 'wav' : 'mp3'}`;
  if (provider === 'edge') await edgeTts(clean, tmp);
  else if (provider === 'elevenlabs') await elevenTts(clean, tmp, { prev: prev && speakable(prev), next: next && speakable(next) });
  else if (provider === 'gemini') await geminiTts(clean, tmp);
  else throw new ServiceError('Voz', `proveedor desconocido: ${provider}`);
  try {
    await ffmpeg(['-i', tmp, '-af',
      'silenceremove=start_periods=1:start_threshold=-50dB:start_silence=0.05,areverse,silenceremove=start_periods=1:start_threshold=-50dB:start_silence=0.08,areverse,highpass=f=70,acompressor=threshold=-18dB:ratio=2.5:attack=5:release=120,alimiter=limit=0.95',
      '-ar', '44100', '-ac', '1', '-c:a', 'pcm_s16le', outWav]);
  } finally { fs.rmSync(tmp, { force: true }); }
  const durationSec = await durationOf(outWav);
  const words = clean.split(/\s+/).length;
  const wordsPerSec = +(words / Math.max(0.1, durationSec)).toFixed(2);
  const voice = provider === 'edge' ? config.edgeVoice : provider === 'elevenlabs' ? config.elevenVoice : config.geminiVoice;
  return { provider, voice, durationSec: +durationSec.toFixed(3), words, wordsPerSec };
}

/** Un audio con muy pocas palabras por segundo (o demasiadas) suele indicar corte o error de síntesis. */
export function audioLooksComplete({ wordsPerSec, durationSec }) {
  if (!durationSec || durationSec < 0.6) return { ok: false, reason: 'audio demasiado corto' };
  if (wordsPerSec > 4.6) return { ok: false, reason: `ritmo imposible (${wordsPerSec} palabras/s): el audio parece cortado` };
  if (wordsPerSec < 1.1) return { ok: false, reason: `ritmo demasiado lento (${wordsPerSec} palabras/s): posible silencio o error` };
  return { ok: true };
}
