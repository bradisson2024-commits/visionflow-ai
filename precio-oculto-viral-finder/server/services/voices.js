// Motores de voz reales: Gemini TTS, ElevenLabs y Microsoft Edge (neural, gratis, sin clave).
import fs from 'node:fs';
import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts';
import { getSetting } from '../core/settings.js';
import { request, ExternalError } from '../core/http-client.js';
import { speech } from './gemini.js';
import { ffmpeg } from './ffmpeg.js';

export function voiceEngine() {
  const v = getSetting('VOICE_ENGINE');
  if (v !== 'auto') return v;
  if (getSetting('ELEVENLABS_API_KEY') && getSetting('ELEVENLABS_VOICE_ID')) return 'elevenlabs';
  if (getSetting('GEMINI_API_KEY')) return 'gemini';
  return 'edge';
}

const DIRECTION = 'Lee este texto en español latinoamericano neutro, como narrador de un documental de misterio: voz cercana y segura, ritmo ágil, pausas naturales en comas y puntos, énfasis en las revelaciones. Lee sólo el texto, sin añadir nada:';

/** Sintetiza `text` y deja un archivo de audio en `outBase` + extensión. Devuelve la ruta. */
export async function synthesize(text, outBase, context = {}) {
  const engine = voiceEngine();
  if (engine === 'gemini') {
    const { pcm, rate } = await speech({ text, voice: getSetting('GEMINI_TTS_VOICE'), direction: DIRECTION });
    const raw = `${outBase}.pcm`;
    fs.writeFileSync(raw, pcm);
    try { await ffmpeg(['-f', 's16le', '-ar', String(rate), '-ac', '1', '-i', raw, `${outBase}.src.wav`]); } finally { fs.rmSync(raw, { force: true }); }
    return { file: `${outBase}.src.wav`, engine, voice: getSetting('GEMINI_TTS_VOICE') };
  }
  if (engine === 'elevenlabs') {
    const k = getSetting('ELEVENLABS_API_KEY'), v = getSetting('ELEVENLABS_VOICE_ID');
    if (!k || !v) throw new ExternalError('ElevenLabs', 'faltan ELEVENLABS_API_KEY y ELEVENLABS_VOICE_ID');
    const b = process.env.EPO_ELEVEN_BASE || 'https://api.elevenlabs.io';
    const res = await request('ElevenLabs', 'tts', `${b}/v1/text-to-speech/${encodeURIComponent(v)}?output_format=mp3_44100_128`, {
      method: 'POST', headers: { 'xi-api-key': k, 'content-type': 'application/json', accept: 'audio/mpeg' },
      body: JSON.stringify({ text, model_id: 'eleven_multilingual_v2', previous_text: context.previous || undefined, next_text: context.next || undefined, voice_settings: { stability: 0.4, similarity_boost: 0.8, style: 0.3 } }),
    }, { attempts: 3, timeout: 120000 });
    fs.writeFileSync(`${outBase}.src.mp3`, Buffer.from(await res.arrayBuffer()));
    return { file: `${outBase}.src.mp3`, engine, voice: v };
  }
  if (engine === 'edge') {
    const voice = getSetting('EDGE_VOICE');
    const tts = new MsEdgeTTS({ synthesisTimeoutMs: 90000 });
    try {
      await tts.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_96KBITRATE_MONO_MP3);
      const safe = text.replace(/&/g, ' y ').replace(/</g, '').replace(/>/g, '');
      const { audioStream } = tts.toStream(safe, { rate: '+3%' });
      const chunks = [];
      await new Promise((resolve, reject) => { audioStream.on('data', (d) => chunks.push(d)); audioStream.on('end', resolve); audioStream.on('close', resolve); audioStream.on('error', reject); });
      const buf = Buffer.concat(chunks);
      if (buf.length < 1500) throw new Error('audio vacío');
      fs.writeFileSync(`${outBase}.src.mp3`, buf);
    } catch (e) {
      throw new ExternalError('Edge TTS', `${e.message}. Es un servicio gratuito de Microsoft sin garantía; si falla, usa Gemini o ElevenLabs.`, { retry: true });
    } finally { tts.close(); }
    return { file: `${outBase}.src.mp3`, engine, voice };
  }
  throw new Error(`Motor de voz desconocido: ${engine}`);
}
