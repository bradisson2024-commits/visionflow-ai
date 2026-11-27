// Pasos 1–3: analizar el guion, dividirlo en escenas y construir el storyboard.
//
// Para que la narración de cada escena sea EXACTAMENTE el texto del guion (y la voz
// quede sincronizada con las imágenes), el guion se divide localmente en frases
// numeradas y el modelo de lenguaje solo decide cómo agruparlas en escenas
// (rango de frases) y qué se ve en cada una. Así nunca se reescribe ni se pierde texto.
import { llm } from '../providers/llm.js';

const LANG_NAMES = { es: 'español', en: 'English', pt: 'português', fr: 'français', it: 'italiano', de: 'Deutsch' };

export function countWords(text) {
  return (text.trim().match(/\S+/g) || []).length;
}

/** Divide el guion en frases conservando el texto original. */
export function splitSentences(script) {
  const paragraphs = script.replace(/\r/g, '').split(/\n\s*\n+/).map(p => p.replace(/\s*\n\s*/g, ' ').trim()).filter(Boolean);
  const out = [];
  for (const para of paragraphs) {
    const parts = para.match(/[^.!?…]+(?:[.!?…]+["»”')\]]*|$)/g) || [para];
    for (let s of parts) {
      s = s.trim();
      if (!s) continue;
      // Frases muy largas se cortan en pausas naturales para no crear escenas eternas.
      if (countWords(s) > 45) {
        const chunks = s.split(/(?<=[,;:])\s+/);
        let cur = '';
        for (const c of chunks) {
          if (cur && countWords(cur + ' ' + c) > 35) { out.push(cur); cur = c; } else cur = cur ? cur + ' ' + c : c;
        }
        if (cur) out.push(cur);
      } else out.push(s);
    }
  }
  // Une fragmentos diminutos (p. ej. "Sí.") con la frase anterior.
  const merged = [];
  for (const s of out) {
    if (merged.length && countWords(s) < 3) merged[merged.length - 1] += ' ' + s;
    else merged.push(s);
  }
  return merged;
}

const SCENE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'characters', 'scenes'],
  properties: {
    summary: { type: 'string' },
    characters: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        required: ['key', 'name', 'description', 'role'],
        properties: {
          key: { type: 'string' },
          name: { type: 'string' },
          description: { type: 'string' },
          role: { type: 'string', enum: ['principal', 'secundario'] },
        },
      },
    },
    scenes: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        required: ['start', 'end', 'visual_description', 'characters', 'action', 'location', 'emotion', 'shot', 'camera', 'lighting', 'image_prompt'],
        properties: {
          start: { type: 'integer' },
          end: { type: 'integer' },
          visual_description: { type: 'string' },
          characters: { type: 'array', items: { type: 'string' } },
          action: { type: 'string' },
          location: { type: 'string' },
          emotion: { type: 'string' },
          shot: { type: 'string', enum: ['plano general', 'plano medio', 'primer plano', 'plano detalle', 'plano sobre el hombro', 'contrapicado', 'picado', 'plano cenital', 'plano aéreo'] },
          camera: { type: 'string', enum: ['zoom_in', 'zoom_out', 'pan_left', 'pan_right', 'pan_up', 'pan_down', 'static'] },
          lighting: { type: 'string' },
          image_prompt: { type: 'string' },
        },
      },
    },
  },
};

export async function analyzeScript({ title, script, style, savedCharacters = [], language = 'es', signal }) {
  const sentences = splitSentences(script);
  if (!sentences.length) throw new Error('El guion está vacío.');
  const numbered = sentences.map((s, i) => `[${i + 1}] ${s}`).join('\n');
  const known = savedCharacters.length
    ? savedCharacters.map(c => `- key "${c.key}": ${c.name} — ${c.description}`).join('\n')
    : '(ninguno)';

  const system = `Eres el director de storyboard de una herramienta que convierte guiones en videos narrados para YouTube.
Recibes el guion dividido en frases numeradas. Tu trabajo:
1. Entender el tema y la secuencia de acontecimientos.
2. Agrupar las frases en escenas consecutivas: cada escena es un rango [start, end] de frases (1-indexado, inclusivo). Los rangos deben cubrir TODAS las frases, en orden, sin huecos ni solapes: la primera escena empieza en 1, cada escena empieza en end+1 de la anterior y la última termina en la última frase.
3. Una escena cambia cuando cambia lo que se debe VER (acción, lugar, momento, idea). Ritmo de video narrado: normalmente 1–2 frases por escena (unos 5–12 segundos de voz); nunca más de 3 frases.
4. Para cada escena describe lo que se ve, y escribe "image_prompt" EN INGLÉS: una descripción visual concreta y específica de ESA escena (sujeto, acción, lugar, objetos, momento del día, clima, composición y encuadre, expresión facial). La imagen debe representar literalmente lo que dice la narración en ese momento: si habla de alguien caminando por una calle, se ve a esa persona caminando por esa calle; si habla de una habitación, se ve esa habitación; si es triste, la expresión y la atmósfera lo reflejan.
5. No describas el estilo artístico (se añade aparte) y no pidas texto, letreros legibles ni subtítulos dentro de la imagen.
6. Cada escena debe ser visualmente distinta de las demás: varía encuadres (plano general, medio, primer plano, detalle, contrapicado…), ángulos y composiciones; no repitas la misma imagen cambiando solo el fondo.
7. Personajes: identifica a cada personaje recurrente y dale una "key" corta en minúsculas (p. ej. "protagonista", "madre"). Su "description" (EN INGLÉS) es la ficha visual fija que se usará en TODAS sus escenas: género, edad aproximada, complexión, peinado/color de pelo, ropa con colores concretos, accesorios distintivos. Si hay personajes ya creados por el usuario, usa exactamente sus keys y no los dupliques. En cada escena lista en "characters" las keys de los personajes que aparecen. En "image_prompt" refiérete a ellos por su nombre.
8. "camera" es el movimiento de cámara sutil para el montaje (zoom_in para tensión o acercamiento emocional, zoom_out para revelar, pan para recorrer un lugar, static para momentos de calma).
9. Los campos descriptivos (visual_description, action, location, emotion, lighting, summary) en ${LANG_NAMES[language] || language}.`;

  const user = `Título del video: ${title || '(sin título)'}
Estilo visual elegido: ${style.name} — ${style.description || ''}

Personajes ya creados por el usuario:
${known}

Guion (${sentences.length} frases):
${numbered}`;

  const result = await llm({ system, user, schema: SCENE_SCHEMA, signal });
  return normalize(result, sentences, savedCharacters);
}

/** Valida y repara la cobertura de frases; garantiza que la narración sea el guion completo. */
function normalize(result, sentences, savedCharacters) {
  const n = sentences.length;
  const raw = (result.scenes || [])
    .map(s => ({ ...s, start: Math.max(1, Math.min(n, Number(s.start) || 1)), end: Math.max(1, Math.min(n, Number(s.end) || 1)) }))
    .filter(s => s.end >= s.start)
    .sort((a, b) => a.start - b.start);
  const scenes = [];
  let next = 1;
  for (const s of raw) {
    if (s.end < next) continue; // solapada por completo con la anterior
    s.start = next; // un hueco se incorpora a esta escena; un solape se recorta
    scenes.push(s);
    next = s.end + 1;
  }
  if (!scenes.length) throw new Error('El análisis no devolvió escenas.');
  if (next <= n) scenes[scenes.length - 1].end = n;

  const keys = new Map();
  for (const c of savedCharacters) keys.set(c.key, { ...c, saved: true });
  for (const c of result.characters || []) {
    const key = String(c.key || c.name || '').toLowerCase().trim();
    if (!key || keys.has(key)) continue;
    keys.set(key, { key, name: c.name || key, description: c.description || '', role: c.role === 'secundario' ? 'secundario' : 'principal', saved: false });
  }
  return {
    summary: result.summary || '',
    characters: [...keys.values()],
    scenes: scenes.map((s, i) => ({
      idx: i,
      narration: sentences.slice(s.start - 1, s.end).join(' '),
      visual_description: s.visual_description,
      characters: (s.characters || []).map(k => String(k).toLowerCase().trim()).filter(k => keys.has(k)),
      action: s.action,
      location: s.location,
      emotion: s.emotion,
      shot: s.shot,
      camera: s.camera,
      lighting: s.lighting,
      image_prompt: s.image_prompt,
    })),
  };
}

export async function writeScript({ title, idea, minutes = 3, tone = '', language = 'es', signal }) {
  const words = Math.round(minutes * 150);
  const system = `Eres guionista de videos narrados para YouTube. Escribes solo el texto que leerá el narrador: sin títulos, sin indicaciones de cámara, sin marcas de tiempo, sin listas, sin corchetes. Frases claras y visuales, ritmo de narración, gancho inicial fuerte y cierre memorable. Idioma: ${LANG_NAMES[language] || language}.`;
  const user = `Título: ${title || '(libre)'}
${idea ? `Idea / indicaciones: ${idea}\n` : ''}${tone ? `Tono: ${tone}\n` : ''}Extensión objetivo: unas ${words} palabras (~${minutes} min de narración).
Escribe el guion completo.`;
  return llm({ system, user, signal, maxTokens: 32000 });
}

export function estimateSeconds(text, speed = 1) {
  return Math.max(2, (countWords(text) / 150) * 60 / (Number(speed) || 1));
}

/** Prompt final de imagen de una escena: estilo fijo + escena + fichas de personaje + encuadre. */
export function buildScenePrompt({ styleText, scene, characters, aspect }) {
  const cast = characters.length
    ? 'Characters in this scene (keep their appearance EXACTLY as described and as in the reference images): ' +
      characters.map(c => `${c.name}: ${c.description}`).join(' | ') + '.'
    : 'No recurring characters in this shot.';
  return [
    styleText,
    `SCENE: ${scene.image_prompt}`,
    cast,
    scene.shot && `Framing: ${scene.shot}.`,
    scene.emotion && `Mood/emotion: ${scene.emotion}.`,
    scene.lighting && `Lighting: ${scene.lighting}.`,
    `Aspect ratio ${aspect}, cinematic composition, single coherent image. No text, no letters, no captions, no watermarks, no speech bubbles.`,
  ].filter(Boolean).join('\n');
}
