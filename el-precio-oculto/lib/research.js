// Investigación con fuentes verificables. Cada fuente tiene id (F1, F2…), título, URL y el extracto realmente leído.
import { config, llmProviderName } from './config.js';
import { fetchJson } from './http.js';
import { generate } from './llm.js';

const UA = { 'user-agent': 'ElPrecioOcultoViralFinder/1.13 (herramienta local de investigacion)' };

async function wikipediaSearch(lang, query, limit = 3) {
  const p = new URLSearchParams({ action: 'query', list: 'search', srsearch: query, srlimit: String(limit), format: 'json', origin: '*' });
  const r = await fetchJson(`Wikipedia ${lang}`, `https://${lang}.wikipedia.org/w/api.php?${p}`, { headers: UA }, { retries: 2 });
  return (r.query?.search || []).map((s) => s.title);
}

async function wikipediaExtract(lang, title) {
  const p = new URLSearchParams({ action: 'query', prop: 'extracts|info', inprop: 'url', explaintext: '1', exsectionformat: 'plain', titles: title, format: 'json', origin: '*', redirects: '1' });
  const r = await fetchJson(`Wikipedia ${lang}`, `https://${lang}.wikipedia.org/w/api.php?${p}`, { headers: UA }, { retries: 2 });
  const page = Object.values(r.query?.pages || {})[0];
  if (!page || page.missing !== undefined || !page.extract) return null;
  return { title: `${page.title} — Wikipedia (${lang})`, url: page.fullurl, excerpt: page.extract.slice(0, 9000), origin: 'Wikipedia' };
}

/**
 * @returns {Promise<{sources:object[], notes:string, errors:string[], searchQueries:string[]}>}
 */
export async function research({ topic, queries = [], log = () => {} }) {
  const sources = [];
  const errors = [];
  const seen = new Set();
  const add = (s) => {
    if (!s?.url || seen.has(s.url)) return;
    seen.add(s.url);
    sources.push({ id: `F${sources.length + 1}`, ...s });
  };
  const qs = [...new Set([topic, ...queries].filter(Boolean))].slice(0, 4);

  for (const lang of ['es', 'en']) {
    for (const q of qs) {
      try {
        const titles = await wikipediaSearch(lang, q, 2);
        for (const t of titles) add(await wikipediaExtract(lang, t));
      } catch (e) { errors.push(e.message); }
    }
  }
  log(`Wikipedia: ${sources.length} artículos leídos.`);

  // Búsqueda web real con fuentes citadas (sólo con proveedor que la soporte).
  let notes = '';
  const prov = llmProviderName();
  if (prov === 'gemini' || prov === 'anthropic') {
    try {
      const r = await generate({
        search: true,
        system: 'Eres un investigador riguroso. Sólo afirmas lo que encuentras en fuentes consultadas en esta búsqueda. Si un dato no está confirmado lo dices.',
        prompt: `Investiga a fondo este tema para un video documental de YouTube en español: «${topic}».
Busca: datos verificables con cifras y año, ejemplos reales, casos concretos, contexto histórico, explicaciones de cómo funciona el negocio o el fenómeno, y datos sorprendentes poco conocidos.
Devuelve notas en viñetas. Cada viñeta debe terminar con la URL exacta de la fuente entre corchetes. No incluyas nada sin fuente.`,
      });
      notes = r.text;
      for (const s of r.sources) add({ title: s.title, url: s.url, excerpt: '', origin: prov === 'gemini' ? 'Google Search (Gemini)' : 'Búsqueda web (Claude)' });
      log(`Búsqueda web: ${r.sources.length} fuentes citadas por ${prov}.`);
    } catch (e) { errors.push(e.message); }
  } else {
    log('Sin GEMINI_API_KEY ni ANTHROPIC_API_KEY: la investigación usa sólo Wikipedia.');
  }

  return { sources, notes, errors, searchQueries: qs, provider: prov, geminiConfigured: !!config.geminiKey };
}

/** Corpus que se entrega a la IA: sólo esto puede usarse como dato. */
export function corpusForPrompt(r, maxChars = 45000) {
  let out = '';
  for (const s of r.sources) {
    const chunk = `\n### [${s.id}] ${s.title}\nURL: ${s.url}\n${s.excerpt ? s.excerpt : '(fuente citada por la búsqueda web; ver notas)'}\n`;
    if (out.length + chunk.length > maxChars) break;
    out += chunk;
  }
  if (r.notes) out += `\n### NOTAS DE BÚSQUEDA WEB (cada dato lleva su URL)\n${r.notes.slice(0, 15000)}\n`;
  return out;
}
