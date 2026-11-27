// SERVIDOR DE PRUEBAS — NO SE USA EN PRODUCCIÓN.
// Imita las APIs de Anthropic, OpenAI y ElevenLabs para poder probar el flujo completo
// de Vimo (análisis → escenas → imágenes → voz → música → render MP4) sin claves reales.
// Las "imágenes" son tarjetas generadas con FFmpeg que muestran el texto de la escena
// recibida, y el "audio" es un tono con la duración aproximada del texto: sirven para
// verificar que cada escena recibe su prompt, que se envían las referencias de personaje
// y que el montaje sincroniza la narración, NO para juzgar la calidad de la IA.
import http from 'node:http';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const PORT = Number(process.env.MOCK_PORT) || 5291;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vimo-mock-'));
export const calls = [];
const FONT = ['/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', '/usr/share/fonts/truetype/freefont/FreeSans.ttf'].find(f => fs.existsSync(f));

function readBody(req) {
  return new Promise(res => { const c = []; req.on('data', d => c.push(d)); req.on('end', () => res(Buffer.concat(c))); });
}

function esc(s) { return s.replace(/\\/g, '\\\\').replace(/'/g, '’').replace(/:/g, '\\:').replace(/%/g, '\\%').replace(/,/g, '\\,'); }

let imgN = 0;
function makeImage(prompt, refs, size) {
  const [w, h] = (size || '1536x1024').split('x').map(Number);
  const scene = (prompt.match(/SCENE: (.*)/) || prompt.match(/CHARACTER REFERENCE SHEET of a single character, ([^:]*)/) || [, 'imagen'])[1].slice(0, 160);
  const lines = scene.match(/.{1,48}(\s|$)/g) || [scene];
  const hue = (imgN++ * 47) % 360;
  const out = path.join(tmp, `img_${imgN}.png`);
  const draws = lines.slice(0, 5).map((l, i) => `drawtext=fontfile=${FONT}:text='${esc(l.trim())}':x=60:y=${120 + i * 70}:fontsize=46:fontcolor=white`).join(',');
  execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'lavfi', '-i', `color=c=0x${hsl(hue)}:s=${w}x${h}`, '-vf',
    `${draws},drawtext=fontfile=${FONT}:text='MOCK #${imgN} refs=${refs}':x=60:y=h-110:fontsize=40:fontcolor=yellow`, '-frames:v', '1', out]);
  return fs.readFileSync(out);
}
function hsl(h) {
  const f = n => { const k = (n + h / 30) % 12; const a = 0.45 * Math.min(0.4, 1 - 0.4); return Math.round(255 * (0.4 - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)))).toString(16).padStart(2, '0'); };
  return f(0) + f(8) + f(4);
}
function makeTone(seconds, freq = 220) {
  const out = path.join(tmp, `a_${Date.now()}_${Math.random()}.mp3`);
  execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'lavfi', '-i', `sine=f=${freq}:d=${seconds.toFixed(2)}`, '-af', 'volume=0.4', '-c:a', 'libmp3lame', '-b:a', '96k', out]);
  return fs.readFileSync(out);
}

/** "LLM" determinista: agrupa las frases numeradas de dos en dos y construye prompts a partir del texto. */
function fakeStoryboard(userText) {
  const sentences = [...userText.matchAll(/^\[(\d+)\] (.*)$/gm)].map(m => ({ n: Number(m[1]), text: m[2] }));
  const known = [...userText.matchAll(/- key "([^"]+)": ([^—]+) —/g)].map(m => m[1]);
  const characters = [];
  if (!known.includes('tomas') && /Tomás/.test(userText)) characters.push({ key: 'tomas', name: 'Tomás', description: 'stickman man, messy black hair, mustard yellow scarf, grey coat', role: 'principal' });
  if (/anciano/.test(userText)) characters.push({ key: 'anciano', name: 'El anciano', description: 'old stickman with white beard, brown hat, holds a red umbrella', role: 'secundario' });
  const scenes = [];
  for (let i = 0; i < sentences.length; i += 2) {
    const group = sentences.slice(i, i + 2);
    const text = group.map(g => g.text).join(' ');
    const chars = [];
    if (/Tomás|Caminó|sonrió/.test(text)) chars.push(known[0] || 'tomas');
    if (/anciano|paraguas/.test(text)) chars.push('anciano');
    scenes.push({
      start: group[0].n, end: group[group.length - 1].n,
      visual_description: text, characters: chars, action: 'acción de la escena', location: /estación|andén/.test(text) ? 'estación' : /calle/.test(text) ? 'calle' : 'ciudad',
      emotion: /triste|mal|perdido/.test(text) ? 'tristeza' : 'calma', shot: ['plano general', 'plano medio', 'primer plano'][scenes.length % 3],
      camera: ['zoom_in', 'pan_right', 'zoom_out', 'pan_left'][scenes.length % 4], lighting: 'noche, luces de la ciudad',
      image_prompt: text,
    });
  }
  return { summary: 'Resumen de prueba generado por el servidor simulado.', characters, scenes };
}

const server = http.createServer(async (req, res) => {
  const body = await readBody(req);
  const url = new URL(req.url, 'http://x');
  const send = (code, obj, type = 'application/json') => { res.writeHead(code, { 'Content-Type': type }); res.end(type === 'application/json' ? JSON.stringify(obj) : obj); };
  const rec = { method: req.method, path: url.pathname, at: Date.now() };
  calls.push(rec);
  try {
    if (url.pathname === '/__calls') return send(200, calls);

    // ---- Anthropic Messages (streaming SSE) ----
    if (url.pathname === '/v1/messages' && req.method === 'POST') {
      const b = JSON.parse(body);
      const user = b.messages[0].content;
      rec.kind = 'llm';
      rec.schema = !!b.output_config?.format;
      const text = b.output_config?.format ? JSON.stringify(fakeStoryboard(user)) : 'Guion de prueba. Esta es la segunda frase. Y esta es la tercera.';
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      const ev = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify({ type: event, ...data })}\n\n`);
      ev('message_start', { message: { id: 'msg_mock', type: 'message', role: 'assistant', model: b.model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 1 } } });
      ev('content_block_start', { index: 0, content_block: { type: 'text', text: '' } });
      for (let i = 0; i < text.length; i += 500) ev('content_block_delta', { index: 0, delta: { type: 'text_delta', text: text.slice(i, i + 500) } });
      ev('content_block_stop', { index: 0 });
      ev('message_delta', { delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 100 } });
      ev('message_stop', {});
      return res.end();
    }
    if (url.pathname === '/v1/models') return send(200, { data: [{ id: 'mock' }] });

    // ---- OpenAI imágenes ----
    if (url.pathname === '/v1/images/generations') {
      const b = JSON.parse(body);
      rec.kind = 'image'; rec.refs = 0; rec.prompt = b.prompt;
      return send(200, { data: [{ b64_json: makeImage(b.prompt, 0, b.size).toString('base64') }] });
    }
    if (url.pathname === '/v1/images/edits') {
      const raw = body.toString('latin1');
      const prompt = (raw.match(/name="prompt"\r\n\r\n([\s\S]*?)\r\n--/) || [, ''])[1];
      const refs = (raw.match(/name="image\[\]"/g) || []).length;
      rec.kind = 'image'; rec.refs = refs; rec.prompt = Buffer.from(prompt, 'latin1').toString('utf8');
      return send(200, { data: [{ b64_json: makeImage(rec.prompt, refs, '1536x1024').toString('base64') }] });
    }
    // ---- OpenAI TTS ----
    if (url.pathname === '/v1/audio/speech') {
      const b = JSON.parse(body);
      rec.kind = 'tts'; rec.text = b.input; rec.voice = b.voice;
      const words = b.input.split(/\s+/).length;
      return send(200, makeTone(Math.max(1, words * 0.38 / (b.speed || 1)), 180 + (b.input.length % 200)), 'audio/mpeg');
    }
    // ---- ElevenLabs ----
    if (url.pathname === '/v1/voices') return send(200, { voices: [{ voice_id: 'mockvoice1', name: 'Voz de prueba', labels: { gender: 'female', language: 'es' }, preview_url: null }] });
    if (url.pathname === '/v1/music') {
      const b = JSON.parse(body);
      rec.kind = 'music'; rec.ms = b.music_length_ms;
      return send(200, makeTone(Math.min(30, b.music_length_ms / 1000), 440), 'audio/mpeg');
    }
    if (url.pathname.startsWith('/v1/text-to-speech/')) {
      const b = JSON.parse(body);
      rec.kind = 'tts'; rec.text = b.text;
      return send(200, makeTone(Math.max(1, b.text.split(/\s+/).length * 0.38), 200), 'audio/mpeg');
    }
    send(404, { error: { message: 'mock: ruta no implementada ' + url.pathname } });
  } catch (e) {
    send(500, { error: { message: String(e) } });
  }
});

server.listen(PORT, '127.0.0.1', () => console.log('mock providers on', PORT));
