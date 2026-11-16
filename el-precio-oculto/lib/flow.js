// Puente con Google Flow. Flow no tiene API pública: las imágenes se generan en la sesión de Chrome del usuario
// con la extensión RaulitoShow IA (extension-flow/), que envía cada resultado aquí como escena_NNN.
//   escena_000 → hoja de personajes (imagenes/personajes.png)
//   escena_001…escena_899 → imagen de esa escena (imagenes/escena_NNN.png)
//   escena_900 → imagen base de la miniatura (imagenes/miniatura_base.png)
//   escena_NNN_2, _3… → variantes adicionales (x2–x4), se guardan en flow/ sin sustituir la principal.
import fs from 'node:fs';
import crypto from 'node:crypto';
import { loadProject, projectPath } from './project.js';
import { fullPrompt, characterSheetPrompt, thumbnailPrompt, normalizeImage } from './visuals.js';

export const SHEET_N = 0;
export const THUMB_N = 900;
const NAME_RE = /^escena_(\d{3})(?:_(\d+))?\.(png|jpe?g|webp)$/i;

export const fileHash = (f) => crypto.createHash('sha1').update(fs.readFileSync(f)).digest('hex').slice(0, 12);
const mtime = (f) => (fs.existsSync(f) ? fs.statSync(f).mtimeMs : 0);

export function targetFor(p, n) {
  if (n === SHEET_N) return projectPath(p.id, 'imagenes', 'personajes.png');
  if (n === THUMB_N) return projectPath(p.id, 'imagenes', 'miniatura_base.png');
  const s = p.scenes.find((x) => x.n === n);
  return s ? projectPath(p.id, 'imagenes', `${s.id}.png`) : null;
}

/** Prompt de una línea (Flow trata cada línea del TXT como una escena). */
const oneLine = (t) => String(t).replace(/\s+/g, ' ').trim();
export const scenePromptForFlow = (p, s) => oneLine(fullPrompt(s, p.characters, s.image?.fix || ''));

/** ¿Esta escena necesita (otra) imagen de Flow? */
export function scenePending(p, s) {
  const f = targetFor(p, s.n);
  if (!fs.existsSync(f)) return { pending: true, reason: 'sin imagen' };
  if (s.flowRequest && mtime(f) < s.flowRequest.at) return { pending: true, reason: 'pedida de nuevo' };
  if (s.review?.state === 'corregir' && s.review.imageHash && s.review.imageHash === fileHash(f)) return { pending: true, reason: 'marcada para corregir' };
  return { pending: false };
}

export function flowSummary(p) {
  if (!p.scenes?.length || !p.characters) return null;
  const pending = p.scenes.filter((s) => scenePending(p, s).pending).map((s) => s.n);
  return {
    total: p.scenes.length,
    received: p.scenes.filter((s) => fs.existsSync(targetFor(p, s.n))).length,
    pending,
    sheet: fs.existsSync(targetFor(p, SHEET_N)),
    thumb: fs.existsSync(targetFor(p, THUMB_N)),
  };
}

/**
 * Cola para la extensión. Primero la hoja de personajes (para usarla como referencia en Flow);
 * después las escenas pendientes y la miniatura.
 */
export function flowQueue(p, { skipSheet = false } = {}) {
  if (!p.scenes?.length || !p.characters) throw new Error('El proyecto todavía no tiene escenas planificadas. Pulsa «GENERAR VIDEO COMPLETO» en la app y vuelve aquí cuando pida las imágenes de Flow.');
  const sum = flowSummary(p);
  if (!sum.sheet && !skipSheet) {
    return { phase: 'personajes', project: p.id, title: p.script?.title, items: [{ n: SHEET_N, prompt: oneLine(characterSheetPrompt(p.characters)), label: 'Hoja de personajes' }],
      note: 'Primero se genera la hoja de personajes. Cuando termine, vuelve a pulsar «Cargar escenas del proyecto»: se usará como personaje de referencia en todas las escenas.' };
  }
  const items = p.scenes.filter((s) => sum.pending.includes(s.n)).map((s) => ({ n: s.n, prompt: scenePromptForFlow(p, s), label: s.narration.slice(0, 80) }));
  if (!sum.thumb && p.thumbnailPrompt) items.push({ n: THUMB_N, prompt: oneLine(thumbnailPrompt(p.thumbnailPrompt)), label: 'Miniatura' });
  return { phase: 'escenas', project: p.id, title: p.script?.title, items, refUrl: sum.sheet ? `/api/projects/${p.id}/file/imagenes/personajes.png` : null,
    note: items.length ? `${items.length} imágenes pendientes.` : 'No hay imágenes pendientes: vuelve a la app y pulsa «GENERAR VIDEO COMPLETO».' };
}

/** TXT para usar sin el puente (por ejemplo, el marcador de la tablet): línea N = escena N. */
export function flowTxt(p) {
  return p.scenes.map((s) => scenePromptForFlow(p, s)).join('\n') + '\n';
}

/** Guarda un resultado de Flow. Sólo escribe archivos (no project.json): el paso «imágenes» los sincroniza. */
export async function saveFlowResult(projectId, name, buffer) {
  const p = loadProject(projectId);
  if (!p) throw Object.assign(new Error(`No existe el proyecto «${projectId}» en El Precio Oculto. Usa «Cargar escenas del proyecto» en el panel.`), { status: 404 });
  const m = NAME_RE.exec(String(name || ''));
  if (!m) throw Object.assign(new Error(`Nombre no válido «${name}»: se espera escena_NNN.png/jpg/webp.`), { status: 400 });
  if (!buffer?.length) throw Object.assign(new Error('Archivo vacío'), { status: 400 });
  const n = Number(m[1]);
  const variant = m[2] ? Number(m[2]) : null;
  const target = targetFor(p, n);
  if (!target) throw Object.assign(new Error(`La escena ${n} no existe en este proyecto (tiene ${p.scenes.length}).`), { status: 400 });
  fs.mkdirSync(projectPath(p.id, 'flow'), { recursive: true });
  const raw = projectPath(p.id, 'flow', `${m[1]}${variant ? `_${variant}` : ''}_${Date.now()}.${m[3].toLowerCase()}`);
  fs.writeFileSync(raw, buffer);
  if (variant) return { project: p.id, name, path: raw, variant: true };
  const tmp = `${target}.flow.png`;
  try {
    await normalizeImage(raw, tmp);
  } catch (e) {
    fs.rmSync(tmp, { force: true });
    throw Object.assign(new Error(`El archivo de Flow no es una imagen válida: ${e.message}`), { status: 400 });
  }
  fs.renameSync(tmp, target);
  return { project: p.id, name, path: target, scene: n };
}
