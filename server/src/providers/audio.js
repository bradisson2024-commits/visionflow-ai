// Voz (TTS) y música con IA.
// Voz: ElevenLabs (voces de la cuenta del usuario, con muestras) u OpenAI TTS.
// Música: ElevenLabs Music.
import fs from 'node:fs';
import path from 'node:path';
import { getSettings, requireKey, BASE_URLS } from '../settings.js';
import { json, buffer } from './http.js';

export const OPENAI_VOICES = [
  { id: 'alloy', name: 'Alloy', gender: 'neutral' }, { id: 'ash', name: 'Ash', gender: 'masculina' },
  { id: 'ballad', name: 'Ballad', gender: 'masculina' }, { id: 'coral', name: 'Coral', gender: 'femenina' },
  { id: 'echo', name: 'Echo', gender: 'masculina' }, { id: 'fable', name: 'Fable', gender: 'neutral' },
  { id: 'nova', name: 'Nova', gender: 'femenina' }, { id: 'onyx', name: 'Onyx', gender: 'masculina' },
  { id: 'sage', name: 'Sage', gender: 'femenina' }, { id: 'shimmer', name: 'Shimmer', gender: 'femenina' },
  { id: 'verse', name: 'Verse', gender: 'masculina' },
];

const GENDER_ES = { male: 'masculina', female: 'femenina', neutral: 'neutral' };

export async function listVoices(provider) {
  if (provider === 'openai') {
    return OPENAI_VOICES.map(v => ({ ...v, provider: 'openai', language: 'multilingüe', description: 'Voz de OpenAI TTS', preview_url: null }));
  }
  const r = await json('ElevenLabs', `${BASE_URLS.elevenlabs}/v1/voices`, { headers: { 'xi-api-key': requireKey('elevenlabs') } });
  return (r.voices || []).map(v => ({
    id: v.voice_id,
    name: v.name,
    provider: 'elevenlabs',
    gender: GENDER_ES[v.labels?.gender] || v.labels?.gender || '—',
    language: v.labels?.language || v.verified_languages?.map(l => l.language).join(', ') || 'multilingüe',
    accent: v.labels?.accent || null,
    description: v.labels?.description || v.description || v.labels?.use_case || v.category || '',
    preview_url: v.preview_url || null,
  }));
}

/**
 * Genera audio de narración. voice = { provider, voice_id, speed, stability, style, tone, language }
 * context = { previous_text, next_text } mejora la continuidad entre escenas en ElevenLabs.
 */
export async function synthesize({ text, voice, outPath, context = {}, signal }) {
  const s = getSettings();
  const provider = voice.provider || s.tts_provider;
  let buf;
  if (provider === 'openai') {
    const body = { model: s.openai_tts_model, voice: voice.voice_id || 'alloy', input: text, response_format: 'mp3', speed: clamp(Number(voice.speed) || 1, 0.25, 4) };
    if (voice.tone && /gpt-4o/.test(s.openai_tts_model)) body.instructions = voice.tone;
    buf = await buffer('OpenAI', `${BASE_URLS.openai}/v1/audio/speech`, {
      method: 'POST', headers: { Authorization: `Bearer ${requireKey('openai')}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    }, { signal });
  } else {
    if (!voice.voice_id) throw new Error('Selecciona una voz de ElevenLabs en «Voces».');
    const body = {
      text,
      model_id: s.elevenlabs_tts_model,
      voice_settings: {
        stability: clamp(Number(voice.stability ?? 0.5), 0, 1),
        similarity_boost: 0.75,
        style: clamp(Number(voice.style ?? 0), 0, 1),
        speed: clamp(Number(voice.speed) || 1, 0.7, 1.2),
      },
    };
    if (context.previous_text) body.previous_text = context.previous_text.slice(-1000);
    if (context.next_text) body.next_text = context.next_text.slice(0, 1000);
    if (voice.language && /turbo_v2_5|flash_v2_5|eleven_v3/.test(s.elevenlabs_tts_model)) body.language_code = voice.language;
    buf = await buffer('ElevenLabs', `${BASE_URLS.elevenlabs}/v1/text-to-speech/${encodeURIComponent(voice.voice_id)}?output_format=mp3_44100_128`, {
      method: 'POST', headers: { 'xi-api-key': requireKey('elevenlabs'), 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    }, { signal });
  }
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, buf);
  return outPath;
}

export const MUSIC_MOODS = [
  { id: 'suspenso', name: 'Suspenso', prompt: 'suspenseful cinematic underscore, slow pulsing low strings, ticking tension, subtle percussion, instrumental, background music for narration' },
  { id: 'tristeza', name: 'Tristeza', prompt: 'sad emotional piano with soft strings, slow tempo, melancholic, instrumental, background music for narration' },
  { id: 'misterio', name: 'Misterio', prompt: 'mysterious dark ambient, airy pads, music box hints, curious and enigmatic, instrumental, background music for narration' },
  { id: 'motivacion', name: 'Motivación', prompt: 'uplifting motivational cinematic music, building piano and strings, hopeful, steady drums, instrumental, background music for narration' },
  { id: 'historia', name: 'Historia', prompt: 'storytelling warm acoustic music, gentle guitar and soft piano, narrative feel, instrumental, background music for narration' },
  { id: 'documental', name: 'Documental', prompt: 'documentary background score, neutral and serious, minimal piano and soft synth textures, instrumental, background music for narration' },
  { id: 'ambiente', name: 'Ambiente', prompt: 'calm ambient soundscape, evolving soft pads, very minimal, relaxing, instrumental, background music for narration' },
  { id: 'cinematografico', name: 'Cinematográfico', prompt: 'epic cinematic orchestral score, big emotional strings and brass, film trailer feel but restrained under voice, instrumental' },
];

export async function composeMusic({ prompt, seconds, outPath, signal }) {
  const ms = Math.round(clamp(seconds, 10, 600) * 1000);
  const buf = await buffer('ElevenLabs', `${BASE_URLS.elevenlabs}/v1/music?output_format=mp3_44100_128`, {
    method: 'POST',
    headers: { 'xi-api-key': requireKey('elevenlabs'), 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt, music_length_ms: ms, model_id: 'music_v1', force_instrumental: true }),
  }, { signal, timeoutMs: 600_000 });
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, buf);
  return outPath;
}

function clamp(v, a, b) { return Math.min(b, Math.max(a, v)); }
