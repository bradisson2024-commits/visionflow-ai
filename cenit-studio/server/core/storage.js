// Almacenamiento de archivos: Supabase Storage (si hay SUPABASE_SERVICE_ROLE_KEY) o disco local.
// Las rutas son relativas («proyectos/<id>/escenas/003.png»). El trabajo pesado (FFmpeg) usa una copia local en caché.
import fs from 'node:fs';
import path from 'node:path';
import { config, storageMode } from '../config.js';
import { call } from './http.js';

const local = (key) => {
  const f = path.resolve(config.storageDir, key);
  if (!f.startsWith(config.storageDir + path.sep)) throw new Error('Ruta de almacenamiento no válida');
  return f;
};

export async function put(key, data, contentType = 'application/octet-stream') {
  const buf = Buffer.isBuffer(data) ? data : fs.readFileSync(data);
  const f = local(key);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, buf);
  if (storageMode() === 'supabase') {
    await call('Supabase Storage', 'upload', `${config.supabaseUrl}/storage/v1/object/${config.storageBucket}/${key}`, {
      method: 'POST', headers: { authorization: `Bearer ${config.supabaseServiceKey}`, 'content-type': contentType, 'x-upsert': 'true' }, body: buf,
    }, { attempts: 3, timeout: 300000 });
  }
  return key;
}

/** Ruta local del archivo (lo descarga de Supabase si no está en caché). */
export async function localPath(key) {
  const f = local(key);
  if (fs.existsSync(f)) return f;
  if (storageMode() !== 'supabase') throw new Error(`Archivo no encontrado: ${key}`);
  const res = await call('Supabase Storage', 'download', `${config.supabaseUrl}/storage/v1/object/${config.storageBucket}/${key}`, { headers: { authorization: `Bearer ${config.supabaseServiceKey}` } }, { raw: true });
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, Buffer.from(await res.arrayBuffer()));
  return f;
}

export const exists = (key) => !!key && fs.existsSync(local(key));
export const scratch = (key) => { const f = local(key); fs.mkdirSync(path.dirname(f), { recursive: true }); return f; };

export async function remove(prefix) {
  fs.rmSync(local(prefix), { recursive: true, force: true });
}
