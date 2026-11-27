// GRATIS Y LOCAL: ComfyUI (Stable Diffusion / SDXL / FLUX en tu propio computador).
//
// Vimo se conecta a la API HTTP de ComfyUI:
//   POST /prompt            → encola el flujo de trabajo (workflow en "formato API")
//   GET  /history/{id}      → estado y archivos generados
//   GET  /view?filename=…   → descarga la imagen
//   POST /upload/image      → sube imágenes de referencia (flujos con IPAdapter, etc.)
//   GET  /object_info/…     → lista de modelos (checkpoints) instalados
//   GET  /system_stats      → comprobación de conexión
//
// Por defecto se usa un flujo texto→imagen estándar (CheckpointLoaderSimple + KSampler).
// Opcionalmente el usuario puede pegar su propio flujo exportado con «Save (API Format)»
// usando los marcadores {{prompt}}, {{negative}}, {{seed}}, {{width}}, {{height}} y {{ref_image}}.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { getSettings } from '../settings.js';
import { json, buffer, request, ProviderError } from './http.js';

export const COMFY_PRESETS = {
  sdxl_lightning: { label: 'SDXL Lightning / Turbo (rápido, 4–8 pasos)', steps: 6, cfg: 2, sampler: 'dpmpp_sde', scheduler: 'karras', width: 1344, height: 768, square: 1024 },
  sdxl: { label: 'SDXL estándar (25 pasos)', steps: 25, cfg: 6, sampler: 'dpmpp_2m', scheduler: 'karras', width: 1344, height: 768, square: 1024 },
  sd15: { label: 'Stable Diffusion 1.5 (equipos modestos)', steps: 25, cfg: 7, sampler: 'dpmpp_2m', scheduler: 'karras', width: 912, height: 512, square: 640 },
};

const base = () => getSettings().comfyui_url.replace(/\/$/, '');

function wrapNetwork(e) {
  if (e instanceof ProviderError && e.status === 0) {
    return new ProviderError('ComfyUI', 0, `no responde en ${base()}. Abre ComfyUI (run_cpu.bat o run_nvidia_gpu.bat) y comprueba la dirección en Claves API → Servicios locales.`);
  }
  return e;
}

export async function comfyStatus() {
  const r = await json('ComfyUI', `${base()}/system_stats`, {}, { retries: 0, timeoutMs: 8000 }).catch(e => { throw wrapNetwork(e); });
  const dev = r.devices?.[0];
  return { version: r.system?.comfyui_version || null, device: dev ? `${dev.name || dev.type}` : null, vram_gb: dev?.vram_total ? +(dev.vram_total / 1e9).toFixed(1) : null };
}

export async function listCheckpoints() {
  const r = await json('ComfyUI', `${base()}/object_info/CheckpointLoaderSimple`, {}, { retries: 0, timeoutMs: 10000 }).catch(e => { throw wrapNetwork(e); });
  const list = r.CheckpointLoaderSimple?.input?.required?.ckpt_name?.[0];
  return Array.isArray(list) ? list : [];
}

function defaultWorkflow({ ckpt, prompt, negative, width, height, seed, steps, cfg, sampler, scheduler }) {
  return {
    4: { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: ckpt } },
    5: { class_type: 'EmptyLatentImage', inputs: { width, height, batch_size: 1 } },
    6: { class_type: 'CLIPTextEncode', inputs: { text: prompt, clip: ['4', 1] } },
    7: { class_type: 'CLIPTextEncode', inputs: { text: negative, clip: ['4', 1] } },
    3: { class_type: 'KSampler', inputs: { seed, steps, cfg, sampler_name: sampler, scheduler, denoise: 1, model: ['4', 0], positive: ['6', 0], negative: ['7', 0], latent_image: ['5', 0] } },
    8: { class_type: 'VAEDecode', inputs: { samples: ['3', 0], vae: ['4', 2] } },
    9: { class_type: 'SaveImage', inputs: { filename_prefix: 'vimo', images: ['8', 0] } },
  };
}

/** Sustituye los marcadores {{…}} de un flujo personalizado. Un valor que es exactamente un marcador numérico se convierte en número. */
function fillTemplate(node, vars) {
  if (Array.isArray(node)) return node.map(n => fillTemplate(n, vars));
  if (node && typeof node === 'object') return Object.fromEntries(Object.entries(node).map(([k, v]) => [k, fillTemplate(v, vars)]));
  if (typeof node === 'string') {
    const exact = node.match(/^\{\{(\w+)\}\}$/);
    if (exact && exact[1] in vars) return vars[exact[1]];
    return node.replace(/\{\{(\w+)\}\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
  }
  return node;
}

async function uploadImage(file, signal) {
  const fd = new FormData();
  const name = `vimo_${crypto.createHash('md5').update(fs.readFileSync(file)).digest('hex').slice(0, 12)}${path.extname(file) || '.png'}`;
  fd.append('image', new Blob([fs.readFileSync(file)], { type: 'image/png' }), name);
  fd.append('overwrite', 'true');
  const r = await json('ComfyUI', `${base()}/upload/image`, { method: 'POST', body: fd }, { signal, retries: 1 });
  return r.subfolder ? `${r.subfolder}/${r.name}` : r.name;
}

export function comfyDimensions(aspect) {
  const s = getSettings();
  const w = Number(s.comfyui_width) || 1344, h = Number(s.comfyui_height) || 768;
  const preset = COMFY_PRESETS[s.comfyui_preset] || COMFY_PRESETS.sdxl;
  const r8 = v => Math.max(256, Math.round(v / 8) * 8);
  if (aspect === '9:16') return { width: r8(h), height: r8(w) };
  if (aspect === '1:1') return { width: r8(preset.square), height: r8(preset.square) };
  return { width: r8(w), height: r8(h) };
}

/** Genera una imagen en ComfyUI y devuelve sus bytes. onProgress(texto) informa del estado real de la cola. */
export async function comfyImage({ prompt, negative, refs = [], aspect = '16:9', seed, signal, onProgress }) {
  const s = getSettings();
  const { width, height } = comfyDimensions(aspect);
  const sd = Number.isFinite(seed) ? seed : Math.floor(Math.random() * 2 ** 31);
  let workflow;
  const custom = s.comfyui_workflow?.trim();
  if (custom && (!custom.includes('{{ref_image}}') || refs.length)) {
    let tpl;
    try { tpl = JSON.parse(custom); } catch { throw new ProviderError('ComfyUI', 0, 'el flujo personalizado no es JSON válido. Expórtalo con «Save (API Format)».'); }
    if (tpl.nodes && tpl.links) throw new ProviderError('ComfyUI', 0, 'el flujo personalizado está en formato de interfaz. Expórtalo con «Save (API Format)» (activa el modo desarrollador en ajustes de ComfyUI).');
    const vars = { prompt, negative: negative || s.comfyui_negative, seed: sd, width, height };
    if (custom.includes('{{ref_image}}')) vars.ref_image = await uploadImage(refs[0], signal).catch(e => { throw wrapNetwork(e); });
    workflow = fillTemplate(tpl, vars);
  } else {
    let ckpt = s.comfyui_checkpoint?.trim();
    if (!ckpt) {
      const list = await listCheckpoints();
      if (!list.length) throw new ProviderError('ComfyUI', 0, 'no hay ningún modelo instalado. Copia un checkpoint (.safetensors) en ComfyUI/models/checkpoints y reinicia ComfyUI.');
      ckpt = list[0];
    }
    workflow = defaultWorkflow({
      ckpt, prompt, negative: negative || s.comfyui_negative, width, height, seed: sd,
      steps: Number(s.comfyui_steps) || 20, cfg: Number(s.comfyui_cfg) || 6, sampler: s.comfyui_sampler || 'euler', scheduler: s.comfyui_scheduler || 'normal',
    });
  }

  const clientId = 'vimo-' + crypto.randomUUID();
  let queued;
  try {
    queued = await json('ComfyUI', `${base()}/prompt`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt: workflow, client_id: clientId }),
    }, { signal, retries: 1 });
  } catch (e) {
    const err = wrapNetwork(e);
    if (err.status === 400) throw new ProviderError('ComfyUI', 400, `el flujo fue rechazado: ${err.message.replace(/^ComfyUI: /, '')}. Revisa el modelo seleccionado y los nodos del flujo.`);
    throw err;
  }
  const id = queued.prompt_id;
  if (!id) throw new ProviderError('ComfyUI', 0, 'no devolvió un identificador de trabajo: ' + JSON.stringify(queued.node_errors || queued).slice(0, 300));

  // Espera real: se consulta el historial hasta que el trabajo termina.
  const started = Date.now();
  const limit = 90 * 60_000; // en CPU una imagen puede tardar varios minutos
  let lastMsg = '';
  for (;;) {
    if (signal?.aborted) {
      await request('ComfyUI', `${base()}/interrupt`, { method: 'POST' }, { retries: 0 }).catch(() => {});
      throw signal.reason || new Error('Cancelado');
    }
    const h = await json('ComfyUI', `${base()}/history/${id}`, {}, { signal, retries: 2, timeoutMs: 15000 }).catch(e => { throw wrapNetwork(e); });
    const entry = h[id];
    if (entry) {
      if (entry.status?.status_str === 'error') {
        const m = (entry.status.messages || []).find(x => x[0] === 'execution_error')?.[1];
        throw new ProviderError('ComfyUI', 0, `error al generar: ${m?.exception_message || 'ver la consola de ComfyUI'}`.trim());
      }
      const images = Object.values(entry.outputs || {}).flatMap(o => o.images || []);
      const img = images.find(i => i.type === 'output') || images[0];
      if (img) {
        const q = new URLSearchParams({ filename: img.filename, subfolder: img.subfolder || '', type: img.type || 'output' });
        return buffer('ComfyUI', `${base()}/view?${q}`, {}, { signal, retries: 2 });
      }
      if (entry.status?.completed) throw new ProviderError('ComfyUI', 0, 'el flujo terminó sin imágenes. ¿Tiene un nodo SaveImage?');
    } else if (onProgress) {
      const q = await json('ComfyUI', `${base()}/queue`, {}, { signal, retries: 0 }).catch(() => null);
      const running = q?.queue_running?.some(x => x[1] === id);
      const pending = q?.queue_pending?.findIndex(x => x[1] === id);
      const msg = running ? 'ComfyUI está generando…' : pending >= 0 ? `En la cola de ComfyUI (posición ${pending + 1})` : '';
      if (msg && msg !== lastMsg) { onProgress(msg); lastMsg = msg; }
    }
    if (Date.now() - started > limit) throw new ProviderError('ComfyUI', 0, 'la imagen tardó más de 90 minutos; revisa la consola de ComfyUI.');
    await new Promise(r => setTimeout(r, 1000));
  }
}
