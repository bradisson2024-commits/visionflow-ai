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

let comfyN = 0;
const comfyJobs = {};
// Valida que el flujo enviado sea un grafo de ComfyUI correcto (formato API): nodos con class_type,
// entradas obligatorias presentes y enlaces [id, salida] que apuntan a nodos existentes.
const REQUIRED = {
  CheckpointLoaderSimple: ['ckpt_name'], EmptyLatentImage: ['width', 'height', 'batch_size'], CLIPTextEncode: ['text', 'clip'],
  KSampler: ['seed', 'steps', 'cfg', 'sampler_name', 'scheduler', 'denoise', 'model', 'positive', 'negative', 'latent_image'],
  VAEDecode: ['samples', 'vae'], SaveImage: ['filename_prefix', 'images'],
};
function validateComfyWorkflow(wf) {
  const errs = [];
  if (!wf || typeof wf !== 'object') return ['workflow vacío'];
  for (const [id, n] of Object.entries(wf)) {
    if (!n.class_type) { errs.push(`nodo ${id} sin class_type`); continue; }
    for (const k of REQUIRED[n.class_type] || []) if (!(k in n.inputs)) errs.push(`${n.class_type}.${k} falta`);
    for (const v of Object.values(n.inputs)) if (Array.isArray(v) && !(String(v[0]) in wf)) errs.push(`enlace a nodo inexistente ${v[0]}`);
    if (n.class_type === 'EmptyLatentImage' && (n.inputs.width % 8 || n.inputs.height % 8)) errs.push('dimensiones no múltiplo de 8');
    if (n.class_type === 'CheckpointLoaderSimple' && !['dreamshaperXL_lightning.safetensors', 'dreamshaper_8.safetensors'].includes(n.inputs.ckpt_name)) errs.push('checkpoint inexistente ' + n.inputs.ckpt_name);
  }
  if (!Object.values(wf).some(n => n.class_type === 'SaveImage')) errs.push('sin SaveImage');
  return errs;
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
    // ---- Ollama (API local) ----
    if (url.pathname === '/api/tags') return send(200, { models: [{ name: 'qwen2.5:7b' }, { name: 'llama3.2:3b' }] });
    if (url.pathname === '/api/chat') {
      const b = JSON.parse(body);
      rec.kind = 'llm'; rec.provider = 'ollama'; rec.model = b.model; rec.schema = typeof b.format === 'object';
      const user = b.messages.find(m => m.role === 'user').content;
      const content = rec.schema ? JSON.stringify(b.format.properties?.titles ? { titles: ['Título de prueba 1', 'Título de prueba 2', 'Título de prueba 3'] } : fakeStoryboard(user)) : 'Guion de prueba generado localmente. Esta es la segunda frase. Y esta es la tercera.';
      rec.text = content;
      return send(200, { model: b.model, message: { role: 'assistant', content }, done: true });
    }
    // ---- ComfyUI (API HTTP) ----
    if (url.pathname === '/system_stats') return send(200, { system: { comfyui_version: 'mock' }, devices: [{ name: 'cpu', type: 'cpu', vram_total: 0 }] });
    if (url.pathname === '/object_info/CheckpointLoaderSimple') return send(200, { CheckpointLoaderSimple: { input: { required: { ckpt_name: [['dreamshaperXL_lightning.safetensors', 'dreamshaper_8.safetensors']] } } } });
    if (url.pathname === '/prompt' && req.method === 'POST') {
      const b = JSON.parse(body);
      const errs = validateComfyWorkflow(b.prompt);
      rec.kind = 'image'; rec.provider = 'comfyui'; rec.errors = errs;
      if (errs.length) return send(400, { error: { type: 'prompt_outputs_failed_validation', message: errs.join('; ') }, node_errors: {} });
      const pos = Object.values(b.prompt).find(n => n.class_type === 'CLIPTextEncode' && !/watermark/.test(n.inputs.text));
      const neg = Object.values(b.prompt).find(n => n.class_type === 'CLIPTextEncode' && /watermark/.test(n.inputs.text));
      const lat = Object.values(b.prompt).find(n => n.class_type === 'EmptyLatentImage');
      const ks = Object.values(b.prompt).find(n => n.class_type === 'KSampler');
      rec.prompt = pos?.inputs.text; rec.negative = neg?.inputs.text; rec.seed = ks?.inputs.seed; rec.size = lat && `${lat.inputs.width}x${lat.inputs.height}`;
      const id = 'p' + (++comfyN);
      comfyJobs[id] = { at: Date.now(), prompt: rec.prompt || 'imagen', size: rec.size };
      return send(200, { prompt_id: id, number: comfyN, node_errors: {} });
    }
    if (url.pathname === '/queue') return send(200, { queue_running: [], queue_pending: [] });
    if (url.pathname.startsWith('/history/')) {
      const id = url.pathname.split('/').pop();
      const j = comfyJobs[id];
      if (!j || Date.now() - j.at < 600) return send(200, {}); // aún generando
      if (!j.file) {
        const [w, h] = (j.size || '1344x768').split('x');
        j.file = `vimo_${id}.png`;
        fs.writeFileSync(path.join(tmp, j.file), makeImage('SCENE: ' + j.prompt.split(', ').slice(1, 3).join(', '), 0, `${w}x${h}`));
      }
      return send(200, { [id]: { status: { status_str: 'success', completed: true, messages: [] }, outputs: { 9: { images: [{ filename: j.file, subfolder: '', type: 'output' }] } } } });
    }
    if (url.pathname === '/view') return send(200, fs.readFileSync(path.join(tmp, url.searchParams.get('filename'))), 'image/png');
    // ---- Groq (compatible con OpenAI) ----
    if (url.pathname === '/openai/v1/models') return send(200, { data: [{ id: 'llama-3.3-70b-versatile' }, { id: 'openai/gpt-oss-120b' }, { id: 'whisper-large-v3' }] });
    if (url.pathname === '/openai/v1/chat/completions') {
      const b = JSON.parse(body);
      rec.kind = 'llm'; rec.provider = 'groq';
      const user = b.messages.find(m => m.role === 'user').content;
      const content = b.response_format ? JSON.stringify(fakeStoryboard(user)) : 'Guion de prueba.';
      return send(200, { choices: [{ message: { role: 'assistant', content } }] });
    }
    // ---- Catálogo de voces de Piper (sirve archivos reales de voz descargados por la prueba) ----
    if (url.pathname === '/piper-voices/voices.json') return send(200, { 'es_ES-mls_10246-low': { key: 'es_ES-mls_10246-low', name: 'mls_10246', quality: 'low', language: { code: 'es_ES', name_native: 'Español', country_english: 'Spain' }, files: { 'es/es_ES/mls_10246/low/es_ES-mls_10246-low.onnx': { size_bytes: 63104526 }, 'es/es_ES/mls_10246/low/es_ES-mls_10246-low.onnx.json': { size_bytes: 5773 } } } });
    if (url.pathname.startsWith('/piper-voices/es/')) {
      const f = path.join(process.env.PIPER_VOICE_SRC || '', url.pathname.endsWith('.json') ? 'es-mls_10246-low.onnx.json' : 'es-mls_10246-low.onnx');
      return send(200, fs.readFileSync(f), 'application/octet-stream');
    }
    send(404, { error: { message: 'mock: ruta no implementada ' + url.pathname } });
  } catch (e) {
    send(500, { error: { message: String(e) } });
  }
});

server.listen(PORT, '127.0.0.1', () => console.log('mock providers on', PORT));
