// Versión original mejorada: investigación con fuentes reales y propuesta propia para El Precio Oculto.
import * as gemini from '../services/gemini.js';
import { requestJson } from '../core/http-client.js';

async function wikipedia(query, lang) {
  const base = process.env.EPO_WIKI_BASE || `https://${lang}.wikipedia.org/w/api.php`;
  const h = { 'user-agent': 'PrecioOcultoViralFinder/1.0 (uso local)' };
  const s = await requestJson('Wikipedia', 'search', `${base}?${new URLSearchParams({ action: 'query', list: 'search', srsearch: query, srlimit: '2', format: 'json' })}`, { headers: h }, { attempts: 2, timeout: 20000 });
  const out = [];
  for (const hit of s.query?.search || []) {
    const p = await requestJson('Wikipedia', 'extract', `${base}?${new URLSearchParams({ action: 'query', prop: 'extracts|info', inprop: 'url', explaintext: '1', titles: hit.title, format: 'json', redirects: '1' })}`, { headers: h }, { attempts: 2, timeout: 20000 });
    const page = Object.values(p.query?.pages || {})[0];
    if (page?.extract) out.push({ title: `${page.title} (Wikipedia ${lang})`, url: page.fullurl, text: page.extract.slice(0, 7000), via: 'Wikipedia' });
  }
  return out;
}

export async function research(topic, queries, log) {
  const sources = [];
  const add = (s) => { if (s.url && !sources.some((x) => x.url === s.url)) sources.push({ n: sources.length + 1, ...s }); };
  const errors = [];
  // 1) Google Search a través de Gemini: notas con fuentes citadas reales.
  let notes = '';
  try {
    const r = await gemini.ask({
      search: true, temperature: 0.2,
      system: 'Eres documentalista. Sólo escribes datos que encuentres en esta búsqueda y siempre indicas de dónde salen.',
      prompt: `Investiga para un documental de YouTube: «${topic}». Búsquedas sugeridas: ${queries.join(' | ')}.
Reúne datos verificables (cifras con año), casos reales, cómo funciona el negocio o mecanismo, historia y curiosidades poco conocidas.
Escribe notas en viñetas, cada una con el nombre del medio o institución que lo publica.`,
    });
    notes = r.text;
    for (const s of r.sources) add({ title: s.title, url: s.url, text: '', via: 'Google Search (Gemini)' });
    log?.(`Google Search: ${r.sources.length} fuentes.`);
  } catch (e) { errors.push(e.message); }
  // 2) Wikipedia (texto completo leído de verdad).
  for (const lang of ['es', 'en']) {
    try { for (const s of await wikipedia(queries[0] || topic, lang)) add(s); } catch (e) { errors.push(e.message); }
  }
  log?.(`Fuentes totales: ${sources.length}.`);
  return { sources, notes, errors };
}

export function sourcesBlock(r, max = 40000) {
  let txt = r.notes ? `NOTAS DE BÚSQUEDA (Google Search):\n${r.notes.slice(0, 14000)}\n` : '';
  for (const s of r.sources) {
    const chunk = `\n[${s.n}] ${s.title} — ${s.url}${s.text ? `\n${s.text}` : ''}\n`;
    if (txt.length + chunk.length > max) break;
    txt += chunk;
  }
  return txt;
}

export async function propose(video, analysis, research) {
  const r = await gemini.ask({
    json: true, temperature: 0.7,
    system: `Eres el director creativo de EL PRECIO OCULTO, canal de YouTube en español latino que revela el negocio, el coste o el mecanismo escondido detrás de cosas cotidianas. Su presentador es un detective Stickman. Nunca copias otros videos: estudias por qué funcionaron y creas algo propio, mejor investigado y mejor contado.`,
    prompt: `VIDEO DE REFERENCIA: «${video.title}» (${video.channel_title}, ${video.views} vistas).
ANÁLISIS: ${JSON.stringify(analysis).slice(0, 7000)}

MATERIAL VERIFICABLE:
${sourcesBlock(research, 25000)}

Propón la versión de El Precio Oculto. JSON:
{"titulo": string (máx. 70 caracteres, intriga honesta),
 "titulos_alternativos": [string, string, string],
 "texto_miniatura": string (2–4 palabras),
 "angulo": string (qué aporta frente al original),
 "ganchos": [string, string, string] (3 ganchos de apertura distintos, 1–2 frases),
 "gancho_elegido": number (índice 0–2),
 "partes": [{"nombre": string, "objetivo": string, "puntos": [string], "fuentes": [number], "palabras": number}]}
Partes en orden: Gancho, Introducción directa, 3–5 bloques con revelaciones progresivas (cada uno termina con una pregunta que lleva al siguiente), Gran revelación, Conclusión memorable.
Las palabras deben sumar entre 1200 y 1500 (8–10 minutos de narración).`,
  });
  const d = r.data;
  if (!Array.isArray(d.partes) || d.partes.length < 4) throw new Error('La propuesta no tiene una estructura válida. Repite la etapa.');
  return d;
}
