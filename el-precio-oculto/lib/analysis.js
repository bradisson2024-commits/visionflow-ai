// Módulo 13 · Paso 2: análisis del video original. Nunca se finge haber visto o escuchado el video.
import { generate } from './llm.js';
import { config, visionProviderName } from './config.js';
import { fetchRetry } from './http.js';

/** Limpia transcripciones .srt/.vtt/.txt a texto corrido. */
export function cleanTranscript(raw) {
  return String(raw || '')
    .replace(/^﻿/, '')
    .replace(/^WEBVTT.*$/m, '')
    .split(/\r?\n/)
    .filter((l) => !/^\d+$/.test(l.trim()))
    .filter((l) => !/-->/.test(l))
    .filter((l) => !/^(NOTE|Kind:|Language:|STYLE)/.test(l.trim()))
    .map((l) => l.replace(/<[^>]+>/g, '').replace(/\[(?:música|music|aplausos|applause)\]/gi, '').trim())
    .filter(Boolean)
    .filter((l, i, a) => l !== a[i - 1])
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9ñ ]+/g, ' ').replace(/\s+/g, ' ').trim();

/** ¿La cita aparece realmente en la transcripción? (tolerante a puntuación/acentos) */
export function quoteInText(quote, text) {
  const q = norm(quote), t = norm(text);
  if (!q || q.length < 8) return false;
  if (t.includes(q)) return true;
  const words = q.split(' ');
  if (words.length < 6) return false;
  // Al menos un tramo de 6 palabras consecutivas presente
  for (let i = 0; i + 6 <= words.length; i++) if (t.includes(words.slice(i, i + 6).join(' '))) return true;
  return false;
}

/** Transcripción mediante Gemini, que procesa realmente el video público de YouTube. */
export async function transcribeWithGemini(videoUrl) {
  if (!config.geminiKey) throw new Error('Sin GEMINI_API_KEY no hay fuente de transcripción automática: pega o sube una transcripción autorizada.');
  const r = await generate({
    provider: 'gemini', youtubeUrl: videoUrl, temperature: 0,
    system: 'Eres un transcriptor. Transcribes literalmente lo que se oye. No resumes, no inventas. Si no hay narración, lo dices.',
    prompt: 'Transcribe literalmente toda la narración hablada de este video, en su idioma original, como texto corrido sin marcas de tiempo. Si el video no tiene voz, responde exactamente: SIN_NARRACION',
  });
  const text = r.text.trim();
  if (/^SIN_NARRACION/.test(text)) throw new Error('Gemini indica que el video no tiene narración hablada.');
  return { text, source: 'Gemini procesó el video público de YouTube (transcripción automática; puede contener errores)' };
}

async function analyzeThumbnail(url) {
  if (!visionProviderName()) return { estado: 'no_analizada', motivo: 'Falta un proveedor con visión (GEMINI_API_KEY o ANTHROPIC_API_KEY).' };
  try {
    const res = await fetchRetry('Miniatura', url, {}, { retries: 2 });
    const mime = res.headers.get('content-type')?.split(';')[0] || 'image/jpeg';
    const data = Buffer.from(await res.arrayBuffer()).toString('base64');
    const r = await generate({
      json: true, images: [{ mime, data }], temperature: 0.2,
      system: 'Analizas miniaturas de YouTube. Describes sólo lo que se ve.',
      prompt: 'Describe esta miniatura en JSON: {"texto_visible": string|null, "elementos": [string], "colores": [string], "emocion": string, "composicion": string, "por_que_genera_clic": string}',
    });
    return { estado: 'analizada', proveedor: r.provider, ...r.data };
  } catch (e) {
    return { estado: 'error', motivo: e.message };
  }
}

const FIELDS = ['tema', 'gancho', 'problema', 'promesa', 'estructura', 'desarrollo', 'momentos_curiosidad', 'datos_usados', 'conclusion'];

export async function analyzeOriginal({ video, transcript }) {
  const meta = `Título: ${video.title}
Canal: ${video.channelTitle}
Fecha de publicación: ${video.publishedAt || 'no disponible'}
Visualizaciones: ${video.views ?? 'no disponible'}
Duración (s): ${video.durationSec ?? 'no disponible'}
Descripción: ${video.description ? video.description.slice(0, 3000) : 'no disponible'}`;

  const thumbnail = await analyzeThumbnail(video.thumbnail);
  const access = transcript
    ? { nivel: 'transcripcion', detalle: transcript.source }
    : { nivel: 'solo_metadatos', detalle: 'No se tuvo acceso a la narración del video. Los campos narrativos no se analizan; sólo se formulan hipótesis a partir del título y la descripción.' };

  if (!transcript) {
    const r = await generate({
      json: true, temperature: 0.3,
      system: 'Eres estratega de YouTube. NO has visto el video. Nunca afirmes qué dice el video. Sólo formulas hipótesis marcadas como hipótesis, basadas en título, descripción y miniatura.',
      prompt: `${meta}

Devuelve JSON:
{"tema": string (tema según el título/descripción),
 "hipotesis_atractivo": [string] (por qué el TEMA despierta interés; hipótesis),
 "oportunidades_mejora": [string] (cómo un video original sobre el mismo tema podría aportar más valor),
 "consultas_investigacion": [string] (4 búsquedas concretas para investigar el tema),
 "tema_para_el_precio_oculto": string (enfoque propio para el canal EL PRECIO OCULTO: el coste o negocio oculto detrás de algo cotidiano)}`,
    });
    const d = r.data;
    return {
      access, thumbnail, provider: r.provider,
      fields: Object.fromEntries(FIELDS.map((f) => [f, f === 'tema' ? { valor: d.tema, estado: 'inferido_de_metadatos' } : { valor: null, estado: 'sin_acceso', motivo: 'Requiere la transcripción del video.' }])),
      hipotesis_atractivo: d.hipotesis_atractivo || [],
      oportunidades_mejora: d.oportunidades_mejora || [],
      consultas_investigacion: d.consultas_investigacion || [],
      enfoque: d.tema_para_el_precio_oculto || d.tema,
    };
  }

  const r = await generate({
    json: true, temperature: 0.2,
    system: 'Eres analista de guiones virales. Analizas SOLO la transcripción proporcionada. Cada afirmación sobre el video lleva una cita literal breve de la transcripción como evidencia. Si algo no aparece, pon null.',
    prompt: `${meta}

TRANSCRIPCIÓN (${transcript.source}):
"""${transcript.text.slice(0, 60000)}"""

Devuelve JSON con esta forma exacta. "evidencia" = cita literal (8–30 palabras) copiada de la transcripción:
{
 "tema": {"valor": string, "evidencia": string},
 "gancho": {"valor": string, "evidencia": string},
 "problema": {"valor": string, "evidencia": string},
 "promesa": {"valor": string, "evidencia": string},
 "estructura": {"valor": [string] (bloques en orden), "evidencia": string},
 "desarrollo": {"valor": string, "evidencia": string},
 "momentos_curiosidad": {"valor": [string], "evidencia": string},
 "datos_usados": {"valor": [string] (cifras y datos tal como se dicen, sin verificar), "evidencia": string},
 "conclusion": {"valor": string, "evidencia": string},
 "oportunidades_mejora": [string],
 "consultas_investigacion": [string] (4 búsquedas para verificar y ampliar),
 "tema_para_el_precio_oculto": string
}`,
  });
  const d = r.data;
  const fields = {};
  for (const f of FIELDS) {
    const item = d[f];
    if (!item || item.valor == null || (Array.isArray(item.valor) && !item.valor.length)) { fields[f] = { valor: null, estado: 'no_encontrado' }; continue; }
    const ok = quoteInText(item.evidencia, transcript.text);
    fields[f] = { valor: item.valor, evidencia: item.evidencia, estado: ok ? 'verificado_en_transcripcion' : 'evidencia_no_encontrada' };
  }
  return {
    access, thumbnail, provider: r.provider, fields,
    oportunidades_mejora: d.oportunidades_mejora || [],
    consultas_investigacion: d.consultas_investigacion || [],
    enfoque: d.tema_para_el_precio_oculto || fields.tema.valor,
    nota_datos: 'Los datos del video original se listan tal como se dicen; no se dan por ciertos: se verifican en la investigación.',
  };
}
