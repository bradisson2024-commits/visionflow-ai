// Generador de guion y storyboard. Cada cifra del guion debe llevar una fuente real [n].
import * as gemini from '../services/gemini.js';
import { sourcesBlock } from './improver.js';
import { sentences, stripRefs, refsIn, words, auditFacts, copiedRatio } from './textkit.js';
import { MASCOT } from './mascot.js';

const VOICE = `Escribes para EL PRECIO OCULTO (YouTube, español latino neutro). Narración para voz en off: frases de 8 a 20 palabras, lenguaje sencillo, ejemplos concretos, suspenso y revelaciones progresivas, sin acotaciones ni indicaciones de cámara.
REGLAS DE VERDAD: usa sólo datos del MATERIAL. Toda oración con una cifra, fecha o caso concreto termina con su fuente, por ejemplo «… en 1961 [3].». Si no hay fuente, explica la idea sin cifras. No inventes citas ni testimonios. No copies frases de otros videos.`;

export async function writeScript({ proposal, research, transcript, log }) {
  const material = sourcesBlock(research, 32000);
  const parts = [];
  for (const [i, part] of proposal.partes.entries()) {
    const before = parts.map((p) => stripRefs(p.paragraphs.join(' ')).slice(-500)).join('\n').slice(-2000);
    const hook = i === 0 ? `\nUsa como base este gancho: «${proposal.ganchos?.[proposal.gancho_elegido ?? 0] || ''}».` : '';
    const r = await gemini.ask({
      json: true, temperature: 0.75, system: VOICE,
      prompt: `MATERIAL:\n${material}\n\nVIDEO: ${proposal.titulo}\nÁNGULO: ${proposal.angulo}\nESTRUCTURA: ${proposal.partes.map((p, k) => `${k + 1}. ${p.nombre}`).join(' · ')}\nYA ESCRITO (final): ${before || '—'}\n
Escribe SOLO la parte ${i + 1}: «${part.nombre}». Objetivo: ${part.objetivo}. Puntos: ${(part.puntos || []).join(' | ')}. Unas ${part.palabras || 200} palabras.${hook}
JSON: {"parrafos": [string]}`,
    });
    const paragraphs = (r.data.parrafos || []).map((x) => String(x).trim()).filter(Boolean);
    if (!paragraphs.length) throw new Error(`Gemini no escribió la parte «${part.nombre}».`);
    parts.push({ name: part.nombre, paragraphs });
    log?.(`Parte ${i + 1}/${proposal.partes.length}: ${words(paragraphs.join(' '))} palabras.`);
  }

  // Verificación de datos: dos rondas de corrección y, si aún falta respaldo, la oración se elimina.
  const removed = [];
  for (let round = 0; round < 3; round++) {
    const all = parts.flatMap((p) => p.paragraphs);
    const { missing, invalid } = auditFacts(all, research.sources.length);
    const bad = [...new Set([...missing, ...invalid])];
    if (!bad.length) break;
    if (round === 2) {
      for (const p of parts) p.paragraphs = p.paragraphs.map((pp) => sentences(pp).filter((s) => !bad.includes(s)).join(' ')).filter(Boolean);
      removed.push(...bad);
      log?.(`${bad.length} oraciones eliminadas por no tener fuente verificable.`, 'warn');
      break;
    }
    log?.(`Verificando datos: ${bad.length} oraciones sin fuente válida (ronda ${round + 1}).`, 'warn');
    const r = await gemini.ask({
      json: true, temperature: 0.1, system: VOICE,
      prompt: `MATERIAL:\n${material}\n\nEstas oraciones tienen cifras o datos sin fuente válida (las fuentes válidas van de [1] a [${research.sources.length}]). Para cada una: si el MATERIAL la respalda, devuélvela con su fuente correcta; si no, reescríbela sin el dato.\n${bad.map((s, k) => `${k + 1}. ${s}`).join('\n')}\nJSON: {"arreglos": [{"n": number, "texto": string}]}`,
    });
    const fix = new Map((r.data.arreglos || []).map((a) => [bad[Number(a.n) - 1], String(a.texto).trim()]));
    for (const p of parts) p.paragraphs = p.paragraphs.map((pp) => sentences(pp).map((s) => fix.get(s) || s).join(' '));
  }

  const full = parts.flatMap((p) => p.paragraphs).join(' ');
  const copied = copiedRatio(full, transcript);
  if (copied != null && copied > 0.06) throw new Error(`El guion repite literalmente el ${(copied * 100).toFixed(1)} % de frases del original. Se exige un guion propio: repite la etapa.`);
  const count = words(full);
  return { title: proposal.titulo, parts, words: count, minutes: +(count / 150).toFixed(1), copied, removed, cited: [...new Set(refsIn(full))].sort((a, b) => a - b) };
}

/** Divide el guion en escenas de 10–28 palabras sin perder ni repetir texto. */
export function cutScenes(parts, { min = 10, max = 28 } = {}) {
  const out = [];
  for (const part of parts) {
    let buf = [];
    const units = part.paragraphs.flatMap((p) => sentences(p)).flatMap((s) => {
      if (words(s) <= max + 10) return [s];
      const pieces = []; let cur = '';
      for (const c of s.split(/(?<=[,;:])\s+/)) { if (cur && words(`${cur} ${c}`) > max) { pieces.push(cur); cur = c; } else cur = cur ? `${cur} ${c}` : c; }
      if (cur) pieces.push(cur);
      return pieces;
    });
    const flush = () => { if (buf.length) out.push({ part: part.name, withRefs: buf.join(' ') }); buf = []; };
    for (const u of units) {
      if (buf.length && words(buf.join(' ')) >= min && words(`${buf.join(' ')} ${u}`) > max) flush();
      buf.push(u);
    }
    flush();
  }
  return out.map((s, i) => ({ n: i + 1, part: s.part, narration: stripRefs(s.withRefs), withRefs: s.withRefs, sources: [...new Set(refsIn(s.withRefs))] }));
}

export const sameText = (parts, scenes) => stripRefs(parts.flatMap((p) => p.paragraphs).join(' ')).replace(/\s+/g, ' ') === scenes.map((s) => s.narration).join(' ').replace(/\s+/g, ' ');

/** Storyboard: qué debe verse exactamente durante cada fragmento. */
export async function storyboard(scenes, title, log) {
  const step = 10;
  for (let i = 0; i < scenes.length; i += step) {
    const batch = scenes.slice(i, i + step);
    let got;
    for (let attempt = 0; attempt < 3 && !got; attempt++) {
      const r = await gemini.ask({
        json: true, temperature: 0.5,
        system: `Eres director de arte de EL PRECIO OCULTO. Cada escena es UNA ilustración Stickman estática que muestra exactamente lo que dice su narración (no lo anterior ni lo siguiente). Metáforas visuales simples para ideas abstractas: flechas, monedas, edificios, contratos, mapas, gráficos a mano. Sin texto escrito en la imagen. Marcas reales: represéntalas de forma genérica, sin logotipos.
La mascota aparece cuando el narrador investiga, revela o reacciona: ${MASCOT.prompt_en}.`,
        prompt: `Video: «${title}»\nAntes: ${scenes[i - 1]?.narration || '(inicio)'}\nDespués (no ilustrar): ${scenes[i + step]?.narration || '(fin)'}\n\n${batch.map((s) => `${s.n}. ${s.narration}`).join('\n')}\n
JSON: {"escenas": [{"n": number, "ve": string (qué se ve, en español, una frase), "prompt": string (descripción en inglés de 25–60 palabras: personajes, acción, expresión, objetos, lugar; si sale la mascota escribe "the detective mascot"), "efecto": null | "transicion" | "revelacion" | "tension"}]}
Exactamente ${batch.length} elementos, n = ${batch.map((s) => s.n).join(', ')}.`,
      });
      const arr = r.data.escenas || [];
      if (arr.length === batch.length && batch.every((s, k) => Number(arr[k]?.n) === s.n && arr[k]?.prompt)) got = arr;
    }
    if (!got) throw new Error(`No se pudo crear el storyboard de las escenas ${batch[0].n}–${batch.at(-1).n}.`);
    batch.forEach((s, k) => { s.visual = got[k].ve; s.image_prompt = String(got[k].prompt).replace(/\s+/g, ' ').trim(); s.sfx = ['transicion', 'revelacion', 'tension'].includes(got[k].efecto) ? got[k].efecto : null; });
    log?.(`Storyboard: escenas ${batch[0].n}–${batch.at(-1).n}.`);
  }
  return scenes;
}
