// DOBLES DE PRUEBAS de YouTube Data API v3 y Gemini API (mismos formatos de respuesta que los servicios reales)
// y de una página web. Sólo se usan en las pruebas; nunca en la aplicación.
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const DAY = 86400e3;
const iso = (msAgo) => new Date(Date.now() - msAgo).toISOString();

export async function startFakes() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cenit-fake-'));
  let n = 0;
  const png = () => {
    const f = path.join(dir, `i${n++}.png`);
    const boxes = Array.from({ length: 5 }, (_, k) => `drawbox=x=${(n * 97 + k * 211) % 900}:y=${(n * 53 + k * 131) % 500}:w=${120 + ((n + k) * 37) % 260}:h=${100 + ((n * 3 + k) * 29) % 200}:color=0x${((n * 2654435761 + k * 40503) >>> 8 & 0xffffff).toString(16).padStart(6, '0')}:t=fill`).join(',');
    execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=0x1A2440:s=1024x576', '-vf', boxes, '-frames:v', '1', f]);
    return fs.readFileSync(f);
  };
  const mp4 = path.join(dir, 'veo.mp4');
  execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=s=1280x720:r=24:d=4', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', mp4]);
  const calls = { search: 0, videos: 0, channels: 0, playlistItems: 0, image: 0, tts: 0, veo: 0, text: 0 };
  let growth = 0;

  // ------------------------------------------------------------------ YouTube
  const channels = {
    UCbig0000000000000000001: { title: 'Canal Grande', subs: 2000000, created: 9 * 365 * DAY, desc: 'Canal veterano.' },
    UCsmall00000000000000002: { title: 'Misterios Nuevos', subs: 2000, created: 20 * DAY, desc: 'Únete: https://www.youtube.com/channel/UCsmall00000000000000002/join' },
    UCmid000000000000000003a: { title: 'Ciencia Media', subs: 40000, created: 400 * DAY, desc: 'Ciencia para todos.' },
  };
  const videos = {
    vBigOld0001: { ch: 'UCbig0000000000000000001', title: 'El misterio del faro abandonado', views: 9000000, ago: 3 * 365 * DAY, dur: 'PT12M' },
    vBigNew0002: { ch: 'UCbig0000000000000000001', title: 'Misterio del barco fantasma', views: 300000, ago: 5 * DAY, dur: 'PT11M' },
    vSmallHit03: { ch: 'UCsmall00000000000000002', title: 'El misterio del faro que nadie explica', views: 300000, ago: 6 * DAY, dur: 'PT9M' },
    vSmallOld04: { ch: 'UCsmall00000000000000002', title: 'Primer vídeo del canal', views: 1200, ago: 18 * DAY, dur: 'PT8M' },
    vSmallShrt5: { ch: 'UCsmall00000000000000002', title: 'Misterio en 60 segundos', views: 4000, ago: 10 * DAY, dur: 'PT55S' },
    vMidHit0006: { ch: 'UCmid000000000000000003a', title: 'Misterio del faro: la ciencia lo explica', views: 260000, ago: 2 * DAY, dur: 'PT10M' },
    vMid0000007: { ch: 'UCmid000000000000000003a', title: 'Cómo funciona un faro', views: 15000, ago: 40 * DAY, dur: 'PT10M' },
    vMid0000008: { ch: 'UCmid000000000000000003a', title: 'Volcanes', views: 12000, ago: 70 * DAY, dur: 'PT10M' },
    vBig0000009: { ch: 'UCbig0000000000000000001', title: 'Vídeo normal', views: 600000, ago: 60 * DAY, dur: 'PT10M' },
    vBig0000010: { ch: 'UCbig0000000000000000001', title: 'Otro vídeo normal', views: 500000, ago: 90 * DAY, dur: 'PT10M' },
  };
  const videoItem = (id) => {
    const v = videos[id];
    const extra = id === 'vSmallHit03' ? growth * 5000 : 0;
    return { id, snippet: { channelId: v.ch, channelTitle: channels[v.ch].title, title: v.title, description: v.ch === 'UCsmall00000000000000002' ? 'Hazte miembro: https://www.youtube.com/channel/UCsmall00000000000000002/join' : '', publishedAt: iso(v.ago), thumbnails: { high: { url: `https://i.ytimg.com/vi/${id}/hqdefault.jpg` } }, defaultAudioLanguage: 'es' }, statistics: { viewCount: String(v.views + extra), likeCount: String(Math.round(v.views / 30)), commentCount: String(Math.round(v.views / 400)) }, contentDetails: { duration: v.dur }, paidProductPlacementDetails: { hasPaidProductPlacement: id === 'vMidHit0006' } };
  };

  function youtube(url, res) {
    if (!url.searchParams.get('key')) return send(res, 403, { error: { message: 'API key not valid' } });
    const r = url.pathname.split('/').pop();
    calls[r] = (calls[r] || 0) + 1;
    if (r === 'search') {
      if (url.searchParams.get('type') === 'channel') return send(res, 200, { items: [{ id: { channelId: 'UCsmall00000000000000002' } }] });
      const after = Date.parse(url.searchParams.get('publishedAfter') || 0);
      const ids = Object.entries(videos).filter(([, v]) => Date.now() - v.ago >= after).map(([id]) => id);
      return send(res, 200, { items: ids.map((id) => ({ id: { kind: 'youtube#video', videoId: id } })) });
    }
    if (r === 'videos') return send(res, 200, { items: url.searchParams.get('id').split(',').filter((id) => videos[id]).map(videoItem) });
    if (r === 'channels') {
      const ids = url.searchParams.get('forHandle') ? ['UCsmall00000000000000002'] : url.searchParams.get('id').split(',');
      return send(res, 200, { items: ids.filter((id) => channels[id]).map((id) => ({ id, snippet: { title: channels[id].title, description: channels[id].desc, customUrl: '@' + channels[id].title.replace(/\s/g, '').toLowerCase(), publishedAt: iso(channels[id].created), country: 'ES', thumbnails: { high: { url: 'https://yt3.ggpht.com/x' } } }, statistics: { subscriberCount: String(channels[id].subs), viewCount: String(Object.values(videos).filter((v) => v.ch === id).reduce((a, v) => a + v.views, 0)), videoCount: String(Object.values(videos).filter((v) => v.ch === id).length), hiddenSubscriberCount: false }, contentDetails: { relatedPlaylists: { uploads: `UU${id.slice(2)}` } } })) });
    }
    if (r === 'playlistItems') {
      const ch = `UC${url.searchParams.get('playlistId').slice(2)}`;
      return send(res, 200, { items: Object.entries(videos).filter(([, v]) => v.ch === ch).map(([id]) => ({ contentDetails: { videoId: id } })) });
    }
    return send(res, 404, {});
  }

  // ------------------------------------------------------------------ Gemini
  const text = (t, extra = {}) => ({ candidates: [{ content: { parts: [{ text: t }] }, finishReason: 'STOP', ...extra }] });
  const sentences = (t) => t.replace(/\s+/g, ' ').trim().match(/[^.!?…]+[.!?…]+["»”]?|[^.!?…]+$/g).map((s) => s.trim());
  const SCRIPT = 'Marta llegó al faro una noche de tormenta. Nadie había encendido aquella luz en cuarenta años. En la playa la esperaba un cangrejo enorme de los cocoteros. El cangrejo trepó por la escalera de caracol. Marta lo siguió con su linterna amarilla. Arriba encontró un viejo diario cubierto de sal. El diario hablaba de un barco que nunca llegó. La última página tenía un mapa dibujado a mano. Marta entendió por qué la luz se había apagado. Y decidió encenderla otra vez.';

  function gemini(model, body, res) {
    const sys = body.systemInstruction?.parts?.[0]?.text || '';
    const parts = body.contents?.[0]?.parts || [];
    const prompt = parts.map((p) => p.text || '').join('\n');
    const cfg = body.generationConfig || {};
    if (cfg.responseModalities?.includes('IMAGE') && /FALLA/.test(prompt)) return send(res, 400, { error: { message: 'contenido bloqueado por la política de seguridad' } });
    if (cfg.responseModalities?.includes('IMAGE')) { calls.image++; return send(res, 200, { candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: png().toString('base64') } }] } }] }); }
    if (cfg.responseModalities?.includes('AUDIO')) {
      calls.tts++;
      const words = prompt.split('\n\n').slice(-1)[0].split(/\s+/).length;
      const sec = Math.max(1, words / 2.6), rate = 24000, b = Buffer.alloc(Math.round(sec * rate) * 2);
      for (let i = 0; i < b.length / 2; i++) b.writeInt16LE(Math.round(8000 * Math.sin(2 * Math.PI * 170 * (i / rate)) * (0.6 + 0.4 * Math.sin(2 * Math.PI * 3 * (i / rate)))), i * 2);
      return send(res, 200, { candidates: [{ content: { parts: [{ inlineData: { mimeType: 'audio/L16;codec=pcm;rate=24000', data: b.toString('base64') } }] } }] });
    }
    calls.text++;
    if (/guionista profesional/.test(sys)) return send(res, 200, text(SCRIPT));
    if (/Mejoras ideas/.test(sys)) return send(res, 200, text(JSON.stringify({ mejorada: '¿Por qué el cangrejo de los cocoteros sabe a langosta? La respuesta está en lo que come.', por_que: 'más concreta' })));
    if (/Analizas vídeos de YouTube|Analizas contenidos/.test(sys)) return send(res, 200, text(JSON.stringify({ tema: 'Faros abandonados', gancho_inicial: 'Una luz que nadie enciende', estructura: ['misterio', 'pistas', 'revelación'], ritmo: 'cortes de 4–5 s', formato_visual: 'ilustración', duracion_aprox: '9 min', claves_rendimiento: ['misterio local', 'miniatura con luz'], idea_original_propuesta: 'La guardiana del faro y el diario perdido', plantilla_sugerida: 'misterio' })));
    if (/transcriptor exacto/.test(sys)) {
      const seg = [[0.2, 3.8, 'Marta llegó al faro una noche de tormenta.'], [4.0, 7.8, 'Nadie había encendido aquella luz en cuarenta años.'], [8.0, 11.8, 'Arriba encontró un viejo diario cubierto de sal.'], [12.0, 15.8, 'Y decidió encenderla otra vez.']];
      return send(res, 200, text(JSON.stringify({ idioma: 'es', segmentos: seg.map(([a, b, t]) => ({ inicio: a, fin: b, texto: t })) })));
    }
    if (/Lees la historia completa/.test(sys)) return send(res, 200, text(JSON.stringify({ epoca: 'actual', lugares_recurrentes: [{ nombre: 'Faro', descripcion: 'faro blanco y rojo en un acantilado' }], iluminacion: 'tormenta nocturna', paleta: 'azules y ámbar', tono: 'misterio',
      reparto: [{ tipo: 'personaje', nombre: 'Marta', papel: 'protagonista', descripcion_fisica: 'mujer de 30 años, pelo corto negro', vestimenta: 'impermeable amarillo', rasgos: 'linterna amarilla' }, { tipo: 'animal', nombre: 'Cangrejo', papel: 'guía', descripcion_fisica: 'cangrejo de los cocoteros azul enorme', vestimenta: '', rasgos: 'pinzas grandes' }] })));
    if (/Divides el guion en escenas/.test(sys)) {
      const script = /GUION:\n"""([\s\S]*?)"""/.exec(prompt)[1];
      const ss = sentences(script), out = [];
      for (let i = 0; i < ss.length; i += 2) {
        const t = ss.slice(i, i + 2).join(' ');
        out.push({ texto: t, visual: `Ilustra: ${t.slice(0, 40)}`, prompt_imagen: `scene showing ${t.slice(0, 60)}`, prompt_animacion: 'slow push-in, rain falling', reparto: ['Marta', 'Cangrejo'].filter((nm) => t.includes(nm) || (nm === 'Cangrejo' && /cangrejo/i.test(t))) });
      }
      return send(res, 200, text(JSON.stringify({ escenas: out })));
    }
    if (/describes una imagen/.test(sys)) {
      const frags = (prompt.split('FRAGMENTOS:\n')[1] || '').split('\nJSON:')[0].split('\n').filter((l) => /^\d+\. /.test(l)).map((l) => l.replace(/^\d+\. /, ''));
      return send(res, 200, text(JSON.stringify({ escenas: frags.map((t, i) => ({ n: i + 1, visual: `Ilustra: ${t.slice(0, 40)}`, prompt_imagen: `scene showing ${t.slice(0, 60)}`, prompt_animacion: 'slow push-in, rain falling', reparto: ['Marta', 'Cangrejo'].filter((nm) => t.includes(nm) || (nm === 'Cangrejo' && /cangrejo/i.test(t))) })) })));
    }
    return send(res, 200, text('{}'));
  }

  const send = (res, code, obj, type = 'application/json') => { res.writeHead(code, { 'content-type': type }); res.end(type === 'application/json' ? JSON.stringify(obj) : obj); };

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks)) : null;
    if (url.pathname.startsWith('/youtube/')) return youtube(url, res);
    if (url.pathname.startsWith('/gemini/')) {
      if (req.headers['x-goog-api-key'] !== 'clave-de-prueba') return send(res, 403, { error: { message: 'API key not valid' } });
      if (url.pathname.endsWith('/models')) return send(res, 200, { models: ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-2.5-flash-image', 'gemini-2.5-flash-preview-tts', 'veo-3.0-fast-generate-001'].map((m) => ({ name: `models/${m}` })) });
      if (url.pathname.endsWith(':predictLongRunning')) { calls.veo++; return send(res, 200, { name: 'models/veo-3.0-fast-generate-001/operations/op123' }); }
      if (url.pathname.includes('/operations/')) return send(res, 200, { name: 'op123', done: true, response: { generateVideoResponse: { generatedSamples: [{ video: { uri: `http://127.0.0.1:${server.address().port}/gemini/v1beta/files/veo:download?alt=media` } }] } } });
      if (url.pathname.includes('/files/')) return send(res, 200, fs.readFileSync(mp4), 'video/mp4');
      const m = /models\/([^:]+):generateContent/.exec(url.pathname);
      return gemini(m[1], body, res);
    }
    if (url.pathname === '/articulo') return send(res, 200, `<html><body><h1>El faro</h1><p>${'Historia de un faro abandonado en la costa y del misterio de su luz. '.repeat(20)}</p></body></html>`, 'text/html; charset=utf-8');
    send(res, 404, {});
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  return { server, calls, base, grow: () => { growth++; }, env: { YOUTUBE_API_BASE: `${base}/youtube/v3`, GEMINI_API_BASE: `${base}/gemini/v1beta`, YOUTUBE_API_KEY: 'clave-de-prueba', GEMINI_API_KEY: 'clave-de-prueba', VEO_POLL_MS: '50' } };
}
