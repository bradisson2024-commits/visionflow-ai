// Analizador del video original. Sólo usa información a la que realmente tiene acceso y lo declara.
import * as gemini from '../services/gemini.js';
import { request } from '../core/http-client.js';
import { quoteFound } from './textkit.js';

export async function transcribe(video) {
  const r = await gemini.ask({
    youtubeUrl: `https://www.youtube.com/watch?v=${video.id}`, temperature: 0,
    system: 'Eres un transcriptor profesional. Transcribes literalmente lo que se oye. Nunca resumes ni inventas.',
    prompt: 'Transcribe literalmente toda la narración hablada de este video, en su idioma original, como texto corrido sin marcas de tiempo. Si no puedes acceder al video o no tiene voz, responde exactamente: NO_DISPONIBLE',
  });
  if (/^NO_DISPONIBLE/.test(r.text) || r.text.split(/\s+/).length < 40) throw new Error('Gemini no pudo acceder a la narración del video.');
  return r.text;
}

async function thumbnailReport(url) {
  try {
    const res = await request('Miniatura', 'descarga', url, {}, { attempts: 2, timeout: 20000 });
    const data = Buffer.from(await res.arrayBuffer()).toString('base64');
    const r = await gemini.ask({
      json: true, temperature: 0.2, images: [{ mime: res.headers.get('content-type') || 'image/jpeg', data }],
      prompt: 'Describe esta miniatura de YouTube sólo con lo que se ve. JSON: {"texto": string|null, "elementos": [string], "colores": [string], "emocion": string, "composicion": string, "gancho_visual": string}',
    });
    return { disponible: true, ...r.data };
  } catch (e) { return { disponible: false, motivo: e.message }; }
}

const FIELDS = {
  tema: 'Tema principal', gancho: 'Gancho inicial', problema: 'Problema que presenta', promesa: 'Promesa del video',
  estructura: 'Estructura narrativa', desarrollo: 'Desarrollo de la historia', curiosidad: 'Momentos que despiertan curiosidad',
  datos: 'Información y datos utilizados', conclusion: 'Conclusión',
};
export const ANALYSIS_FIELDS = FIELDS;

export async function analyze(video, transcript) {
  const meta = `Título: ${video.title}\nCanal: ${video.channel_title}\nPublicado: ${video.published_at}\nVistas: ${video.views}\nDuración: ${video.duration_sec} s\nDescripción:\n${(video.description || '').slice(0, 2500)}`;
  const thumbnail = video.thumbnail ? await thumbnailReport(video.thumbnail) : { disponible: false, motivo: 'El video no tiene miniatura pública.' };
  if (!transcript) {
    const r = await gemini.ask({
      json: true, temperature: 0.3,
      system: 'NO has visto ni escuchado este video. No describas su contenido. Sólo puedes hablar del tema que sugieren el título y la descripción, marcándolo como hipótesis.',
      prompt: `${meta}\n\nJSON: {"tema": string, "por_que_interesa": [string] (hipótesis), "mejoras_posibles": [string], "busquedas": [string] (4 búsquedas para investigar el tema)}`,
    });
    return {
      acceso: 'solo_metadatos',
      nota: 'Sin transcripción: el análisis de la narración no se hizo. Sólo hay hipótesis basadas en título, descripción y miniatura.',
      campos: Object.fromEntries(Object.keys(FIELDS).map((k) => [k, k === 'tema' ? { valor: r.data.tema, estado: 'hipotesis' } : { valor: null, estado: 'sin_acceso' }])),
      hipotesis: r.data.por_que_interesa || [], mejoras: r.data.mejoras_posibles || [], busquedas: r.data.busquedas || [], miniatura: thumbnail,
    };
  }
  const r = await gemini.ask({
    json: true, temperature: 0.2,
    system: 'Analizas guiones de videos virales. Usas sólo la transcripción. Cada respuesta incluye una cita literal de la transcripción como prueba. Si algo no aparece, valor null.',
    prompt: `${meta}\n\nTRANSCRIPCIÓN:\n"""${transcript.slice(0, 80000)}"""\n\nJSON con estas claves: ${Object.keys(FIELDS).join(', ')}, mejoras, busquedas.
Cada una de las 9 primeras: {"valor": string o [string], "cita": string (copia literal de 8 a 30 palabras de la transcripción)}.
"mejoras": [string] qué haría un video ORIGINAL sobre el mismo tema más completo y mejor contado.
"busquedas": [string] 4 búsquedas para verificar y ampliar los datos.`,
  });
  const campos = {};
  for (const k of Object.keys(FIELDS)) {
    const f = r.data[k];
    if (!f || f.valor == null || (Array.isArray(f.valor) && !f.valor.length)) { campos[k] = { valor: null, estado: 'no_aparece' }; continue; }
    campos[k] = { valor: f.valor, cita: f.cita || null, estado: f.cita && quoteFound(f.cita, transcript) ? 'verificado' : 'cita_no_encontrada' };
  }
  return { acceso: 'transcripcion', campos, mejoras: r.data.mejoras || [], busquedas: r.data.busquedas || [], miniatura: thumbnail,
    nota: 'Las cifras del video original no se dan por ciertas: se verifican en la investigación.' };
}
