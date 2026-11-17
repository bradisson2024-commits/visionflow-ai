// IA de texto del generador: guion, mejora de idea, análisis de URL o de audio, división en escenas,
// biblia de continuidad, casting y prompts de imagen y animación.
import * as gemini from '../services/gemini.js';
import * as yt from '../services/youtube.js';
import { call } from '../core/http.js';
import { AppError } from '../core/errors.js';
import { templateInstructions, TEMPLATES } from './templates.js';

export const WPM = 150; // palabras por minuto de narración
export const words = (t) => String(t || '').trim().split(/\s+/).filter(Boolean).length;
const norm = (t) => String(t || '').replace(/\s+/g, ' ').trim();

export async function generateScript({ topic, template, minutes = 3, language = 'es', reference }) {
  const target = Math.round(minutes * WPM);
  const r = await gemini.ask({
    temperature: 0.8,
    system: `Eres guionista profesional de YouTube. Escribes narración para voz en off en ${language === 'es' ? 'español neutro' : language}: frases claras, ritmo ágil, gancho potente en las primeras dos frases, sin acotaciones, sin títulos, sin indicaciones de cámara. No inventas cifras precisas ni citas: si no estás seguro de un dato, lo formulas sin cifras.`,
    prompt: `${templateInstructions(template)}\nTEMA: ${topic}\nLONGITUD: unas ${target} palabras (${minutes} min).${reference ? `\n\nREFERENCIA ANALIZADA (inspírate en su estructura y en lo que la hizo funcionar; NO copies frases, datos dudosos ni su enfoque literal: crea un guion original):\n${JSON.stringify(reference).slice(0, 8000)}` : ''}\n\nDevuelve sólo el guion, en párrafos.`,
  });
  return r.text.replace(/^#+.*$/gm, '').replace(/\n{3,}/g, '\n\n').trim();
}

export async function improveIdea(idea, template) {
  const r = await gemini.ask({
    json: true, temperature: 0.7,
    system: 'Mejoras ideas de vídeos de YouTube sin cambiar su intención: las haces más concretas, intrigantes y fáciles de convertir en guion.',
    prompt: `Idea original: «${idea}»\n${template ? `Plantilla: ${TEMPLATES[template]?.name}` : ''}\nJSON: {"mejorada": string (una o dos frases, misma intención), "por_que": string}`,
  });
  return r.data;
}

/** Fuente compatible (modo «Desde URL»): YouTube (metadatos + Gemini analiza el vídeo público, sin descargarlo) o página web (texto legible). */
export async function analyzeUrl(url) {
  const vid = yt.parseVideoId(url);
  if (vid) {
    let meta = null;
    try { [meta] = await yt.videos([vid]); } catch (e) { meta = { error: e.message }; }
    const r = await gemini.ask({
      json: true, temperature: 0.3, youtubeUrl: `https://www.youtube.com/watch?v=${vid}`,
      system: 'Analizas vídeos de YouTube para aprender sus patrones (no para copiarlos). Sólo describes lo que realmente ves y oyes; si algo no está, null.',
      prompt: `Analiza este vídeo. JSON: {"tema": string, "gancho_inicial": string, "estructura": [string], "ritmo": string (cortes, duración de planos), "formato_visual": string, "duracion_aprox": string, "claves_rendimiento": [string], "idea_original_propuesta": string (una idea NUEVA y propia inspirada en el patrón, no una copia), "plantilla_sugerida": one of ${Object.keys(TEMPLATES).join('|')}}`,
    });
    return { kind: 'youtube', url, videoId: vid, metadata: meta, analysis: r.data, note: 'Gemini procesó el vídeo público desde YouTube; Cenit no descarga ni guarda su contenido.' };
  }
  let u;
  try { u = new URL(url); } catch { throw new AppError(400, 'URL no válida.'); }
  if (!/^https?:$/.test(u.protocol)) throw new AppError(400, 'Sólo URLs http(s).');
  const res = await call('Web', 'leer', url, { headers: { 'user-agent': 'CenitStudio/1.0 (+lectura para análisis)' } }, { raw: true, attempts: 2, timeout: 30000 });
  const type = res.headers.get('content-type') || '';
  if (!/text\/html|text\/plain/.test(type)) throw new AppError(400, `Fuente no compatible (${type || 'tipo desconocido'}). Usa una página web o un vídeo de YouTube.`);
  const html = await res.text();
  const text = html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 40000);
  if (text.split(' ').length < 80) throw new AppError(400, 'La página no tiene texto suficiente para analizar.');
  const r = await gemini.ask({
    json: true, temperature: 0.3,
    system: 'Analizas contenidos para extraer su estructura y lo que los hace interesantes, y propones una idea original propia.',
    prompt: `TEXTO DE ${url}:\n"""${text}"""\nJSON: {"tema": string, "gancho_inicial": string, "estructura": [string], "ritmo": string, "formato_visual": string, "duracion_aprox": string, "claves_rendimiento": [string], "idea_original_propuesta": string, "plantilla_sugerida": one of ${Object.keys(TEMPLATES).join('|')}}`,
  });
  return { kind: 'web', url, analysis: r.data, note: 'Se leyó el texto público de la página para analizar su estructura; no se copia.' };
}

/** Modo «Desde Audio»: transcripción con marcas de tiempo (Gemini escucha el archivo). */
export async function transcribeAudio(buffer, mime) {
  if (buffer.length > 19.5e6) throw new AppError(400, 'El audio supera 19 MB: comprímelo (por ejemplo MP3 a 96 kbps) e inténtalo de nuevo.');
  const r = await gemini.ask({
    json: true, temperature: 0, audio: { mime, data: buffer.toString('base64') },
    system: 'Eres un transcriptor exacto. Transcribes literalmente y das tiempos en segundos.',
    prompt: 'Transcribe esta narración por frases. JSON: {"idioma": string, "segmentos": [{"inicio": number, "fin": number, "texto": string}]}. Los tiempos son segundos desde el inicio, crecientes y sin solaparse.',
  });
  const segs = (r.data.segmentos || []).map((s) => ({ start: Number(s.inicio), end: Number(s.fin), text: norm(s.texto) })).filter((s) => s.text && s.end > s.start);
  if (!segs.length) throw new AppError(422, 'No se detectó narración en el audio.');
  return { language: r.data.idioma, segments: segs };
}

/** Biblia de continuidad: lo que debe mantenerse igual en todas las escenas. */
export async function storyBible(script, styleName) {
  const r = await gemini.ask({
    json: true, temperature: 0.4,
    system: 'Eres director de arte. Lees la historia completa antes de diseñar ninguna escena.',
    prompt: `ESTILO: ${styleName}\nGUION COMPLETO:\n"""${script.slice(0, 30000)}"""\nJSON: {"epoca": string, "lugares_recurrentes": [{"nombre": string, "descripcion": string}], "iluminacion": string, "paleta": string, "tono": string,
 "reparto": [{"tipo": "personaje"|"animal"|"objeto"|"escenario", "nombre": string, "papel": string, "descripcion_fisica": string, "vestimenta": string, "rasgos": string}]}
El reparto incluye sólo personajes, animales, objetos importantes y escenarios recurrentes que aparecen en el guion, con descripciones visuales concretas y FIJAS (color, forma, ropa).`,
  });
  return r.data;
}

/**
 * División en escenas: cada escena es una idea visual concreta del guion. El texto se conserva íntegro y en orden
 * (se comprueba); el número de escenas se orienta al ritmo elegido (segundos por imagen).
 */
export async function splitScenes({ script, seconds, bible, styleName, cast }) {
  const total = words(script);
  const target = Math.max(1, Math.round((total / WPM) * 60 / seconds));
  const castList = (cast || []).map((c) => `${c.name}: ${c.description}${c.wardrobe ? `, viste ${c.wardrobe}` : ''}`).join('\n');
  let last;
  for (let attempt = 0; attempt < 3; attempt++) {
    const r = await gemini.ask({
      json: true, temperature: 0.4, pro: attempt > 0,
      system: `Eres director de storyboard. Divides el guion en escenas por IDEAS VISUALES (no por número de palabras): una escena cambia cuando cambia lo que hay que mostrar. Copias el texto del guion EXACTO, sin cambiar ni omitir nada, en orden.`,
      prompt: `ESTILO: ${styleName}\nBIBLIA DE CONTINUIDAD: ${JSON.stringify(bible || {}).slice(0, 4000)}\nREPARTO FIJO:\n${castList || '(sin reparto)'}\n\nGUION:\n"""${script}"""\n
Divide en unas ${target} escenas (ritmo ~${seconds} s por imagen; puede variar si una idea visual lo exige).
JSON: {"escenas": [{"texto": string (fragmento literal del guion), "visual": string (qué se ve, en español), "prompt_imagen": string (en inglés, 40–90 palabras: sujeto, acción, entorno, encuadre, luz; nombra a los miembros del reparto que aparezcan por su nombre exacto), "prompt_animacion": string (en inglés: movimiento de personajes, objetos, cámara y entorno durante la escena), "reparto": [string] (nombres exactos del reparto que aparecen)}]}`,
    });
    const scenes = (r.data.escenas || []).map((s) => ({ narration: norm(s.texto), visual: s.visual, image_prompt: norm(s.prompt_imagen), anim_prompt: norm(s.prompt_animacion), cast: s.reparto || [] })).filter((s) => s.narration);
    if (norm(scenes.map((s) => s.narration).join(' ')) === norm(script)) return scenes;
    last = new Error('La división no reproducía el guion exacto.');
  }
  // Respaldo determinista: oraciones agrupadas hasta el ritmo elegido; la IA sólo describe lo visual.
  const sentences = norm(script).match(/[^.!?…]+[.!?…]+["»”]?|[^.!?…]+$/g).map((s) => s.trim());
  const per = Math.max(6, Math.round((WPM / 60) * seconds));
  const groups = [];
  let buf = [];
  for (const s of sentences) { buf.push(s); if (words(buf.join(' ')) >= per) { groups.push(buf.join(' ')); buf = []; } }
  if (buf.length) groups.push(buf.join(' '));
  const r = await gemini.ask({
    json: true, temperature: 0.4,
    system: 'Eres director de storyboard. Para cada fragmento describes una imagen que representa exactamente lo que dice, con continuidad.',
    prompt: `ESTILO: ${styleName}\nBIBLIA: ${JSON.stringify(bible || {}).slice(0, 3000)}\nREPARTO:\n${castList}\nFRAGMENTOS:\n${groups.map((g, i) => `${i + 1}. ${g}`).join('\n')}\nJSON: {"escenas": [{"n": number, "visual": string, "prompt_imagen": string, "prompt_animacion": string, "reparto": [string]}]} con exactamente ${groups.length} elementos.`,
  });
  const vis = r.data.escenas || [];
  if (vis.length !== groups.length) throw last;
  return groups.map((g, i) => ({ narration: g, visual: vis[i].visual, image_prompt: norm(vis[i].prompt_imagen), anim_prompt: norm(vis[i].prompt_animacion), cast: vis[i].reparto || [] }));
}

/** Escenas para el modo audio: frases agrupadas respetando sus tiempos reales. */
export function scenesFromSegments(segments, seconds) {
  const out = [];
  let cur = null;
  for (const s of segments) {
    if (!cur) cur = { start: s.start, end: s.end, text: s.text };
    else { cur.end = s.end; cur.text += ` ${s.text}`; }
    if (cur.end - cur.start >= seconds * 0.85) { out.push(cur); cur = null; }
  }
  if (cur) { if (out.length && cur.end - cur.start < seconds * 0.4) { const l = out[out.length - 1]; l.end = cur.end; l.text += ` ${cur.text}`; } else out.push(cur); }
  return out;
}
