import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import multer from 'multer';
import { all, get, run, now, uid, mediaUrl, mediaSubdir, MEDIA_DIR } from '../db.js';
import { listStyles, updateStyle, getStyle, styleBlock } from '../styles.js';
import { generateCharacterRef } from '../pipeline/produce.js';
import { generateImage } from '../providers/image.js';
import { listVoices, synthesize, composeMusic, MUSIC_MOODS } from '../providers/audio.js';
import { probeDuration } from '../media.js';
import { getSettings, setSettings, keysStatus, setKey, getKey, API_KEYS, BASE_URLS, DEFAULTS } from '../settings.js';
import { request } from '../providers/http.js';

const upload = multer({ dest: path.join(MEDIA_DIR, 'uploads'), limits: { fileSize: 200 * 1024 * 1024 } });
const extOf = (f, def) => (path.extname(f.originalname || '').toLowerCase() || def);

// ---------------- Estilos ----------------
export const styles = Router();
styles.get('/', (req, res) => res.json(listStyles()));
styles.put('/:id', (req, res) => {
  const b = req.body || {};
  const patch = {};
  for (const k of ['name', 'description', 'prompt', 'palette', 'lighting', 'character_design', 'environment']) if (k in b) patch[k] = b[k]?.trim() || null;
  res.json(updateStyle(req.params.id, patch));
});
/** Genera con IA la imagen de vista previa de un estilo (se guarda y se reutiliza). */
styles.post('/:id/preview', async (req, res) => {
  const style = getStyle(req.params.id);
  const out = path.join(mediaSubdir('styles'), `${style.id}.png`);
  const subject = req.body?.subject || 'a person walking down a city street at sunset, looking up at the sky with curiosity';
  await generateImage({ prompt: `${styleBlock(style)}\nSCENE: ${subject}.\nAspect ratio 16:9, cinematic composition. No text, no letters, no watermarks.`, aspect: '16:9', outPath: out });
  res.json(updateStyle(style.id, { preview_path: out }));
});
styles.post('/:id/preview/upload', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Falta el archivo' });
  const out = path.join(mediaSubdir('styles'), `${req.params.id}${extOf(req.file, '.png')}`);
  fs.renameSync(req.file.path, out);
  res.json(updateStyle(req.params.id, { preview_path: out }));
});

// ---------------- Personajes ----------------
export const characters = Router();
function characterOut(c) {
  const refs = all('SELECT * FROM character_refs WHERE character_id = ?', c.id)
    .filter(r => fs.existsSync(r.image_path)).map(r => ({ style_id: r.style_id, url: mediaUrl(r.image_path) }));
  const projects = all('SELECT p.id, p.title FROM project_characters pc JOIN projects p ON p.id = pc.project_id WHERE pc.character_id = ?', c.id);
  return { ...c, refs, projects };
}
characters.get('/', (req, res) => res.json(all('SELECT * FROM characters ORDER BY updated_at DESC').map(characterOut)));
characters.post('/', (req, res) => {
  const b = req.body || {};
  if (!b.name?.trim() || !b.description?.trim()) return res.status(400).json({ error: 'El personaje necesita nombre y descripción.' });
  const id = uid('chr_');
  run('INSERT INTO characters(id, name, description, role, created_at, updated_at) VALUES(?,?,?,?,?,?)', id, b.name.trim(), b.description.trim(), b.role === 'secundario' ? 'secundario' : 'principal', now(), now());
  res.status(201).json(characterOut(get('SELECT * FROM characters WHERE id = ?', id)));
});
characters.put('/:id', (req, res) => {
  const c = get('SELECT * FROM characters WHERE id = ?', req.params.id);
  if (!c) return res.status(404).json({ error: 'Personaje no encontrado' });
  const b = req.body || {};
  const description = b.description?.trim() || c.description;
  run('UPDATE characters SET name=?, description=?, role=?, updated_at=? WHERE id=?', b.name?.trim() || c.name, description, b.role || c.role, now(), c.id);
  // Si cambia la apariencia, las referencias anteriores ya no son válidas.
  if (description !== c.description) run('DELETE FROM character_refs WHERE character_id = ?', c.id);
  res.json(characterOut(get('SELECT * FROM characters WHERE id = ?', c.id)));
});
characters.delete('/:id', (req, res) => {
  for (const r of all('SELECT image_path FROM character_refs WHERE character_id = ?', req.params.id)) fs.rmSync(r.image_path, { force: true });
  run('DELETE FROM characters WHERE id = ?', req.params.id);
  res.json({ ok: true });
});
characters.post('/:id/reference', async (req, res) => {
  const c = get('SELECT * FROM characters WHERE id = ?', req.params.id);
  if (!c) return res.status(404).json({ error: 'Personaje no encontrado' });
  await generateCharacterRef(c, getStyle(req.body?.style_id || '2d-stickman'));
  res.json(characterOut(c));
});
characters.post('/:id/reference/upload', upload.single('file'), (req, res) => {
  const c = get('SELECT * FROM characters WHERE id = ?', req.params.id);
  if (!c || !req.file) return res.status(400).json({ error: 'Falta el personaje o el archivo' });
  const style = getStyle(req.body?.style_id || '2d-stickman');
  const out = path.join(mediaSubdir('characters'), `${c.id}_${style.id}${extOf(req.file, '.png')}`);
  fs.renameSync(req.file.path, out);
  run(`INSERT INTO character_refs(character_id, style_id, image_path, created_at) VALUES(?,?,?,?)
       ON CONFLICT(character_id, style_id) DO UPDATE SET image_path = excluded.image_path`, c.id, style.id, out, now());
  res.json(characterOut(c));
});

// ---------------- Avatares ----------------
export const avatars = Router();
const avatarOut = a => ({ ...a, image_url: a.image_path && fs.existsSync(a.image_path) ? mediaUrl(a.image_path) : null });
avatars.get('/', (req, res) => res.json(all('SELECT * FROM avatars ORDER BY created_at DESC').map(avatarOut)));
avatars.post('/', async (req, res) => {
  const b = req.body || {};
  if (!b.name?.trim() || !b.description?.trim()) return res.status(400).json({ error: 'El avatar necesita nombre y descripción.' });
  const style = getStyle(b.style_id || '2d-personaje');
  const id = uid('av_');
  const out = path.join(mediaSubdir('avatars'), `${id}.png`);
  await generateImage({
    prompt: `${styleBlock(style)}\nAVATAR PORTRAIT for a video presenter: ${b.description}. Head and shoulders, centered, facing the viewer, friendly expression, simple clean background. No text.`,
    aspect: '1:1', outPath: out,
  });
  run('INSERT INTO avatars(id, name, description, style_id, image_path, created_at) VALUES(?,?,?,?,?,?)', id, b.name.trim(), b.description.trim(), style.id, out, now());
  res.status(201).json(avatarOut(get('SELECT * FROM avatars WHERE id = ?', id)));
});
avatars.post('/upload', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Falta el archivo' });
  const id = uid('av_');
  const out = path.join(mediaSubdir('avatars'), `${id}${extOf(req.file, '.png')}`);
  fs.renameSync(req.file.path, out);
  run('INSERT INTO avatars(id, name, description, image_path, created_at) VALUES(?,?,?,?,?)', id, (req.body?.name || 'Avatar').trim(), 'Imagen subida', out, now());
  res.status(201).json(avatarOut(get('SELECT * FROM avatars WHERE id = ?', id)));
});
avatars.delete('/:id', (req, res) => {
  const a = get('SELECT * FROM avatars WHERE id = ?', req.params.id);
  if (a?.image_path) fs.rmSync(a.image_path, { force: true });
  run('DELETE FROM avatars WHERE id = ?', req.params.id);
  res.json({ ok: true });
});

// ---------------- Voces ----------------
export const voices = Router();
voices.get('/', async (req, res) => {
  const provider = req.query.provider || getSettings().tts_provider;
  res.json(await listVoices(provider));
});
/** Muestra de voz generada en vivo con la API (se cachea por voz y ajustes). */
voices.post('/preview', async (req, res) => {
  const b = req.body || {};
  const voice = { provider: b.provider || getSettings().tts_provider, voice_id: b.voice_id, speed: b.speed, stability: b.stability, style: b.style, tone: b.tone, language: b.language };
  const text = (b.text || 'Hola, esta es mi voz. Así sonará la narración de tu video.').slice(0, 300);
  const hash = crypto.createHash('sha1').update(JSON.stringify({ ...voice, text })).digest('hex').slice(0, 16);
  const cached = get('SELECT * FROM voice_samples WHERE provider = ? AND voice_id = ? AND settings_hash = ?', voice.provider, voice.voice_id || '', hash);
  if (cached && fs.existsSync(cached.path)) return res.json({ url: mediaUrl(cached.path) });
  const out = path.join(mediaSubdir('voices'), `${voice.provider}_${hash}.mp3`);
  await synthesize({ text, voice, outPath: out });
  run('INSERT OR REPLACE INTO voice_samples(provider, voice_id, settings_hash, path) VALUES(?,?,?,?)', voice.provider, voice.voice_id || '', hash, out);
  res.json({ url: mediaUrl(out) });
});

// ---------------- Música ----------------
export const music = Router();
const trackOut = t => ({ ...t, url: fs.existsSync(t.path) ? mediaUrl(t.path) : null, path: undefined });
music.get('/moods', (req, res) => res.json(MUSIC_MOODS));
music.get('/', (req, res) => res.json(all('SELECT * FROM music_tracks ORDER BY created_at DESC').map(trackOut)));
music.post('/generate', async (req, res) => {
  const b = req.body || {};
  const mood = MUSIC_MOODS.find(m => m.id === b.mood) || MUSIC_MOODS[4];
  const prompt = b.prompt?.trim() || mood.prompt;
  const seconds = Math.min(600, Math.max(10, Number(b.seconds) || 60));
  const id = uid('mus_');
  const out = path.join(mediaSubdir('music'), `${id}.mp3`);
  await composeMusic({ prompt, seconds, outPath: out });
  const d = await probeDuration(out);
  run('INSERT INTO music_tracks(id, name, mood, prompt, source, path, duration, created_at) VALUES(?,?,?,?,?,?,?,?)', id, b.name?.trim() || mood.name, mood.id, prompt, 'ai', out, d, now());
  res.status(201).json(trackOut(get('SELECT * FROM music_tracks WHERE id = ?', id)));
});
music.post('/upload', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Falta el archivo' });
  const id = uid('mus_');
  const out = path.join(mediaSubdir('music'), `${id}${extOf(req.file, '.mp3')}`);
  fs.renameSync(req.file.path, out);
  let d;
  try { d = await probeDuration(out); } catch { fs.rmSync(out, { force: true }); return res.status(400).json({ error: 'El archivo no es un audio válido.' }); }
  run('INSERT INTO music_tracks(id, name, mood, prompt, source, path, duration, created_at) VALUES(?,?,?,?,?,?,?,?)', id, (req.body?.name || req.file.originalname || 'Pista').trim(), req.body?.mood || null, null, 'upload', out, d, now());
  res.status(201).json(trackOut(get('SELECT * FROM music_tracks WHERE id = ?', id)));
});
music.delete('/:id', (req, res) => {
  const t = get('SELECT * FROM music_tracks WHERE id = ?', req.params.id);
  if (t) fs.rmSync(t.path, { force: true });
  run('DELETE FROM music_tracks WHERE id = ?', req.params.id);
  res.json({ ok: true });
});

// ---------------- Ajustes y claves ----------------
export const settings = Router();
settings.get('/', (req, res) => res.json({ values: getSettings(), defaults: DEFAULTS }));
settings.put('/', (req, res) => res.json({ values: setSettings(req.body || {}), defaults: DEFAULTS }));

export const keys = Router();
keys.get('/', (req, res) => res.json(keysStatus()));
keys.put('/:provider', (req, res) => { setKey(req.params.provider, req.body?.value || ''); res.json(keysStatus()); });
/** Prueba real de cada clave con una llamada ligera a la API del proveedor. */
keys.post('/:provider/test', async (req, res) => {
  const p = req.params.provider;
  const k = getKey(p);
  if (!API_KEYS[p]) return res.status(404).json({ error: 'Proveedor desconocido' });
  if (!k) return res.json({ ok: false, message: 'No hay clave configurada.' });
  const checks = {
    anthropic: () => request('Anthropic', `${BASE_URLS.anthropic || 'https://api.anthropic.com'}/v1/models?limit=1`, { headers: { 'x-api-key': k, 'anthropic-version': '2023-06-01' } }, { retries: 0, timeoutMs: 20000 }),
    openai: () => request('OpenAI', `${BASE_URLS.openai}/v1/models`, { headers: { Authorization: `Bearer ${k}` } }, { retries: 0, timeoutMs: 20000 }),
    gemini: () => request('Gemini', `${BASE_URLS.gemini}/v1beta/models?pageSize=1`, { headers: { 'x-goog-api-key': k } }, { retries: 0, timeoutMs: 20000 }),
    replicate: () => request('Replicate', `${BASE_URLS.replicate}/v1/account`, { headers: { Authorization: `Bearer ${k}` } }, { retries: 0, timeoutMs: 20000 }),
    elevenlabs: () => request('ElevenLabs', `${BASE_URLS.elevenlabs}/v1/voices`, { headers: { 'xi-api-key': k } }, { retries: 0, timeoutMs: 20000 }),
  };
  try { await checks[p](); res.json({ ok: true, message: 'Conexión correcta.' }); }
  catch (e) { res.json({ ok: false, message: e.message }); }
});
