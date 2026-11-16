// DOBLE DE PRUEBAS — imita las respuestas de YouTube Data API, Gemini y Wikipedia con su formato real,
// para comprobar sin claves que todos los módulos de la aplicación funcionan conectados.
// No forma parte de la aplicación y nunca se usa fuera de las pruebas.
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const TRANSCRIPT = 'Todos creen que el cine gana dinero con las entradas. Pero la verdad es otra. Cuando compras una entrada, gran parte del dinero vuelve al estudio de Hollywood. El cine se queda con muy poco durante las primeras semanas. Entonces, ¿de qué vive? De las palomitas. Un balde de palomitas cuesta centavos producirlo y se vende muy caro. Por eso las salas no te dejan entrar con comida de afuera. Y por eso las palomitas son el verdadero negocio del cine. La próxima vez que compres un combo, recuerda que estás pagando el alquiler de la sala. Así funciona el negocio oculto de las salas de cine en todo el mundo, y casi nadie lo sabe.';

export function startFakes() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'epo-fake-'));
  // Imagen distinta en cada llamada: varias figuras con posiciones y colores pseudoaleatorios.
  const colors = ['0xC8272D', '0x2F7D4B', '0x1F4E99', '0xD4A017', '0x6B2D8F', '0x0E7C86', '0xA0522D', '0x333333'];
  let seed = 7;
  const rnd = (n) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
  const makePng = (k) => {
    const f = path.join(dir, `img${k}.png`);
    const boxes = Array.from({ length: 5 }, () => `drawbox=x=${rnd(1100)}:y=${rnd(560)}:w=${120 + rnd(260)}:h=${100 + rnd(220)}:color=${colors[rnd(8)]}:t=fill`).join(',');
    execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=0xF5EDDC:s=1344x768', '-vf', boxes, '-frames:v', '1', f]);
    return fs.readFileSync(f);
  };
  const pngs = [makePng('thumb')];
  let imageCalls = 0;
  const calls = { search: 0, videos: 0, channels: 0, image: 0, tts: 0, text: 0, review: 0 };

  function pcm(text) {
    const words = text.split(/\s+/).length;
    const sec = Math.max(1, words / 2.6), rate = 24000;
    const buf = Buffer.alloc(Math.round(sec * rate) * 2);
    for (let i = 0; i < buf.length / 2; i++) { const t = i / rate; buf.writeInt16LE(Math.round(9000 * Math.sin(2 * Math.PI * 180 * t) * (0.6 + 0.4 * Math.sin(2 * Math.PI * 3 * t))), i * 2); }
    return buf.toString('base64');
  }

  const textReply = (text, extra = {}) => ({ candidates: [{ content: { parts: [{ text }] }, finishReason: 'STOP', ...extra }] });

  function gemini(body) {
    const cfg = body.generationConfig || {};
    const parts = body.contents?.[0]?.parts || [];
    const prompt = parts.map((p) => p.text || '').join('\n');
    const system = body.systemInstruction?.parts?.[0]?.text || '';
    if (cfg.responseModalities?.includes('IMAGE')) {
      calls.image++;
      return { candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: makePng(imageCalls++).toString('base64') } }] } }] };
    }
    if (cfg.responseModalities?.includes('AUDIO')) {
      calls.tts++;
      const text = prompt.split('\n\n').slice(1).join(' ');
      return { candidates: [{ content: { parts: [{ inlineData: { mimeType: 'audio/L16;codec=pcm;rate=24000', data: pcm(text) } }] } }] };
    }
    calls.text++;
    if (parts.some((p) => p.fileData)) return textReply(TRANSCRIPT);
    if (body.tools?.some((t) => t.google_search)) {
      return textReply('- El estudio se queda con la mayor parte de la taquilla en el estreno (The Hollywood Reporter).\n- Las palomitas tienen un margen superior al 80 % (Time).', {
        groundingMetadata: { groundingChunks: [{ web: { uri: 'https://www.hollywoodreporter.com/ejemplo-taquilla', title: 'hollywoodreporter.com' } }, { web: { uri: 'https://time.com/ejemplo-palomitas', title: 'time.com' } }] },
      });
    }
    if (/miniatura de YouTube/.test(prompt)) return textReply(JSON.stringify({ texto: 'EL SECRETO', elementos: ['palomitas'], colores: ['rojo'], emocion: 'sorpresa', composicion: 'primer plano', gancho_visual: 'flecha' }));
    if (/control de calidad/.test(system)) { calls.review++; return textReply(JSON.stringify({ se_ve: 'el detective señala un objeto', representa: true, estilo: true, mascota_correcta: true, puntuacion: 9, problemas: [], correccion: '' })); }
    if (/Analizas guiones/.test(system)) {
      const cita = 'Un balde de palomitas cuesta centavos producirlo y se vende muy caro';
      const f = (valor) => ({ valor, cita });
      return textReply(JSON.stringify({ tema: f('El negocio de las palomitas en el cine'), gancho: f('Todos creen que el cine gana con las entradas'), problema: f('El dinero de la entrada va al estudio'), promesa: f('Revelar de qué vive el cine'), estructura: f(['Mito', 'Revelación', 'Cierre']), desarrollo: f('Explica el reparto'), curiosidad: f(['¿de qué vive?']), datos: f(['Las palomitas cuestan centavos']), conclusion: f('Las palomitas son el negocio'), mejoras: ['Más datos'], busquedas: ['margen palomitas cine', 'reparto taquilla estudio'] }));
    }
    if (/director creativo/.test(system)) {
      return textReply(JSON.stringify({ titulo: 'El verdadero negocio del cine no son las películas', titulos_alternativos: ['A', 'B', 'C'], texto_miniatura: 'NO ES LA PELÍCULA', angulo: 'Explica el reparto de la taquilla con cifras verificadas', ganchos: ['¿Y si la película fuera la excusa?', 'B', 'C'], gancho_elegido: 0,
        partes: ['Gancho', 'Introducción directa', 'La taquilla', 'Las palomitas', 'Conclusión'].map((nombre) => ({ nombre, objetivo: 'contar', puntos: ['p'], fuentes: [1], palabras: 40 })) }));
    }
    if (/Escribe SOLO la parte/.test(prompt)) {
      const part = /la parte (\d+)/.exec(prompt)[1];
      return textReply(JSON.stringify({ parrafos: [`Entras al cine pensando en la película y en la historia que vas a ver. Pero el dueño de la sala piensa en otra cosa muy distinta. En el estreno, el estudio se queda con casi todo lo que pagas por tu entrada [1].`, `Por eso el negocio está en el mostrador y no en la pantalla. Un balde de palomitas deja un margen enorme a la sala, mayor que el de casi cualquier producto [2]. Y el combo grande vale 12 veces lo que cuesta.`] }));
    }
    if (/sin fuente válida/.test(prompt)) {
      const n = (prompt.match(/^\d+\. /gm) || []).length;
      return textReply(JSON.stringify({ arreglos: Array.from({ length: n }, (_, i) => ({ n: i + 1, texto: 'Y el combo grande vale mucho más de lo que cuesta hacerlo [2].' })) }));
    }
    if (/director de arte/.test(system)) {
      const ns = /n = ([\d, ]+)\./.exec(prompt)[1].split(',').map((x) => Number(x.trim()));
      return textReply(JSON.stringify({ escenas: ns.map((n) => ({ n, ve: `El detective investiga la escena ${n}`, prompt: `the detective mascot examines a cinema detail number ${n}`, efecto: n === 3 ? 'revelacion' : n % 2 ? 'transicion' : null })) }));
    }
    return textReply('{}');
  }

  const yt = {
    v1: { id: 'abcdefghijk', snippet: { title: 'El negocio secreto de las palomitas', description: 'Por qué el cine gana dinero', channelId: 'UC1', channelTitle: 'Canal Uno', publishedAt: new Date(Date.now() - 10 * 86400000).toISOString(), thumbnails: { high: { url: 'http://127.0.0.1:PORT/thumb.jpg' } } }, statistics: { viewCount: '900000', likeCount: '40000', commentCount: '3000' }, contentDetails: { duration: 'PT9M41S' } },
    v2: { id: 'bbbbbbbbbbb', snippet: { title: 'Cine en casa', description: '', channelId: 'UC2', channelTitle: 'Canal Dos', publishedAt: new Date(Date.now() - 25 * 86400000).toISOString(), thumbnails: {} }, statistics: { viewCount: '20000', likeCount: '300', commentCount: '10' }, contentDetails: { duration: 'PT12M' } },
  };

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks)) : null;
    const json = (o) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
    if (url.pathname === '/thumb.jpg') { res.writeHead(200, { 'content-type': 'image/png' }); return res.end(pngs[0]); }
    if (url.pathname.startsWith('/youtube/')) {
      if (!url.searchParams.get('key')) { res.writeHead(403); return res.end('{}'); }
      if (url.pathname.endsWith('/search')) { calls.search++; return json({ items: [{ id: { videoId: 'abcdefghijk' } }, { id: { videoId: 'bbbbbbbbbbb' } }], pageInfo: { totalResults: 2 } }); }
      if (url.pathname.endsWith('/videos')) { calls.videos++; const port = server.address().port; return json({ items: url.searchParams.get('id').split(',').map((id) => Object.values(yt).find((v) => v.id === id)).filter(Boolean).map((v) => JSON.parse(JSON.stringify(v).replace('PORT', port))) }); }
      if (url.pathname.endsWith('/channels')) { calls.channels++; return json({ items: [{ id: 'UC1', statistics: { subscriberCount: '50000' } }, { id: 'UC2', statistics: { subscriberCount: '400000' } }] }); }
    }
    if (url.pathname.startsWith('/gemini/')) {
      if (url.pathname.endsWith('/models')) return json({ models: ['gemini-2.5-flash', 'gemini-2.5-flash-image', 'gemini-2.5-flash-preview-tts'].map((n) => ({ name: `models/${n}` })) });
      return json(gemini(body));
    }
    if (url.pathname.startsWith('/wiki')) {
      if (url.searchParams.get('list') === 'search') return json({ query: { search: [{ title: 'Palomitas de maíz' }] } });
      return json({ query: { pages: { 1: { title: 'Palomitas de maíz', fullurl: 'https://es.wikipedia.org/wiki/Palomitas_de_ma%C3%ADz', extract: 'Las palomitas de maíz son un alimento barato de producir que los cines venden con un margen alto.' } } } });
    }
    res.writeHead(404); res.end('{}');
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => {
    const base = `http://127.0.0.1:${server.address().port}`;
    resolve({ server, calls, makePng, env: { EPO_YOUTUBE_BASE: `${base}/youtube/v3`, EPO_GEMINI_BASE: `${base}/gemini/v1beta`, EPO_WIKI_BASE: `${base}/wiki`, YOUTUBE_API_KEY: 'clave-de-prueba', GEMINI_API_KEY: 'clave-de-prueba' } });
  }));
}
