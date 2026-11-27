// GRATIS Y LOCAL: Piper TTS (código abierto, licencia MIT; voces neuronales que funcionan
// sin internet, en CPU, sin límites ni créditos). Vimo descarga el programa y las voces
// desde sus repositorios oficiales y las guarda en la carpeta de datos.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn, spawnSync } from 'node:child_process';
import { DATA_DIR } from '../db.js';
import { request, json, ProviderError } from './http.js';
import { runFfmpeg } from '../media.js';

const TOOLS = path.join(DATA_DIR, 'tools');
const PIPER_DIR = path.join(TOOLS, 'piper');
export const VOICES_DIR = path.join(TOOLS, 'piper-voices');
const RELEASE = 'https://github.com/rhasspy/piper/releases/download/2023.11.14-2/';
const VOICES_BASE = process.env.VIMO_PIPER_VOICES_URL || 'https://huggingface.co/rhasspy/piper-voices/resolve/main/';

// Catálogo de respaldo (voces en español) por si no se puede descargar voices.json.
const FALLBACK = [
  ['es_ES', 'davefx', 'medium'], ['es_ES', 'sharvard', 'medium'], ['es_ES', 'carlfm', 'x_low'], ['es_ES', 'mls_10246', 'low'], ['es_ES', 'mls_9972', 'low'],
  ['es_MX', 'ald', 'medium'], ['es_MX', 'claude', 'high'], ['es_AR', 'daniela', 'high'],
].map(([loc, name, q]) => ({
  key: `${loc}-${name}-${q}`, name, quality: q, language: { code: loc, name_native: 'Español', country_english: loc.split('_')[1] },
  files: { [`es/${loc}/${name}/${q}/${loc}-${name}-${q}.onnx`]: { size_bytes: 0 }, [`es/${loc}/${name}/${q}/${loc}-${name}-${q}.onnx.json`]: { size_bytes: 0 } },
}));

function assetName() {
  const p = process.platform, a = process.arch;
  if (p === 'win32') return 'piper_windows_amd64.zip';
  if (p === 'linux') return a === 'arm64' ? 'piper_linux_aarch64.tar.gz' : 'piper_linux_x86_64.tar.gz';
  if (p === 'darwin') return a === 'arm64' ? 'piper_macos_aarch64.tar.gz' : 'piper_macos_x64.tar.gz';
  throw new Error('Sistema operativo no compatible con Piper');
}

export function piperBinary() {
  if (process.env.PIPER_PATH && fs.existsSync(process.env.PIPER_PATH)) return process.env.PIPER_PATH;
  const exe = process.platform === 'win32' ? 'piper.exe' : 'piper';
  for (const c of [path.join(PIPER_DIR, 'piper', exe), path.join(PIPER_DIR, exe)]) if (fs.existsSync(c)) return c;
  return null;
}

async function download(url, dest, signal) {
  const res = await request('Descarga', url, {}, { signal, retries: 2, timeoutMs: 15 * 60_000 });
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const tmp = dest + '.part';
  fs.writeFileSync(tmp, Buffer.from(await res.arrayBuffer()));
  fs.renameSync(tmp, dest);
}

/** Descarga e instala el programa Piper para este sistema operativo. */
export async function installPiper({ signal } = {}) {
  if (piperBinary()) return piperBinary();
  const asset = assetName();
  const file = path.join(TOOLS, asset);
  await download(RELEASE + asset, file, signal);
  fs.mkdirSync(PIPER_DIR, { recursive: true });
  // tar está incluido en Windows 10/11 y también extrae .zip
  const r = spawnSync('tar', ['-xf', file, '-C', PIPER_DIR]);
  fs.rmSync(file, { force: true });
  if (r.status !== 0) throw new Error('No se pudo descomprimir Piper: ' + String(r.stderr));
  const bin = piperBinary();
  if (!bin) throw new Error('Piper se descargó pero no se encontró el ejecutable.');
  if (process.platform !== 'win32') fs.chmodSync(bin, 0o755);
  return bin;
}

let catalogCache = null;
async function catalog() {
  if (catalogCache) return catalogCache;
  const cacheFile = path.join(TOOLS, 'piper-voices.json');
  try {
    const j = await json('Piper', VOICES_BASE + 'voices.json', {}, { retries: 1, timeoutMs: 20000 });
    fs.mkdirSync(TOOLS, { recursive: true });
    fs.writeFileSync(cacheFile, JSON.stringify(j));
    catalogCache = Object.values(j);
  } catch {
    catalogCache = fs.existsSync(cacheFile) ? Object.values(JSON.parse(fs.readFileSync(cacheFile, 'utf8'))) : FALLBACK;
  }
  return catalogCache;
}

function installedVoices() {
  if (!fs.existsSync(VOICES_DIR)) return [];
  return fs.readdirSync(VOICES_DIR).filter(f => f.endsWith('.onnx') && fs.existsSync(path.join(VOICES_DIR, f + '.json'))).map(f => f.replace(/\.onnx$/, ''));
}

export async function listPiperVoices(language = 'es') {
  const installed = new Set(installedVoices());
  const cat = await catalog();
  const lang = String(language || 'es').slice(0, 2);
  const out = cat
    .map(v => {
      const size = Object.entries(v.files || {}).find(([f]) => f.endsWith('.onnx'))?.[1]?.size_bytes || 0;
      return {
        id: v.key, provider: 'piper', installed: installed.has(v.key),
        name: `${v.name} (${v.quality})`,
        gender: '—',
        language: `${v.language?.name_native || ''} · ${v.language?.country_english || v.language?.code || ''}`,
        lang: v.language?.code || '',
        description: `Voz local de Piper · calidad ${v.quality}${size ? ` · ${Math.round(size / 1e6)} MB` : ''}${installed.has(v.key) ? ' · instalada' : ' · se descarga una vez'}`,
        preview_url: null,
      };
    })
    .sort((a, b) => (b.installed - a.installed) || ((b.lang.startsWith(lang)) - (a.lang.startsWith(lang))) || a.id.localeCompare(b.id));
  // Voces importadas a mano que no están en el catálogo.
  for (const k of installed) if (!out.some(v => v.id === k)) out.unshift({ id: k, provider: 'piper', installed: true, name: k, gender: '—', language: 'importada', lang: '', description: 'Voz local importada', preview_url: null });
  return out;
}

export async function downloadPiperVoice(key, { signal } = {}) {
  const v = (await catalog()).find(x => x.key === key);
  if (!v) throw new Error('Voz no encontrada en el catálogo de Piper: ' + key);
  const files = Object.keys(v.files).filter(f => f.endsWith('.onnx') || f.endsWith('.onnx.json'));
  for (const f of files) {
    const dest = path.join(VOICES_DIR, path.basename(f));
    if (!fs.existsSync(dest)) await download(VOICES_BASE + f, dest, signal);
  }
  return key;
}

export function piperStatus() {
  const bin = piperBinary();
  return { installed: !!bin, binary: bin, voices: installedVoices() };
}

/** Sintetiza texto con Piper y lo guarda como MP3. */
export async function piperSynthesize({ text, voiceId, speed = 1, outPath, signal }) {
  const bin = piperBinary();
  if (!bin) throw new ProviderError('Piper', 0, 'Piper no está instalado. Ve a «Claves API → Servicios locales» y pulsa «Instalar Piper».');
  const model = path.join(VOICES_DIR, `${voiceId}.onnx`);
  if (!voiceId || !fs.existsSync(model)) throw new ProviderError('Piper', 0, `la voz «${voiceId || '(ninguna)'}» no está descargada. Descárgala en «Voces».`);
  const wav = path.join(os.tmpdir(), `vimo_piper_${process.pid}_${Date.now()}_${Math.random().toString(36).slice(2)}.wav`);
  await new Promise((resolve, reject) => {
    const p = spawn(bin, ['--model', model, '--output_file', wav, '--length_scale', String((1 / Math.min(2, Math.max(0.5, Number(speed) || 1))).toFixed(3)), '--sentence_silence', '0.25'], {
      cwd: path.dirname(bin), stdio: ['pipe', 'ignore', 'pipe'],
    });
    let err = '';
    p.stderr.on('data', d => { err += d; if (err.length > 8000) err = err.slice(-8000); });
    const onAbort = () => p.kill('SIGKILL');
    signal?.addEventListener('abort', onAbort, { once: true });
    p.on('error', e => reject(new ProviderError('Piper', 0, 'no se pudo ejecutar: ' + e.message)));
    p.on('close', code => {
      signal?.removeEventListener('abort', onAbort);
      if (signal?.aborted) return reject(signal.reason || new Error('Cancelado'));
      if (code === 0 && fs.existsSync(wav) && fs.statSync(wav).size > 1000) resolve();
      else reject(new ProviderError('Piper', 0, `falló (código ${code}): ${err.trim().split('\n').slice(-3).join(' | ')}`));
    });
    p.stdin.end(text.replace(/\s+/g, ' ').trim() + '\n', 'utf8');
  });
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  await runFfmpeg(['-y', '-i', wav, '-ar', '44100', '-ac', '1', '-c:a', 'libmp3lame', '-b:a', '128k', outPath], { signal });
  fs.rmSync(wav, { force: true });
  return outPath;
}
