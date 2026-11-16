// Orquestador del Módulo 13: «REPLICAR Y MEJORAR» → «GENERAR VIDEO COMPLETO».
// Cada paso deja su resultado en disco. Si un paso falla, el proyecto queda en «error» con el motivo; nunca se marca terminado
// sin que el MP4 exista y haya superado la verificación.
import fs from 'node:fs';
import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import { config, visionProviderName, imageProviderName } from './config.js';
import { STEPS, loadProject, saveProject, projectPath } from './project.js';
import { analyzeOriginal, transcribeWithGemini } from './analysis.js';
import { research } from './research.js';
import * as S from './script.js';
import { buildCharacters, planVisuals, fullPrompt, generateImageFile, generateCharacterSheet, STYLE, NEGATIVE } from './visuals.js';
import { reviewScene, findDuplicates, isApproved } from './coherence.js';
import { synthesizeScene, audioLooksComplete } from './tts.js';
import { computeTimeline, validateTimeline } from './timeline.js';
import { buildNarrationTrack, buildMusicBed, renderVideo, exportNarrationMp3, composeThumbnail } from './render.js';
import { verifyProject } from './verify.js';
import { generate } from './llm.js';

export const events = new EventEmitter();
events.setMaxListeners(100);

const running = new Map(); // id -> promise
export const isRunning = (id) => running.has(id);

export const imageFile = (p, s) => projectPath(p.id, 'imagenes', `${s.id}.png`);
export const wavFile = (p, s) => projectPath(p.id, 'audio', `${s.id}.wav`);
export const out = (p, name) => projectPath(p.id, 'salida', name);
const hash = (t) => crypto.createHash('sha1').update(String(t)).digest('hex').slice(0, 12);

function emit(p, type, data) { events.emit('event', { id: p.id, type, data, at: new Date().toISOString() }); }

function log(p, msg, level = 'info') {
  const entry = { at: new Date().toISOString(), level, msg };
  p.log.push(entry);
  if (p.log.length > 800) p.log = p.log.slice(-800);
  emit(p, 'log', entry);
}

function setStep(p, step, state, message = '') {
  p.steps[step] = { state, message, at: new Date().toISOString() };
  saveProject(p);
  emit(p, 'step', { step, state, message });
}

/** Marca como pendientes los pasos a partir de `step` (cuando algo anterior cambia). */
export function invalidateFrom(p, step) {
  const i = STEPS.indexOf(step);
  for (const s of STEPS.slice(i)) if (p.steps[s].state !== 'pendiente') p.steps[s] = { state: 'pendiente', message: 'Debe repetirse por un cambio anterior.' };
  if (i <= STEPS.indexOf('montaje')) { if (p.render) p.render.stale = true; p.verification = null; p.deliverables = null; }
  if (p.status === 'terminado') p.status = 'en_proceso';
}

// ======================================================================= pasos

const STEP_FN = {
  async datos(p) {
    if (!p.original?.title) throw new Error('No hay datos del video original.');
    const miss = p.original.unavailable?.length ? ` No disponible sin YOUTUBE_API_KEY: ${p.original.unavailable.join(', ')}.` : '';
    return `Datos de ${p.original.dataSource}.${miss}`;
  },

  async analisis(p) {
    if (!p.transcript && config.geminiKey) {
      log(p, 'Solicitando transcripción a Gemini (procesa el video público de YouTube)…');
      try { p.transcript = await transcribeWithGemini(p.original.url); log(p, `Transcripción obtenida: ${p.transcript.text.split(/\s+/).length} palabras.`); }
      catch (e) { log(p, `No se pudo transcribir con Gemini: ${e.message}`, 'warn'); }
    }
    if (!p.transcript) log(p, 'Sin transcripción: el análisis narrativo queda marcado «sin acceso». Puedes pegar una transcripción autorizada y repetir este paso.', 'warn');
    p.analysis = await analyzeOriginal({ video: p.original, transcript: p.transcript });
    return p.transcript ? `Análisis con transcripción (${p.analysis.provider}).` : 'Análisis limitado a metadatos (sin acceso a la narración).';
  },

  async investigacion(p) {
    const topic = p.analysis?.enfoque || p.original.title;
    const r = await research({ topic, queries: p.analysis?.consultas_investigacion || [], log: (m) => log(p, m) });
    for (const e of r.errors) log(p, `Investigación: ${e}`, 'warn');
    if (r.sources.length < 2) throw new Error(`Investigación insuficiente: sólo ${r.sources.length} fuente(s) verificable(s). Sin fuentes no se escribe el guion (para no inventar datos). Revisa la conexión a Wikipedia o añade GEMINI_API_KEY para buscar en Google.`);
    p.research = r;
    fs.writeFileSync(projectPath(p.id, 'salida', 'fuentes.md'), ['# Fuentes consultadas', '', ...r.sources.map((s) => `- [${s.id}] ${s.title} — ${s.url} (${s.origin})`)].join('\n'));
    return `${r.sources.length} fuentes reales.`;
  },

  async guion(p) {
    const lg = (m) => log(p, m);
    const outline = await S.buildOutline({ analysis: p.analysis, research: p.research, video: p.original, log: lg });
    let sections = await S.writeSections({ outline, research: p.research, log: lg });
    const ids = p.research.sources.map((s) => s.id);
    const [minM] = config.targetMinutes;
    sections = await S.expandIfShort({ sections, research: p.research, outline, minWords: Math.round(minM * S.WORDS_PER_MINUTE * 0.97), log: lg });
    for (let round = 0; round < 2; round++) {
      const fc = S.factCheck(sections, ids);
      const bad = [...new Set([...fc.unsupported, ...fc.badRefs.map((b) => b.sentence)])];
      if (!bad.length) break;
      log(p, `Verificación de datos (ronda ${round + 1}): ${bad.length} oraciones con datos sin fuente válida.`, 'warn');
      sections = await S.repairUnsupported({ sections, research: p.research, unsupported: bad, log: lg });
    }
    // Lo que siga sin fuente se elimina: no se narra ningún dato sin respaldo.
    const fc = S.factCheck(sections, ids);
    const drop = new Set([...fc.unsupported, ...fc.badRefs.map((b) => b.sentence)]);
    if (drop.size) {
      sections = sections.map((sec) => ({ ...sec, paragraphs: sec.paragraphs.map((pp) => S.splitSentences(pp).filter((s) => !drop.has(s)).join(' ')).filter(Boolean) }));
      log(p, `Se eliminaron ${drop.size} oraciones con datos que no se pudieron verificar.`, 'warn');
    }
    const narration = S.fullNarration(sections);
    const words = S.wordCount(narration);
    const overlap = S.overlapWithOriginal(narration, p.transcript?.text);
    if (overlap != null && overlap > 0.08) throw new Error(`El guion comparte un ${(overlap * 100).toFixed(1)} % de frases de 8 palabras con el original. Se exige un guion propio: repite el paso.`);
    const usedRefs = [...new Set(S.refsOf(narration))];

    const meta = await generate({
      json: true, temperature: 0.6,
      system: 'Eres experto en SEO de YouTube en español latino. Escribes con honestidad: sin prometer lo que el video no cuenta.',
      prompt: `Título: ${outline.title}\nGuion:\n${S.stripRefs(narration).slice(0, 9000)}\n\nDevuelve JSON {"description": string (3 párrafos breves que resumen el video sin destripar la revelación final, con una llamada a suscribirse a EL PRECIO OCULTO), "tags": [string] (10–15), "chapters_hint": [string]}`,
    });
    p.script = {
      title: outline.title, titleAlternatives: outline.title_alternatives || [], thumbnailText: outline.thumbnail_text || '',
      angle: outline.angle, sections, words, estimatedMinutes: +(words / S.WORDS_PER_MINUTE).toFixed(1),
      originalOverlap: overlap, usedSources: usedRefs, description: meta.data.description, tags: meta.data.tags || [],
      factCheck: { removedSentences: [...drop] },
    };
    fs.writeFileSync(out(p, 'guion.md'), S.scriptMarkdown(p.script, p.research.sources));
    fs.writeFileSync(out(p, 'guion_narracion.txt'), S.stripRefs(sections.map((s) => s.paragraphs.join('\n\n')).join('\n\n')));
    return `${words} palabras (~${p.script.estimatedMinutes} min), ${usedRefs.length} fuentes citadas${overlap != null ? `, coincidencia literal con el original ${(overlap * 100).toFixed(1)} %` : ''}.`;
  },

  async escenas(p) {
    const scenes = S.splitIntoScenes(p.script.sections);
    if (!S.scenesCoverScript(p.script.sections, scenes)) throw new Error('La división en escenas no reproduce el guion completo.');
    p.characters = await buildCharacters({ topic: p.script.title, script: S.stripRefs(S.fullNarration(p.script.sections)) });
    log(p, `Personajes: ${p.characters.map((c) => c.name).join(', ')}.`);
    await planVisuals({ scenes, characters: p.characters, title: p.script.title, log: (m) => log(p, m) });
    const seedBase = parseInt(hash(p.id).slice(0, 6), 16) % 900000;
    p.scenes = scenes.map((s) => ({ ...s, seed: seedBase + s.n * 7, image: null, review: null, audio: null, audioDuration: null }));
    for (const f of fs.readdirSync(projectPath(p.id, 'escenas'))) fs.rmSync(projectPath(p.id, 'escenas', f));
    writeSceneFiles(p);
    return `${p.scenes.length} escenas, cada una con su narración y su imagen planificada.`;
  },

  async imagenes(p, { force } = {}) {
    if (imageProviderName() === 'pollinations' && !config.pollinationsToken) log(p, 'Aviso: Pollinations sin token sólo usa el modelo «sana», que en pruebas no logra el estilo Stickman. Recomendado: GEMINI_API_KEY o POLLINATIONS_TOKEN. Las imágenes se revisarán igualmente antes del montaje.', 'warn');
    const sheet = projectPath(p.id, 'imagenes', 'personajes.png');
    if (!fs.existsSync(sheet) || force) {
      log(p, 'Generando hoja de personajes (referencia de consistencia)…');
      await generateCharacterSheet({ characters: p.characters, outFile: sheet, seed: p.scenes[0]?.seed || 1 });
    }
    const ref = fs.readFileSync(sheet);
    let done = 0;
    for (const s of p.scenes) {
      if (!force && s.image && fs.existsSync(imageFile(p, s)) && s.image.promptHash === hash(fullPrompt(s, p.characters, s.image.fix || ''))) { done++; continue; }
      await makeImage(p, s, { refImage: ref });
      done++;
      log(p, `Imagen ${done}/${p.scenes.length} (escena ${s.n}).`);
      saveProject(p);
    }
    const thumbBase = projectPath(p.id, 'imagenes', 'miniatura_base.png');
    if (!fs.existsSync(thumbBase) || force) {
      const tp = await generate({ json: true, temperature: 0.6, system: 'Diseñas miniaturas de YouTube muy llamativas con ilustraciones stickman.', prompt: `Título: ${p.script.title}\nTexto de la miniatura: ${p.script.thumbnailText}\nPersonaje principal: ${p.characters[0].description}\nDevuelve JSON {"prompt_en": string} con una escena (en inglés, 30–50 palabras) muy expresiva y fácil de leer en pequeño, con el personaje sorprendido descubriendo el secreto del tema; deja libre el tercio inferior para el texto.` });
      await generateImageFile({ prompt: `${tp.data.prompt_en}. Bold, high contrast, large simple shapes. Style: ${STYLE}. ${NEGATIVE}`, seed: (p.scenes[0]?.seed || 1) + 99991, outFile: thumbBase, refImage: ref });
      log(p, 'Imagen base de la miniatura generada.');
    }
    return `${p.scenes.length} imágenes generadas (${p.scenes[0]?.image?.provider}).`;
  },

  async coherencia(p) {
    const sheet = fs.readFileSync(projectPath(p.id, 'imagenes', 'personajes.png'));
    const vision = visionProviderName();
    for (const s of p.scenes) {
      if (isApproved(s) && s.review?.imageHash === s.image?.fileHash) continue;
      let attempts = 0;
      for (;;) {
        const rev = await reviewScene({ scene: s, imageFile: imageFile(p, s), characters: p.characters });
        s.review = { ...rev, imageHash: s.image.fileHash, attempts };
        if (rev.state !== 'corregir' || attempts >= 2) break;
        attempts++;
        log(p, `Escena ${s.n}: la imagen no representa bien la narración (${rev.problems.join('; ')}). Regenerando (${attempts}/2)…`, 'warn');
        s.image.fix = rev.fix;
        await makeImage(p, s, { refImage: sheet, reseed: true });
      }
      log(p, `Escena ${s.n}: ${labelReview(s.review)}.`, s.review.state === 'corregir' ? 'warn' : 'info');
      saveProject(p);
    }
    // Repeticiones innecesarias
    const dups = await findDuplicates(p.scenes, (s) => imageFile(p, s));
    for (const d of dups) {
      const s = p.scenes.find((x) => x.n === d.b);
      log(p, `Las escenas ${d.a} y ${d.b} tienen imágenes casi idénticas: se regenera la ${d.b}.`, 'warn');
      s.image.fix = `make it clearly different from the previous scene: ${s.visual.description}`;
      await makeImage(p, s, { refImage: sheet, reseed: true });
      s.review = vision ? { ...(await reviewScene({ scene: s, imageFile: imageFile(p, s), characters: p.characters })), imageHash: s.image.fileHash } : { state: 'revision_manual', reason: 'Imagen regenerada por repetición: revísala.' };
    }
    writeSceneFiles(p);
    const pending = p.scenes.filter((s) => !isApproved(s));
    if (pending.length) {
      const e = new Error(vision
        ? `${pending.length} escena(s) necesitan corrección: ${pending.map((s) => s.n).join(', ')}. Edita la descripción de la imagen o apruébala a mano en la pestaña Escenas.`
        : `Sin IA con visión, revisa y aprueba a mano las ${pending.length} imágenes en la pestaña Escenas (narración e imagen lado a lado). Luego pulsa «GENERAR VIDEO COMPLETO» para continuar.`);
      e.needsReview = true;
      throw e;
    }
    return `Todas las escenas aprobadas${dups.length ? `; ${dups.length} repeticiones corregidas` : ''}.`;
  },

  async voz(p) {
    let i = 0;
    for (const s of p.scenes) {
      i++;
      const h = hash(s.narration);
      if (s.audio?.textHash === h && fs.existsSync(wavFile(p, s))) continue;
      let res, lastErr;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          res = await synthesizeScene({ text: s.narration, outWav: wavFile(p, s), prev: p.scenes[i - 2]?.narration, next: p.scenes[i]?.narration });
          const c = audioLooksComplete(res);
          if (c.ok) break;
          lastErr = new Error(`Escena ${s.n}: ${c.reason}`); res = null;
        } catch (e) { lastErr = e; }
      }
      if (!res) throw lastErr;
      s.audio = { ...res, textHash: h, at: new Date().toISOString() };
      s.audioDuration = res.durationSec;
      if (i % 5 === 0 || i === p.scenes.length) log(p, `Voz ${i}/${p.scenes.length} (${res.provider}, ${res.voice}).`);
      saveProject(p);
    }
    const total = p.scenes.reduce((a, s) => a + s.audioDuration, 0);
    p.voice = { provider: p.scenes[0].audio.provider, voice: p.scenes[0].audio.voice, totalSec: +total.toFixed(2) };
    return `Narración real: ${(total / 60).toFixed(2)} min con ${p.voice.provider} (${p.voice.voice}).`;
  },

  async montaje(p) {
    const missing = p.scenes.filter((s) => !fs.existsSync(imageFile(p, s)) || !fs.existsSync(wavFile(p, s)));
    if (missing.length) throw new Error(`Faltan imágenes o audio en escenas: ${missing.map((s) => s.n).join(', ')}.`);
    const tl = computeTimeline(p.scenes);
    const errs = validateTimeline(tl);
    if (errs.length) throw new Error(errs.join(' '));
    const work = projectPath(p.id, 'audio');
    log(p, `Línea de tiempo: ${p.scenes.length} escenas, ${(tl.total / 60).toFixed(2)} min.`);
    log(p, 'Montando pista de narración…');
    await buildNarrationTrack({ scenes: p.scenes, timeline: tl, wavOf: (s) => wavFile(p, s), outFile: out(p, 'narracion.wav') });
    log(p, 'Mezclando música con ducking y efectos…');
    const bed = await buildMusicBed({ timeline: tl, narrationFile: out(p, 'narracion.wav'), workDir: work, seed: parseInt(hash(p.id).slice(0, 4), 16), outFile: projectPath(p.id, 'audio', 'cama_musical.wav') });
    if (bed.music.type === 'sintetizada') log(p, bed.music.note, 'warn');
    log(p, 'Renderizando MP4 con FFmpeg (puede tardar varios minutos)…');
    let lastPct = -1;
    await renderVideo({
      scenes: p.scenes, timeline: tl, imageOf: (s) => imageFile(p, s), narrationFile: out(p, 'narracion.wav'), bedFile: projectPath(p.id, 'audio', 'cama_musical.wav'), outFile: out(p, 'video.mp4'),
      onProgress: (chunk) => {
        const m = String(chunk).match(/time=(\d+):(\d+):([\d.]+)/);
        if (!m) return;
        const sec = +m[1] * 3600 + +m[2] * 60 + +m[3];
        const pct = Math.min(100, Math.floor((sec / tl.total) * 100));
        if (pct >= lastPct + 10) { lastPct = pct; log(p, `Render ${pct} %`); }
      },
    });
    await exportNarrationMp3(out(p, 'narracion.wav'), out(p, 'narracion.mp3'));
    const th = await composeThumbnail({ imageFile: projectPath(p.id, 'imagenes', 'miniatura_base.png'), text: p.script.thumbnailText, outFile: out(p, 'miniatura.png') });
    if (!th.text) log(p, `Miniatura sin texto: ${th.reason}.`, 'warn');
    p.render = { at: new Date().toISOString(), timeline: tl, music: bed.music, sfx: bed.sfx, stale: false };
    fs.writeFileSync(out(p, 'linea_de_tiempo.json'), JSON.stringify(tl, null, 2));
    writeDeliverableTexts(p);
    return `MP4 renderizado (${(tl.total / 60).toFixed(2)} min).`;
  },

  async verificacion(p) {
    const v = await verifyProject({
      p, timeline: p.render.timeline, imageOf: (s) => imageFile(p, s), wavOf: (s) => wavFile(p, s),
      files: { video: out(p, 'video.mp4'), narration: out(p, 'narracion.wav'), bed: projectPath(p.id, 'audio', 'cama_musical.wav') },
    });
    p.verification = v;
    for (const c of v.checks) log(p, `${c.ok ? '✔' : c.warning ? '⚠' : '✘'} ${c.label}: ${c.detail}`, c.ok ? 'info' : c.warning ? 'warn' : 'error');
    if (!v.passed) {
      const e = new Error(`La verificación falló: ${v.checks.filter((c) => !c.ok && !c.warning).map((c) => c.label).join('; ')}.`);
      e.needsReview = true;
      throw e;
    }
    p.deliverables = deliverablesList(p);
    return 'Todas las comprobaciones superadas. MP4 listo para descargar.';
  },
};

async function makeImage(p, s, { refImage, reseed } = {}) {
  if (reseed) s.seed += 101;
  const prompt = fullPrompt(s, p.characters, s.image?.fix || '');
  const r = await generateImageFile({ prompt, seed: s.seed, outFile: imageFile(p, s), refImage });
  const fileHash = crypto.createHash('sha1').update(fs.readFileSync(imageFile(p, s))).digest('hex').slice(0, 12);
  s.image = { provider: r.provider, prompt, promptHash: hash(prompt), fix: s.image?.fix || '', seed: s.seed, fileHash, at: new Date().toISOString() };
  s.review = null;
}

const labelReview = (r) => ({ aprobada_ia: `aprobada por IA (${r.score}/10)`, aprobada_manual: 'aprobada a mano', corregir: `marcada para corregir: ${(r.problems || []).join('; ')}`, revision_manual: 'pendiente de revisión manual' }[r?.state] || 'sin revisar');

function writeSceneFiles(p) {
  for (const s of p.scenes) {
    fs.writeFileSync(projectPath(p.id, 'escenas', `${s.id}.json`), JSON.stringify({
      escena: s.n, seccion: s.section, narracion: s.narration, narracion_con_fuentes: s.narrationWithRefs, fuentes: s.sources,
      imagen: { archivo: `imagenes/${s.id}.png`, que_se_ve: s.visual?.description, prompt: s.image?.prompt || null, personajes: s.visual?.characters },
      audio: { archivo: `audio/${s.id}.wav`, duracion_s: s.audioDuration },
      revision: s.review, efecto: s.sfx,
    }, null, 2));
  }
}

function writeDeliverableTexts(p) {
  const srcs = p.research.sources.filter((s) => p.script.usedSources.includes(s.id));
  const desc = `${p.script.description}\n\nFUENTES:\n${(srcs.length ? srcs : p.research.sources).map((s) => `• ${s.title}: ${s.url}`).join('\n')}\n\nIlustraciones y narración creadas para EL PRECIO OCULTO.`;
  fs.writeFileSync(out(p, 'titulo.txt'), [p.script.title, '', 'Alternativas:', ...p.script.titleAlternatives].join('\n'));
  fs.writeFileSync(out(p, 'descripcion.txt'), `${desc}\n\nEtiquetas: ${p.script.tags.join(', ')}\n`);
  // Guion por escenas (tras posibles ediciones en el editor de escenas)
  const lines = [`# ${p.script.title} — guion por escenas`, ''];
  for (const s of p.scenes) lines.push(`## Escena ${s.n} · ${s.section}`, `Narración: ${s.narrationWithRefs}`, `Imagen: ${s.visual?.description}`, `Duración: ${s.audioDuration?.toFixed(2)} s`, '');
  fs.writeFileSync(out(p, 'guion_por_escenas.md'), lines.join('\n'));
}

function deliverablesList(p) {
  const f = (rel) => ({ rel, exists: fs.existsSync(projectPath(p.id, rel)) });
  return {
    video: f('salida/video.mp4'), guion: f('salida/guion.md'), guionEscenas: f('salida/guion_por_escenas.md'), narracion: f('salida/narracion.mp3'),
    miniatura: f('salida/miniatura.png'), titulo: f('salida/titulo.txt'), descripcion: f('salida/descripcion.txt'), fuentes: f('salida/fuentes.md'),
    imagenes: p.scenes.map((s) => `imagenes/${s.id}.png`), escenas: p.scenes.map((s) => `escenas/${s.id}.json`),
  };
}

// ======================================================================= ejecución

/**
 * Ejecuta pasos. `from`: primer paso a (re)ejecutar; sin `from`, continúa desde el primer paso no completado.
 * `only`: ejecuta sólo ese paso.
 */
export function runPipeline(id, { from, only, force } = {}) {
  if (running.has(id)) throw new Error('Este proyecto ya se está procesando.');
  const job = (async () => {
    const p = loadProject(id);
    if (!p) throw new Error('Proyecto no encontrado');
    let steps = only ? [only] : STEPS.slice(STEPS.indexOf(from || STEPS.find((s) => p.steps[s].state !== 'completado') || 'verificacion'));
    if (from) invalidateFrom(p, from);
    if (!only && !from && STEPS.every((s) => p.steps[s].state === 'completado')) steps = [];
    p.status = 'en_proceso';
    saveProject(p);
    emit(p, 'project', { status: p.status });
    for (const step of steps) {
      setStep(p, step, 'en_curso');
      log(p, `▶ ${step}`);
      try {
        const msg = await STEP_FN[step](p, { force });
        setStep(p, step, 'completado', msg);
        log(p, `✔ ${step}: ${msg}`);
      } catch (e) {
        p.status = e.needsReview ? 'requiere_revision' : 'error';
        setStep(p, step, e.needsReview ? 'requiere_revision' : 'error', e.message);
        log(p, `✘ ${step}: ${e.message}`, 'error');
        // los pasos siguientes no pueden considerarse válidos
        for (const s of STEPS.slice(STEPS.indexOf(step) + 1)) if (p.steps[s].state === 'completado') p.steps[s] = { state: 'pendiente', message: '' };
        saveProject(p);
        emit(p, 'project', { status: p.status });
        return;
      }
    }
    const allDone = STEPS.every((s) => p.steps[s].state === 'completado');
    const mp4 = out(p, 'video.mp4');
    p.status = allDone && p.verification?.passed && fs.existsSync(mp4) && !p.render?.stale ? 'terminado' : 'en_proceso';
    saveProject(p);
    emit(p, 'project', { status: p.status });
  })().catch((e) => {
    const p = loadProject(id);
    if (p) { p.status = 'error'; log(p, `Error inesperado: ${e.message}`, 'error'); saveProject(p); emit(p, 'project', { status: p.status }); }
  }).finally(() => running.delete(id));
  running.set(id, job);
  return job;
}

// ======================================================================= acciones por escena

export async function sceneAction(id, n, action, body = {}) {
  if (running.has(id)) throw new Error('Espera a que termine el proceso en curso.');
  const p = loadProject(id);
  const s = p?.scenes.find((x) => x.n === Number(n));
  if (!s) throw new Error('Escena no encontrada');
  if (action === 'approve') {
    if (!fs.existsSync(imageFile(p, s))) throw new Error('La escena no tiene imagen.');
    s.review = { ...(s.review || {}), state: 'aprobada_manual', imageHash: s.image.fileHash, at: new Date().toISOString() };
    log(p, `Escena ${s.n}: aprobada a mano.`);
  } else if (action === 'reject') {
    s.review = { ...(s.review || {}), state: 'corregir', problems: [body.note || 'Marcada a mano para corregir'], at: new Date().toISOString() };
  } else if (action === 'regenerate-image') {
    if (body.description) s.visual.description = String(body.description);
    if (body.prompt) s.visual.prompt = String(body.prompt);
    s.image = s.image ? { ...s.image, fix: body.fix ?? s.image.fix } : null;
    const sheetFile = projectPath(p.id, 'imagenes', 'personajes.png');
    await makeImage(p, s, { refImage: fs.existsSync(sheetFile) ? fs.readFileSync(sheetFile) : null, reseed: true });
    if (visionProviderName()) s.review = { ...(await reviewScene({ scene: s, imageFile: imageFile(p, s), characters: p.characters })), imageHash: s.image.fileHash };
    else s.review = { state: 'revision_manual', reason: 'Imagen regenerada: revísala.' };
    log(p, `Escena ${s.n}: imagen regenerada (${labelReview(s.review)}).`);
    invalidateFrom(p, 'coherencia');
  } else if (action === 'narration') {
    const text = String(body.text || '').trim();
    if (!text) throw new Error('La narración no puede estar vacía.');
    s.narrationWithRefs = text;
    s.narration = S.stripRefs(text);
    s.audio = null; s.audioDuration = null;
    fs.rmSync(wavFile(p, s), { force: true });
    log(p, `Escena ${s.n}: narración editada; su voz se regenerará.`);
    invalidateFrom(p, 'voz');
  } else throw new Error('Acción no válida');
  if (action === 'approve' || action === 'reject') {
    invalidateFrom(p, 'coherencia');
  }
  writeSceneFiles(p);
  saveProject(p);
  emit(p, 'project', { status: p.status });
  return p;
}

export async function setTranscript(id, text, source) {
  const p = loadProject(id);
  if (!p) throw new Error('Proyecto no encontrado');
  const { cleanTranscript } = await import('./analysis.js');
  const clean = cleanTranscript(text);
  if (clean.split(/\s+/).length < 30) throw new Error('La transcripción es demasiado corta.');
  p.transcript = { text: clean, source: source || 'Transcripción aportada por el usuario (autorizada)' };
  invalidateFrom(p, 'analisis');
  saveProject(p);
  fs.writeFileSync(projectPath(p.id, 'salida', 'transcripcion_original.txt'), clean);
  return p;
}

export function publicProject(p) {
  const mp4 = out(p, 'video.mp4');
  return {
    ...p,
    running: running.has(p.id),
    canDownloadMp4: p.status === 'terminado' && !!p.verification?.passed && fs.existsSync(mp4) && !p.render?.stale,
    research: p.research ? { ...p.research, sources: p.research.sources.map(({ excerpt, ...s }) => ({ ...s, excerptChars: excerpt?.length || 0 })) } : null,
  };
}

