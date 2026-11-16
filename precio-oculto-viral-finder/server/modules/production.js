// Producción de un proyecto: ejecuta las etapas en orden como trabajo de la cola.
// Una etapa que necesita algo del usuario (transcripción, imágenes de Flow, aprobar escenas) se detiene con «accion».
import fs from 'node:fs';
import crypto from 'node:crypto';
import { paths } from '../core/paths.js';
import { getSetting } from '../core/settings.js';
import { note } from '../core/bus.js';
import { registerJob, enqueue } from '../core/jobs.js';
import { run, tx } from '../db/index.js';
import { getProject, update, setStage, resetFrom, updateScene, STAGE_NAMES } from './projects.js';
import { analyze, transcribe } from './analyzer.js';
import { research, propose } from './improver.js';
import { writeScript, cutScenes, sameText, storyboard } from './scriptwriter.js';
import { geminiSceneImage, geminiThumbnail, sceneImagePath, thumbBasePath, fileHash } from './images.js';
import { reviewImage, nearDuplicates } from './review.js';
import { synthesize } from '../services/voices.js';
import { ffmpeg, duration } from '../services/ffmpeg.js';
import { buildTimeline, checkTimeline } from './timeline.js';
import { voiceTrack, bedTrack, renderMp4, thumbnail, mp3 } from './exporter.js';
import { verify } from './verify.js';
import { scenePrompt } from './mascot.js';

class NeedsAction extends Error {}
const sha = (t) => crypto.createHash('sha1').update(String(t)).digest('hex').slice(0, 12);

/** ¿La escena necesita una (nueva) imagen? */
export function imagePending(p, s) {
  const f = sceneImagePath(p.slug, s.n);
  if (!fs.existsSync(f)) return 'sin imagen';
  if (s.image_requested_at && fs.statSync(f).mtimeMs < Date.parse(s.image_requested_at)) return 'pedida de nuevo';
  if (s.review?.state === 'rechazada' && s.review.hash === fileHash(f)) return 'rechazada en la revisión';
  return null;
}

const STEP = {
  async analisis(p, log) {
    let transcript = p.transcript;
    if (!transcript) {
      try { transcript = await transcribe(p.video); update(p.id, { transcript, transcript_source: 'Gemini (procesó el video público de YouTube)' }); log(`Transcripción obtenida con Gemini: ${transcript.split(/\s+/).length} palabras.`); }
      catch (e) { log(`Sin transcripción: ${e.message} Puedes pegar una transcripción autorizada y repetir esta etapa.`, 'warn'); }
    }
    const a = await analyze(p.video, transcript);
    update(p.id, { analysis: a });
    return a.acceso === 'transcripcion' ? 'Análisis con la transcripción completa.' : 'Análisis limitado a título, descripción y miniatura (sin acceso a la narración).';
  },

  async propuesta(p, log) {
    const r = await research(p.analysis.campos.tema?.valor || p.video.title, p.analysis.busquedas || [p.video.title], log);
    for (const e of r.errors) log(e, 'warn');
    if (r.sources.length < 2) throw new Error(`Sólo se encontraron ${r.sources.length} fuentes verificables: no se escribe un guion sin fuentes. Revisa tu conexión y la clave de Gemini.`);
    const prop = await propose(p.video, p.analysis, r);
    update(p.id, { proposal: { ...prop, research: { sources: r.sources.map(({ text, ...s }) => ({ ...s, leido: !!text })), notes: r.notes, material: r } } });
    return `Propuesta «${prop.titulo}» con ${r.sources.length} fuentes.`;
  },

  async guion(p, log) {
    const s = await writeScript({ proposal: p.proposal, research: p.proposal.research.material, transcript: p.transcript, log });
    update(p.id, { script: s, title: s.title });
    return `${s.words} palabras (~${s.minutes} min), ${s.cited.length} fuentes citadas${s.copied != null ? `, ${(s.copied * 100).toFixed(1)} % de coincidencia literal con el original` : ''}.`;
  },

  async escenas(p, log) {
    const scenes = cutScenes(p.script.parts);
    if (!sameText(p.script.parts, scenes)) throw new Error('La división en escenas no reproduce el guion completo.');
    await storyboard(scenes, p.script.title, log);
    tx(() => {
      run('DELETE FROM scenes WHERE project_id = ?', p.id);
      for (const s of scenes) run('INSERT INTO scenes(project_id, n, part, narration, sources, visual, image_prompt, sfx) VALUES(?,?,?,?,?,?,?,?)', p.id, s.n, s.part, s.narration, JSON.stringify(s.sources), s.visual, s.image_prompt, s.sfx);
    });
    for (const f of fs.readdirSync(paths.project(p.slug, 'imagenes'))) fs.rmSync(paths.project(p.slug, 'imagenes', f), { force: true });
    return `${scenes.length} escenas, cada una con su narración y su imagen planificada.`;
  },

  async imagenes(p, log, job) {
    const engine = p.image_engine;
    if (engine === 'gemini') {
      let k = 0;
      for (const s of p.scenes) {
        k++;
        if (!imagePending(p, s)) continue;
        await geminiSceneImage(p.slug, s);
        updateScene(p.id, s.n, { image_file: sceneImagePath(p.slug, s.n), image_hash: fileHash(sceneImagePath(p.slug, s.n)), image_engine: 'gemini', image_requested_at: null, review: null });
        job.progress(k / p.scenes.length, `Imagen ${k}/${p.scenes.length}`);
        log(`Imagen de la escena ${s.n} generada con Gemini.`);
      }
      if (!fs.existsSync(thumbBasePath(p.slug))) { await geminiThumbnail(p.slug, p.script.title, p.proposal.texto_miniatura); log('Imagen de la miniatura generada.'); }
      return `${p.scenes.length} imágenes generadas con Gemini.`;
    }
    // Google Flow: se incorporan las imágenes recibidas y se comprueba qué falta.
    for (const s of p.scenes) {
      const f = sceneImagePath(p.slug, s.n);
      if (fs.existsSync(f) && fileHash(f) !== s.image_hash) updateScene(p.id, s.n, { image_file: f, image_hash: fileHash(f), image_engine: 'flow', review: null });
    }
    const fresh = getProject(p.id);
    const pending = fresh.scenes.filter((s) => imagePending(fresh, s)).map((s) => s.n);
    if (pending.length) throw new NeedsAction(`Esperando imágenes de Google Flow: faltan ${pending.length} de ${fresh.scenes.length} (escenas ${pending.slice(0, 25).join(', ')}${pending.length > 25 ? '…' : ''}). Abre Google Flow en Chrome, pulsa el icono «EPO · Conector Flow», elige este proyecto y pulsa ENVIAR A FLOW. Después vuelve a pulsar «Producir video».`);
    return `${fresh.scenes.length} imágenes recibidas de Google Flow.`;
  },

  async revision(p, log, job) {
    let k = 0;
    for (const s of p.scenes) {
      k++;
      const f = sceneImagePath(p.slug, s.n);
      const h = fileHash(f);
      if (s.review?.hash === h && ['aprobada', 'aprobada_manual', 'rechazada'].includes(s.review.state)) continue;
      const rv = { ...(await reviewImage(s, f)), hash: h };
      updateScene(p.id, s.n, { review: rv });
      job.progress(k / p.scenes.length, `Revisión ${k}/${p.scenes.length}`);
      log(`Escena ${s.n}: ${rv.state === 'aprobada' ? `aprobada (${rv.score}/10)` : `rechazada — ${rv.problems.join('; ')}`}.`, rv.state === 'aprobada' ? 'info' : 'warn');
      // Con Gemini se rehace automáticamente (hasta 2 veces) usando la corrección propuesta.
      if (rv.state === 'rechazada' && p.image_engine === 'gemini' && (s.review?.retries || 0) < 2) {
        const retried = { ...s, image_prompt: `${s.image_prompt}. ${rv.fix}` };
        await geminiSceneImage(p.slug, retried);
        const h2 = fileHash(f);
        const rv2 = { ...(await reviewImage(s, f)), hash: h2, retries: (s.review?.retries || 0) + 1 };
        updateScene(p.id, s.n, { image_hash: h2, review: rv2, image_prompt: retried.image_prompt });
        log(`Escena ${s.n}: imagen rehecha → ${rv2.state} (${rv2.score}/10).`, rv2.state === 'aprobada' ? 'info' : 'warn');
      } else if (rv.state === 'rechazada' && rv.fix) {
        updateScene(p.id, s.n, { image_prompt: `${s.image_prompt}. ${rv.fix}` });
      }
    }
    const after = getProject(p.id);
    const dups = await nearDuplicates(after.scenes.map((s) => ({ n: s.n, file: sceneImagePath(p.slug, s.n) })));
    for (const [a, b] of dups) {
      const s = after.scenes.find((x) => x.n === b);
      updateScene(p.id, b, { review: { ...(s.review || {}), state: 'rechazada', problems: [`Casi idéntica a la escena ${a}`], hash: fileHash(sceneImagePath(p.slug, b)) }, image_prompt: `${s.image_prompt}. Make it clearly different from the previous scene.` });
      log(`Escenas ${a} y ${b}: imágenes casi idénticas; la ${b} se debe rehacer.`, 'warn');
    }
    const bad = getProject(p.id).scenes.filter((s) => !['aprobada', 'aprobada_manual'].includes(s.review?.state)).map((s) => s.n);
    if (bad.length) throw new NeedsAction(`${bad.length} imagen(es) no representan bien su narración (escenas ${bad.join(', ')}). En el editor puedes rehacerlas${p.image_engine === 'flow' ? ' (vuelven a la cola de Flow con la corrección)' : ''} o aprobarlas a mano. Después pulsa «Producir video».`);
    return 'Todas las imágenes representan su narración.';
  },

  async voz(p, log, job) {
    let k = 0;
    for (const s of p.scenes) {
      k++;
      const h = sha(s.narration + getSetting('VOICE_ENGINE'));
      const base = paths.project(p.slug, 'audio', `escena_${String(s.n).padStart(3, '0')}`);
      if (s.audio_text_hash === h && s.audio_file && fs.existsSync(s.audio_file)) continue;
      const i = p.scenes.indexOf(s);
      const src = await synthesize(s.narration, base, { previous: p.scenes[i - 1]?.narration, next: p.scenes[i + 1]?.narration });
      const wav = `${base}.wav`;
      try {
        await ffmpeg(['-i', src.file, '-af', 'silenceremove=start_periods=1:start_threshold=-48dB,areverse,silenceremove=start_periods=1:start_threshold=-48dB,areverse,highpass=f=80,acompressor=threshold=-20dB:ratio=2.5', '-ar', '44100', '-ac', '1', wav]);
      } finally { fs.rmSync(src.file, { force: true }); }
      const sec = await duration(wav);
      const wps = s.narration.split(/\s+/).length / sec;
      if (wps > 4.8 || wps < 1.2) throw new Error(`La voz de la escena ${s.n} parece incompleta (${wps.toFixed(1)} palabras/s). Repite la etapa.`);
      updateScene(p.id, s.n, { audio_file: wav, audio_sec: sec, audio_text_hash: h });
      job.progress(k / p.scenes.length, `Voz ${k}/${p.scenes.length} (${src.engine})`);
      if (k % 5 === 0 || k === p.scenes.length) log(`Voz ${k}/${p.scenes.length} con ${src.engine} (${src.voice}).`);
    }
    const total = getProject(p.id).scenes.reduce((a, s) => a + s.audio_sec, 0);
    return `Narración de ${(total / 60).toFixed(1)} min generada.`;
  },

  async montaje(p, log, job) {
    const tl = buildTimeline(p.scenes);
    const errs = checkTimeline(tl);
    if (errs.length) throw new Error(errs.join(' '));
    const out = (f) => paths.project(p.slug, 'salida', f);
    const images = p.scenes.map((s) => sceneImagePath(p.slug, s.n));
    log(`Línea de tiempo: ${p.scenes.length} escenas, ${(tl.total / 60).toFixed(2)} min.`);
    await voiceTrack({ items: tl.items, wavs: p.scenes.map((s) => s.audio_file), total: tl.total, out: out('narracion.wav') });
    const bed = await bedTrack({ items: tl.items, total: tl.total, voice: out('narracion.wav'), workDir: paths.project(p.slug, 'audio'), out: paths.project(p.slug, 'audio', 'cama_musical.wav') });
    if (bed.musica.nota) log(bed.musica.nota, 'warn');
    log('Renderizando el MP4…');
    await renderMp4({ items: tl.items, images, total: tl.total, voice: out('narracion.wav'), bed: paths.project(p.slug, 'audio', 'cama_musical.wav'), out: out('video.mp4'), onProgress: (x) => job.progress(x, `Render ${Math.round(x * 100)} %`) });
    await mp3(out('narracion.wav'), out('narracion.mp3'));
    const th = fs.existsSync(thumbBasePath(p.slug)) ? thumbBasePath(p.slug) : images[0];
    await thumbnail({ image: th, text: p.proposal.texto_miniatura, out: out('miniatura.png') });
    writeTexts(p);
    update(p.id, { render: { timeline: tl, ...bed, at: new Date().toISOString() } });
    return `MP4 exportado (${(tl.total / 60).toFixed(2)} min).`;
  },

  async verificacion(p, log) {
    const out = (f) => paths.project(p.slug, 'salida', f);
    const v = await verify({ scenes: p.scenes, timeline: p.render.timeline, images: p.scenes.map((s) => sceneImagePath(p.slug, s.n)), voice: out('narracion.wav'), bed: paths.project(p.slug, 'audio', 'cama_musical.wav'), video: out('video.mp4'), targetMinutes: Number(getSetting('TARGET_MINUTES')) || 9 });
    update(p.id, { verification: v });
    for (const c of v.checks) log(`${c.ok ? '✔' : c.aviso ? '⚠' : '✘'} ${c.nombre}: ${c.detalle}`, c.ok ? 'info' : c.aviso ? 'warn' : 'error');
    if (!v.ok) throw new NeedsAction(`La verificación encontró problemas: ${v.checks.filter((c) => !c.ok && !c.aviso).map((c) => c.nombre).join('; ')}.`);
    update(p.id, { deliverables: deliverables(p) });
    return 'Verificación superada: el MP4 está listo.';
  },
};

function writeTexts(p) {
  const out = (f) => paths.project(p.slug, 'salida', f);
  const src = p.proposal.research.sources;
  const cited = src.filter((s) => p.script.cited.includes(s.n));
  const md = [`# ${p.script.title}`, '', `> ${p.proposal.angulo}`, ''];
  for (const part of p.script.parts) md.push(`## ${part.name}`, '', ...part.paragraphs.flatMap((x) => [x, '']));
  md.push('## Fuentes', '', ...src.map((s) => `${s.n}. ${s.title} — ${s.url}`));
  fs.writeFileSync(out('guion.md'), md.join('\n'));
  fs.writeFileSync(out('guion_por_escenas.md'), [`# ${p.script.title} — escenas`, '', ...p.scenes.flatMap((s) => [`## Escena ${s.n} · ${s.part}`, `Narración: ${s.narration}`, `Imagen: ${s.visual}`, `Audio: ${s.audio_sec?.toFixed(2)} s`, ''])].join('\n'));
  fs.writeFileSync(out('titulo.txt'), [p.script.title, '', 'Alternativas:', ...(p.proposal.titulos_alternativos || [])].join('\n'));
  fs.writeFileSync(out('descripcion.txt'), [p.proposal.angulo, '', 'En este video, El Precio Oculto investiga lo que no se ve a simple vista.', '', 'FUENTES:', ...(cited.length ? cited : src).map((s) => `• ${s.title}: ${s.url}`), '', 'Suscríbete a EL PRECIO OCULTO para descubrir el negocio escondido detrás de las cosas de todos los días.'].join('\n'));
  fs.writeFileSync(out('fuentes.md'), ['# Fuentes', '', ...src.map((s) => `${s.n}. [${s.title}](${s.url}) — ${s.via}`)].join('\n'));
}

function deliverables(p) {
  const list = ['video.mp4', 'guion.md', 'guion_por_escenas.md', 'narracion.mp3', 'narracion.wav', 'miniatura.png', 'titulo.txt', 'descripcion.txt', 'fuentes.md'];
  return list.filter((f) => fs.existsSync(paths.project(p.slug, 'salida', f))).map((f) => `salida/${f}`);
}

/** Trabajo de la cola: ejecuta desde `from` (o desde la primera etapa pendiente) hasta el final. */
registerJob('produccion', async ({ projectId, from, only }, job) => {
  let p = getProject(projectId);
  if (!p) throw new Error('Proyecto no encontrado');
  if (from) resetFrom(p.id, from);
  // Flow: si llegaron imágenes nuevas tras la etapa de imágenes, se vuelve a ella.
  if (!from && !only && p.image_engine === 'flow' && p.scenes.some((s) => imagePending(p, s) || (fs.existsSync(sceneImagePath(p.slug, s.n)) && fileHash(sceneImagePath(p.slug, s.n)) !== s.image_hash))) {
    const st = p.stages.find((s) => s.name === 'imagenes');
    if (st.state === 'hecho') resetFrom(p.id, 'imagenes');
  }
  p = getProject(projectId);
  const start = only || from || p.stages.find((s) => s.state !== 'hecho')?.name;
  if (!start) return 'El proyecto ya está terminado.';
  const names = only ? [only] : STAGE_NAMES.slice(STAGE_NAMES.indexOf(start));
  update(p.id, { status: 'en_produccion', last_error: null });
  for (const [i, name] of names.entries()) {
    p = getProject(projectId);
    setStage(p.id, name, 'en_curso');
    note(p.id, `▶ ${p.stages.find((s) => s.name === name).label}`);
    try {
      const msg = await STEP[name](p, (m, level) => note(p.id, m, level), { progress: (x, m) => job.progress((i + x) / names.length, m) });
      setStage(p.id, name, 'hecho', msg);
      note(p.id, `✔ ${msg}`);
    } catch (e) {
      const action = e instanceof NeedsAction;
      setStage(p.id, name, action ? 'accion' : 'error', e.message);
      update(p.id, { status: action ? 'necesita_accion' : 'error', last_error: e.message });
      note(p.id, e.message, action ? 'warn' : 'error');
      for (const later of STAGE_NAMES.slice(STAGE_NAMES.indexOf(name) + 1)) run(`UPDATE stages SET state = 'pendiente' WHERE project_id = ? AND name = ? AND state = 'hecho'`, p.id, later);
      if (action) return e.message;
      throw e;
    }
  }
  p = getProject(projectId);
  const finished = p.stages.every((s) => s.state === 'hecho') && p.verification?.ok && fs.existsSync(paths.project(p.slug, 'salida', 'video.mp4'));
  update(p.id, { status: finished ? 'terminado' : 'en_produccion' });
  return finished ? 'Video terminado y verificado.' : 'Etapa completada.';
});

export const startProduction = (projectId, opts = {}) => enqueue('produccion', { projectId, ...opts }, projectId);
export { scenePrompt };
