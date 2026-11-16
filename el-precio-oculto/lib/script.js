// Módulo 13 · Paso 3: guion original para EL PRECIO OCULTO, con datos atados a fuentes reales.
import { generate } from './llm.js';
import { corpusForPrompt } from './research.js';

export const WORDS_PER_MINUTE = 150; // narración documental en español latino
const REF = /\s*\[(F\d+(?:\s*,\s*F\d+)*)\]/g;

export const stripRefs = (t) => String(t).replace(REF, '').replace(/\s+([.,;:!?])/g, '$1').replace(/\s{2,}/g, ' ').trim();
export const refsOf = (t) => [...String(t).matchAll(REF)].flatMap((m) => m[1].split(/\s*,\s*/));
export const wordCount = (t) => stripRefs(t).split(/\s+/).filter(Boolean).length;

/** Divide en oraciones respetando abreviaturas y cifras (3.5, 1.000). */
export function splitSentences(text) {
  const t = String(text).replace(/\s+/g, ' ').trim();
  if (!t) return [];
  const out = [];
  let buf = '';
  for (let i = 0; i < t.length; i++) {
    buf += t[i];
    const c = t[i];
    if (/[.!?…]/.test(c)) {
      // incluir cierres y referencias pegadas: ." ») [F1]
      while (i + 1 < t.length && /["»”')\]]/.test(t[i + 1])) buf += t[++i];
      const rest = t.slice(i + 1);
      const ref = rest.match(/^\s*\[F\d+(?:\s*,\s*F\d+)*\]/);
      if (ref) { buf += ref[0]; i += ref[0].length; }
      const next = t.slice(i + 1).trimStart();
      const prevWord = buf.trim().split(/\s+/).pop();
      const isAbbrev = /^(?:Sr|Sra|Dr|Dra|EE\.UU|etc|aprox|núm|No|vs|p\.ej|Inc|Co|Corp|St)\.$/i.test(prevWord);
      const isNumber = c === '.' && /\d$/.test(buf.slice(0, -1)) && /^\d/.test(t.slice(i + 1));
      if (!isAbbrev && !isNumber && (next === '' || /^[¿¡"«“A-ZÁÉÍÓÚÑ0-9]/.test(next))) { out.push(buf.trim()); buf = ''; }
    }
  }
  if (buf.trim()) out.push(buf.trim());
  return out;
}

/** Corta oraciones muy largas por comas/punto y coma para que una imagen no tenga que cubrir demasiado. */
function splitLong(sentence, maxWords = 38) {
  if (wordCount(sentence) <= maxWords) return [sentence];
  const parts = sentence.split(/(?<=[,;:])\s+/);
  const out = [];
  let buf = '';
  for (const p of parts) {
    if (buf && wordCount(buf + ' ' + p) > maxWords) { out.push(buf); buf = p; } else buf = buf ? `${buf} ${p}` : p;
  }
  if (buf) out.push(buf);
  return out;
}

/**
 * Divide el guion en escenas: cada fragmento de narración tiene exactamente una imagen.
 * La concatenación de todas las narraciones reproduce el guion completo (se comprueba).
 */
export function splitIntoScenes(sections, { minWords = 10, maxWords = 30 } = {}) {
  const scenes = [];
  sections.forEach((sec, si) => {
    const units = sec.paragraphs.flatMap((p) => splitSentences(p)).flatMap((s) => splitLong(s));
    let buf = [];
    const flush = () => {
      if (!buf.length) return;
      const withRefs = buf.join(' ');
      scenes.push({ section: sec.name, sectionIndex: si, narrationWithRefs: withRefs, narration: stripRefs(withRefs), sources: [...new Set(refsOf(withRefs))] });
      buf = [];
    };
    for (const u of units) {
      const cur = wordCount(buf.join(' '));
      const w = wordCount(u);
      if (buf.length && (cur >= minWords) && cur + w > maxWords) flush();
      buf.push(u);
      if (wordCount(buf.join(' ')) >= maxWords) flush();
    }
    flush();
    // una escena final de sección demasiado corta se une a la anterior de la misma sección
    const last = scenes[scenes.length - 1], prev = scenes[scenes.length - 2];
    if (last && prev && last.sectionIndex === si && prev.sectionIndex === si && wordCount(last.narration) < 6) {
      prev.narrationWithRefs += ' ' + last.narrationWithRefs;
      prev.narration = stripRefs(prev.narrationWithRefs);
      prev.sources = [...new Set([...prev.sources, ...last.sources])];
      scenes.pop();
    }
  });
  return scenes.map((s, i) => ({ n: i + 1, id: `escena_${String(i + 1).padStart(3, '0')}`, ...s }));
}

export function fullNarration(sections) {
  return sections.map((s) => s.paragraphs.join(' ')).join(' ');
}

/** Comprueba que dividir en escenas no perdió ni duplicó texto. */
export function scenesCoverScript(sections, scenes) {
  const a = stripRefs(fullNarration(sections)).replace(/\s+/g, ' ').trim();
  const b = scenes.map((s) => s.narration).join(' ').replace(/\s+/g, ' ').trim();
  return a === b;
}

/** Oraciones con cifras sin fuente, y referencias a fuentes inexistentes. */
export function factCheck(sections, sourceIds) {
  const ids = new Set(sourceIds);
  const unsupported = [], badRefs = [];
  for (const sec of sections) for (const p of sec.paragraphs) for (const s of splitSentences(p)) {
    const refs = refsOf(s);
    for (const r of refs) if (!ids.has(r)) badRefs.push({ sentence: s, ref: r });
    const hasFigure = /\d/.test(stripRefs(s)); // cualquier cifra o año cuenta como dato verificable
    if (hasFigure && !refs.length) unsupported.push(s);
  }
  return { unsupported, badRefs };
}

/** Coincidencia literal con el guion original (n-gramas de 8 palabras). */
export function overlapWithOriginal(newText, originalText, n = 8) {
  if (!originalText) return null;
  const toks = (t) => stripRefs(t).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9ñ ]+/g, ' ').split(/\s+/).filter(Boolean);
  const grams = (w) => { const s = new Set(); for (let i = 0; i + n <= w.length; i++) s.add(w.slice(i, i + n).join(' ')); return s; };
  const a = grams(toks(newText)), b = grams(toks(originalText));
  if (!a.size) return 0;
  let shared = 0;
  for (const g of a) if (b.has(g)) shared++;
  return +(shared / a.size).toFixed(4);
}

const CHANNEL = `EL PRECIO OCULTO es un canal de YouTube en español latino que revela el negocio, el coste o el mecanismo escondido detrás de cosas cotidianas.
Tono: narrador cercano e intrigante, frases cortas, lenguaje sencillo, como contarle un secreto a un amigo. Sin sensacionalismo falso.`;

const RULES = `REGLAS DE VERACIDAD (obligatorias):
- Usa SOLO datos que aparezcan en el MATERIAL DE INVESTIGACIÓN. Cada oración que contenga una cifra, fecha, nombre propio de un caso o dato concreto termina con su referencia, p. ej. «... en 1956 [F2].»
- Si no hay fuente para un dato, NO lo incluyas: explica la idea sin cifras.
- No copies frases del video original. Puedes tratar el mismo tema, con estructura y palabras propias.
- No inventes testimonios, citas textuales ni estadísticas.`;

export async function buildOutline({ analysis, research, video, log }) {
  const [minM, maxM] = [8, 10];
  const r = await generate({
    json: true, temperature: 0.6,
    system: `${CHANNEL}\n${RULES}`,
    prompt: `Video de referencia (sólo para entender qué tema despertó interés): «${video.title}» del canal ${video.channelTitle}.
Lo que se sabe del video original:
${JSON.stringify({ enfoque: analysis.enfoque, campos: analysis.fields, oportunidades: analysis.oportunidades_mejora }, null, 1).slice(0, 6000)}

MATERIAL DE INVESTIGACIÓN:
${corpusForPrompt(research, 30000)}

Diseña la estructura de un video ORIGINAL y MEJOR de ${minM} a ${maxM} minutos para EL PRECIO OCULTO.
Devuelve JSON:
{"title": string (máx. 70 caracteres, intrigante y honesto),
 "title_alternatives": [string, string, string],
 "thumbnail_text": string (2 a 4 palabras en mayúsculas),
 "angle": string (qué aporta este video que el original no),
 "sections": [ {"name": string, "purpose": string, "beats": [string], "sources": ["F1", ...], "target_words": number} ] }
Secciones obligatorias en este orden: Gancho (40–70 palabras, una pregunta o paradoja que obligue a quedarse), Introducción directa, 3 a 5 bloques de desarrollo con revelaciones progresivas (cada bloque termina con una pequeña pregunta o intriga que lleve al siguiente), Gran revelación, Conclusión memorable (con una frase final que se recuerde).
La suma de target_words debe estar entre ${minM * WORDS_PER_MINUTE} y ${maxM * WORDS_PER_MINUTE}.`,
  });
  const o = r.data;
  if (!Array.isArray(o.sections) || o.sections.length < 4) throw new Error('La IA no devolvió una estructura válida para el guion.');
  log?.(`Estructura: ${o.sections.length} secciones (${r.provider}).`);
  return o;
}

export async function writeSections({ outline, research, log }) {
  const corpus = corpusForPrompt(research, 30000);
  const sections = [];
  for (const [i, sec] of outline.sections.entries()) {
    const prev = sections.map((s) => `## ${s.name}\n${stripRefs(s.paragraphs.join(' ')).slice(-700)}`).join('\n').slice(-2500);
    const r = await generate({
      json: true, temperature: 0.75,
      system: `${CHANNEL}\n${RULES}\nEscribes narración para voz en off: nada de acotaciones, ni «[música]», ni indicaciones de cámara.`,
      prompt: `MATERIAL DE INVESTIGACIÓN:\n${corpus}\n\nTÍTULO DEL VIDEO: ${outline.title}\nENFOQUE: ${outline.angle}\n\nESTRUCTURA COMPLETA:\n${outline.sections.map((s, k) => `${k + 1}. ${s.name}: ${s.purpose}`).join('\n')}\n\nLO YA ESCRITO (final):\n${prev || '(nada aún)'}\n
Escribe ahora SOLO la sección ${i + 1}: «${sec.name}».
Propósito: ${sec.purpose}
Puntos: ${(sec.beats || []).join(' | ')}
Longitud: ${sec.target_words || 180} palabras aprox. (sin contar referencias).
Estilo: frases de 8 a 20 palabras, explicaciones sencillas con ejemplos concretos, suspenso y revelación progresiva. Español latino neutro. No repitas lo ya escrito.
Devuelve JSON: {"paragraphs": [string, ...]} (párrafos de 2 a 5 oraciones, con referencias [F#] al final de las oraciones con datos).`,
    });
    const paragraphs = (r.data.paragraphs || []).map((p) => String(p).trim()).filter(Boolean);
    if (!paragraphs.length) throw new Error(`La IA no escribió la sección «${sec.name}».`);
    sections.push({ name: sec.name, purpose: sec.purpose, paragraphs });
    log?.(`Sección ${i + 1}/${outline.sections.length} «${sec.name}»: ${wordCount(paragraphs.join(' '))} palabras.`);
  }
  return sections;
}

/** Reescribe las oraciones con cifras sin fuente: o se les asigna fuente del material, o se quitan las cifras. */
export async function repairUnsupported({ sections, research, unsupported, log }) {
  if (!unsupported.length) return sections;
  const r = await generate({
    json: true, temperature: 0.2,
    system: RULES,
    prompt: `MATERIAL DE INVESTIGACIÓN:\n${corpusForPrompt(research, 30000)}\n\nEstas oraciones contienen cifras o datos sin referencia. Para cada una: si el MATERIAL la respalda, devuélvela igual añadiendo la referencia [F#] correcta; si no, reescríbela sin la cifra ni el dato no comprobado, manteniendo el sentido narrativo.
${unsupported.map((s, i) => `${i + 1}. ${s}`).join('\n')}
Devuelve JSON: {"fixes": [{"index": number, "text": string}]}`,
  });
  const fixes = new Map((r.data.fixes || []).map((f) => [Number(f.index) - 1, String(f.text).trim()]));
  let changed = 0;
  const out = sections.map((sec) => ({
    ...sec,
    paragraphs: sec.paragraphs.map((p) => splitSentences(p).map((s) => {
      const idx = unsupported.indexOf(s);
      if (idx >= 0 && fixes.get(idx)) { changed++; return fixes.get(idx); }
      return s;
    }).join(' ')),
  }));
  log?.(`Verificación de datos: ${changed} oraciones corregidas.`);
  return out;
}

/** Amplía el guion si se queda corto para 8–10 minutos. */
export async function expandIfShort({ sections, research, outline, minWords, log }) {
  const total = wordCount(fullNarration(sections));
  if (total >= minWords) return sections;
  const missing = minWords - total;
  const dev = sections.map((s, i) => ({ s, i })).filter(({ i }) => i > 0 && i < sections.length - 1);
  const perSection = Math.ceil(missing / Math.max(1, dev.length));
  log?.(`El guion tiene ${total} palabras; se amplían ${dev.length} secciones (+${perSection} cada una).`);
  const out = [...sections];
  for (const { s, i } of dev) {
    const r = await generate({
      json: true, temperature: 0.7,
      system: `${CHANNEL}\n${RULES}`,
      prompt: `MATERIAL DE INVESTIGACIÓN:\n${corpusForPrompt(research, 30000)}\n\nVIDEO: ${outline.title}\nSección «${s.name}» actual:\n${s.paragraphs.join('\n\n')}\n\nAñade aproximadamente ${perSection} palabras de contenido NUEVO (ejemplos reales del material, explicación sencilla de cómo funciona, una pequeña revelación). Devuelve la sección completa ampliada como JSON {"paragraphs": [string]}.`,
    });
    const paragraphs = (r.data.paragraphs || []).filter(Boolean);
    if (paragraphs.length && wordCount(paragraphs.join(' ')) > wordCount(s.paragraphs.join(' '))) out[i] = { ...s, paragraphs };
  }
  log?.(`Guion ampliado: ${wordCount(fullNarration(out))} palabras.`);
  return out;
}

export function scriptMarkdown(script, sources) {
  const lines = [`# ${script.title}`, '', `*Enfoque:* ${script.angle}`, '', `*Duración estimada:* ${script.estimatedMinutes} min · ${script.words} palabras`, ''];
  for (const s of script.sections) {
    lines.push(`## ${s.name}`, '');
    for (const p of s.paragraphs) lines.push(p, '');
  }
  lines.push('## Fuentes', '');
  for (const f of sources) lines.push(`- [${f.id}] ${f.title} — ${f.url}`);
  return lines.join('\n');
}
