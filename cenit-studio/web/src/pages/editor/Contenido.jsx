import { useEffect, useState } from 'react';
import { api, fileUrl, useData } from '../../lib/api.js';
import { Action, Modal, Status, useToast } from '../../components/ui.jsx';
import { Finish } from './Finish.jsx';
import { FlowButton, PromptButton, AutoFlowButton, useFlowProgress } from '../../lib/flow.jsx';

const RHYTHM = [['rapido', 'Rápido', '≈ 4 s por imagen'], ['normal', 'Normal', '≈ 5 s por imagen'], ['lento', 'Lento', 'configurable']];
const KINDS = ['personaje', 'animal', 'objeto', 'escenario'];
const thumbClass = (f) => (f === '9:16' ? 'thumb v916' : f === '1:1' ? 'thumb v11' : 'thumb');

function Source({ p }) {
  if (p.mode === 'url') {
    const a = p.source?.analysis;
    return (
      <div className="card">
        <h3>Análisis de la fuente</h3>
        {!a ? <p className="muted">Analizando {p.source?.url}…</p> : (
          <>
            <p className="dim">{p.source.note}</p>
            <table className="t"><tbody>
              {[['Tema', a.tema], ['Gancho inicial', a.gancho_inicial], ['Estructura', (a.estructura || []).join(' → ')], ['Ritmo', a.ritmo], ['Formato visual', a.formato_visual], ['Duración', a.duracion_aprox], ['Por qué funciona', (a.claves_rendimiento || []).join(' · ')], ['Idea original propuesta', a.idea_original_propuesta]].map(([k, v]) => <tr key={k}><th>{k}</th><td>{v || '—'}</td></tr>)}
            </tbody></table>
          </>
        )}
      </div>
    );
  }
  if (p.mode === 'audio') {
    return (
      <div className="card">
        <h3>Narración subida</h3>
        {p.source?.audio && <audio controls src={fileUrl(p.source.audio)} style={{ width: '100%' }} />}
        <p className="dim">{p.source?.segments ? `${p.source.segments.length} frases transcritas con sus tiempos. El vídeo usará esta narración como voz.` : 'Transcribiendo…'}</p>
      </div>
    );
  }
  return null;
}

function Casting({ p, reload }) {
  const [edit, setEdit] = useState(null);
  const [zoom, setZoom] = useState(null);
  const toast = useToast();
  const save = async (c) => { await api(`/api/proyectos/${p.id}/reparto`, { method: 'POST', body: c }); setEdit(null); await reload(); };
  const upload = async (c, file) => { const fd = new FormData(); fd.append('file', file); try { await api(`/api/proyectos/${p.id}/reparto/${c.id}/subir`, { method: 'POST', form: fd }); await reload(); } catch (e) { toast(e.message, true); } };
  return (
    <div className="card">
      <div className="row between"><h2 style={{ margin: 0 }}>Casting y Referencias</h2><div className="row"><FlowButton />{p.cast.some((c) => !c.ref_path) && <AutoFlowButton p={p} charIds={p.cast.filter((c) => !c.ref_path).map((c) => c.id)}>Referencias en Flow (auto)</AutoFlowButton>}{p.cast.length > 0 && <PromptButton p={p} charIds={p.cast.map((c) => c.id)}>Prompts del reparto</PromptButton>}<button className="btn sm" onClick={() => setEdit({ kind: 'personaje', name: '', confirmed: true })}>＋ Añadir</button></div></div>
      <p className="dim">Se detectan automáticamente al dividir el guion. Confírmalos y añade una imagen de referencia: se usa como condicionamiento visual en todas las escenas donde aparecen, para que no cambien de aspecto.</p>
      {!p.cast.length && <p className="muted">Aún no hay reparto. Divide el guion en escenas o añade personajes a mano.</p>}
      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))' }}>
        {p.cast.map((c) => (
          <div className="cast" key={c.id}>
            <div className="ref" onClick={() => c.ref_path && setZoom(c)} title={c.ref_path ? 'Ver ampliada' : ''}>{c.ref_path ? <img src={fileUrl(c.ref_path)} alt={c.name} /> : 'Sin referencia'}</div>
            <div className="col" style={{ gap: 4 }}>
              <div className="row between"><b>{c.name}</b><span className={`pill ${c.confirmed ? 'ok' : 'warn'}`}>{c.confirmed ? 'Confirmado' : 'Detectado'}</span></div>
              <span className="dim">{c.kind}{c.role ? ` · ${c.role}` : ''}</span>
              <span style={{ fontSize: 13 }}>{c.description}</span>
              {c.wardrobe && <span className="dim">Vestimenta: {c.wardrobe}</span>}
              {c.traits && <span className="dim">Rasgos: {c.traits}</span>}
              <div className="row" style={{ marginTop: 4 }}>
                {!c.confirmed && <Action className="btn sm primary" run={() => save({ ...c, confirmed: true })}>Confirmar</Action>}
                <button className="btn sm" onClick={() => setEdit(c)}>Editar</button>
                <Action className="btn sm" busyText="Generando…" run={async () => { await api(`/api/proyectos/${p.id}/reparto/${c.id}/generar`, { method: 'POST' }); await reload(); return 'Referencia generada.'; }}>Generar referencia</Action>
                <FlowButton />
                <AutoFlowButton p={p} charIds={[c.id]} />
                <PromptButton p={p} charIds={[c.id]} />
                <label className="btn sm">Subir imagen<input type="file" accept="image/*" hidden onChange={(e) => e.target.files[0] && upload(c, e.target.files[0])} /></label>
                {c.ref_path && <Action className="btn sm" run={async () => { await api(`/api/proyectos/${p.id}/reparto/${c.id}/ampliar`, { method: 'POST' }); await reload(); return 'Referencia ampliada 2×.'; }}>Ampliar 2×</Action>}
                <Action className="btn sm danger" run={async () => { if (confirm(`¿Quitar a ${c.name}?`)) { await api(`/api/proyectos/${p.id}/reparto/${c.id}`, { method: 'DELETE' }); await reload(); } }}>Quitar</Action>
              </div>
            </div>
          </div>
        ))}
      </div>
      {edit && (
        <Modal title={edit.id ? `Editar ${edit.name}` : 'Nuevo miembro del reparto'} onClose={() => setEdit(null)}>
          <div className="col">
            <div className="grid-sm">
              <label className="f">Tipo<select value={edit.kind} onChange={(e) => setEdit({ ...edit, kind: e.target.value })}>{KINDS.map((k) => <option key={k}>{k}</option>)}</select></label>
              <label className="f">Nombre<input value={edit.name || ''} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></label>
              <label className="f">Papel en la historia<input value={edit.role || ''} onChange={(e) => setEdit({ ...edit, role: e.target.value })} /></label>
            </div>
            <label className="f">Descripción física<textarea rows={3} value={edit.description || ''} onChange={(e) => setEdit({ ...edit, description: e.target.value })} /></label>
            <label className="f">Vestimenta<input value={edit.wardrobe || ''} onChange={(e) => setEdit({ ...edit, wardrobe: e.target.value })} /></label>
            <label className="f">Características visuales<input value={edit.traits || ''} onChange={(e) => setEdit({ ...edit, traits: e.target.value })} /></label>
            <label className="row"><input type="checkbox" checked={!!edit.confirmed} onChange={(e) => setEdit({ ...edit, confirmed: e.target.checked })} /> Confirmado</label>
            <Action className="btn primary" run={() => save(edit)}>Guardar</Action>
          </div>
        </Modal>
      )}
      {zoom && <Modal wide title={zoom.name} onClose={() => setZoom(null)}><img src={fileUrl(zoom.ref_path)} alt={zoom.name} style={{ width: '100%', borderRadius: 12 }} /></Modal>}
    </div>
  );
}

function SceneCard({ p, s, reload, cast }) {
  const [img, setImg] = useState(false);
  const [anim, setAnim] = useState(false);
  const [form, setForm] = useState({});
  const toast = useToast();
  const scenePatch = (body) => api(`/api/proyectos/${p.id}/escenas/${s.id}`, { method: 'PATCH', body });
  const media = s.anim_status === 'lista' ? <video src={fileUrl(s.anim_path)} muted loop autoPlay playsInline /> : s.image_path ? <img src={fileUrl(s.image_path)} alt={`Escena ${s.idx}`} loading="lazy" /> : 'Sin imagen';
  return (
    <div className="scene">
      <div className="num">{s.idx}</div>
      <div className={thumbClass(p.format)} style={{ maxHeight: 220 }}>{media}</div>
      <div className="col" style={{ gap: 6 }}>
        <div>{s.narration}</div>
        <div className="dim">Debe verse: {s.visual}</div>
        <div className="row"><span className="dim">Imagen</span><Status s={s.image_status} />{s.anim_mode !== 'ninguna' && <><span className="dim">Animación ({s.anim_mode === 'veo' ? 'Veo' : 'cámara'})</span><Status s={s.anim_status} /></>}<span className="dim">Voz</span><Status s={s.audio_status} /></div>
        {s.image_error && <div className="alert bad" style={{ margin: 0 }}>Imagen: {s.image_error}</div>}
        {s.anim_error && <div className="alert bad" style={{ margin: 0 }}>Animación: {s.anim_error}</div>}
        {s.character_ids?.length > 0 && <div className="dim">Reparto: {cast.filter((c) => s.character_ids.includes(c.id)).map((c) => c.name).join(', ')}</div>}
      </div>
      <div className="acts">
        <button className="btn sm" onClick={() => { setForm({ image_prompt: s.image_prompt, visual: s.visual, character_ids: s.character_ids || [] }); setImg(true); }}>Prompt Img</button>
        <button className="btn sm" onClick={() => { setForm({ anim_prompt: s.anim_prompt, mode: s.anim_mode === 'ninguna' ? 'camara' : s.anim_mode }); setAnim(true); }}>Prompt anim</button>
        <Action className="btn sm primary" busyText="En cola…" run={async () => { await api(`/api/proyectos/${p.id}/imagenes`, { method: 'POST', body: { sceneIds: [s.id] } }); await reload(); }}>{s.image_status === 'error' ? 'Reintentar' : s.image_path ? 'Regenerar' : 'Generar'}</Action>
        <FlowButton />
        <AutoFlowButton p={p} sceneIds={[s.id]} />
        <PromptButton p={p} sceneIds={[s.id]} />
        <label className="btn sm" title="Sube una imagen hecha por ti (Google Flow, Gemini…). Se ajusta al formato del vídeo.">Subir imagen<input type="file" accept="image/*" hidden onChange={async (e) => {
          const f = e.target.files[0]; e.target.value = '';
          if (!f) return;
          const fd = new FormData(); fd.append('file', f);
          try { await api(`/api/proyectos/${p.id}/escenas/${s.id}/imagen`, { method: 'POST', form: fd }); await reload(); toast('Imagen subida.'); } catch (err) { toast(err.message, true); }
        }} /></label>
      </div>
      {img && (
        <Modal title={`Escena ${s.idx} · Prompt de imagen`} onClose={() => setImg(false)}>
          <div className="col">
            <div className="dim">Narración: «{s.narration}»</div>
            <label className="f">Qué debe verse<input value={form.visual || ''} onChange={(e) => setForm({ ...form, visual: e.target.value })} /></label>
            <label className="f">Prompt de imagen (el estilo «{p.style.name}», la continuidad y el reparto se añaden automáticamente)<textarea rows={6} value={form.image_prompt || ''} onChange={(e) => setForm({ ...form, image_prompt: e.target.value })} /></label>
            <div className="f"><span className="dim">Reparto en esta escena</span><div className="chips">{cast.map((c) => <button type="button" key={c.id} className={`chip ${form.character_ids.includes(c.id) ? 'on' : ''}`} onClick={() => setForm({ ...form, character_ids: form.character_ids.includes(c.id) ? form.character_ids.filter((x) => x !== c.id) : [...form.character_ids, c.id] })}>{c.name}</button>)}</div></div>
            <div className="row">
              <Action className="btn" run={async () => { await scenePatch(form); await reload(); setImg(false); return 'Prompt guardado.'; }}>Guardar</Action>
              <Action className="btn primary" run={async () => { await scenePatch(form); await api(`/api/proyectos/${p.id}/imagenes`, { method: 'POST', body: { sceneIds: [s.id] } }); await reload(); setImg(false); return 'Regenerando sólo esta imagen.'; }}>Guardar y regenerar esta imagen</Action>
            </div>
          </div>
        </Modal>
      )}
      {anim && (
        <Modal title={`Escena ${s.idx} · Prompt de animación`} onClose={() => setAnim(false)}>
          <div className="col">
            <label className="f">Instrucciones de movimiento (personajes, objetos, cámara y entorno)<textarea rows={5} value={form.anim_prompt || ''} onChange={(e) => setForm({ ...form, anim_prompt: e.target.value })} /></label>
            <div className="chips">
              <button type="button" className={`chip ${form.mode === 'veo' ? 'on' : ''}`} onClick={() => setForm({ ...form, mode: 'veo' })}>Animar con Veo (IA: personajes, objetos, cámara y entorno)</button>
              <button type="button" className={`chip ${form.mode === 'camara' ? 'on' : ''}`} onClick={() => setForm({ ...form, mode: 'camara' })}>Movimiento de cámara (gratis, FFmpeg: no anima personajes)</button>
            </div>
            {form.mode === 'veo' && <p className="dim">Consume créditos de Veo por segundo generado. Veo no ofrece 1:1: en formato cuadrado se recorta al centro.</p>}
            <div className="row">
              <Action className="btn" run={async () => { await scenePatch({ anim_prompt: form.anim_prompt }); await reload(); setAnim(false); return 'Guardado.'; }}>Guardar</Action>
              <Action className="btn primary" disabled={s.image_status !== 'lista'} run={async () => { await scenePatch({ anim_prompt: form.anim_prompt }); await api(`/api/proyectos/${p.id}/animar`, { method: 'POST', body: { sceneIds: [s.id], mode: form.mode } }); await reload(); setAnim(false); return 'Animación en cola.'; }}>Animar esta escena</Action>
              {s.anim_mode !== 'ninguna' && <Action className="btn ghost" run={async () => { await scenePatch({ anim_mode: 'ninguna' }); await reload(); setAnim(false); }}>Usar imagen fija</Action>}
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

export default function Contenido({ p, reload, patch, setTab }) {
  const { data: templates } = useData('/api/plantillas');
  const [idea, setIdea] = useState(p.idea || '');
  const [script, setScript] = useState(p.script || '');
  const [minutes, setMinutes] = useState(3);
  const [rhythm, setRhythm] = useState(p.rhythm);
  const [est, setEst] = useState(null);
  const toast = useToast();
  useFlowProgress(reload);
  useEffect(() => { setScript(p.script || ''); }, [p.script]);
  useEffect(() => { setIdea(p.idea || ''); }, [p.idea]);
  useEffect(() => { api(`/api/proyectos/${p.id}/estimacion?recalcular=1`).then(setEst).catch(() => {}); }, [p.id, p.script, p.rhythm.seconds]);
  const words = script.trim().split(/\s+/).filter(Boolean).length;
  const dirty = script !== (p.script || '');
  const splitting = p.jobs.some((j) => j.kind === 'proyecto.dividir' && ['en_cola', 'en_curso'].includes(j.status));
  const pendingImgs = p.scenes.filter((s) => s.image_status !== 'lista').length;
  const imgsRunning = p.scenes.filter((s) => ['en_cola', 'generando'].includes(s.image_status)).length;
  const done = p.scenes.filter((s) => s.image_status === 'lista').length;

  return (
    <>
      <Source p={p} />
      {p.mode !== 'audio' && (
        <div className="card">
          <h3>Plantillas rápidas</h3>
          <div className="chips" style={{ marginBottom: 14 }}>
            {templates && Object.entries(templates).map(([k, t]) => <button key={k} type="button" className={`chip ${p.template === k ? 'on' : ''}`} title={t.structure.join(' → ')} onClick={() => patch({ template: p.template === k ? null : k })}>{t.name}</button>)}
          </div>
          {p.template && templates && <p className="dim">Estructura: {templates[p.template].structure.join(' → ')}. Tono: {templates[p.template].tone}.</p>}
          <label className="f">Idea o palabra clave<textarea rows={2} value={idea} onChange={(e) => setIdea(e.target.value)} placeholder="¿Por qué el cangrejo de los cocoteros sabe a langosta?" /></label>
          <div className="row" style={{ marginTop: 10 }}>
            <label className="row dim">Duración<select value={minutes} onChange={(e) => setMinutes(Number(e.target.value))}>{[1, 2, 3, 5, 8, 10, 12].map((m) => <option key={m} value={m}>{m} min</option>)}</select></label>
            <Action className="btn primary" busyText="Escribiendo guion…" run={async () => { if (dirty && !confirm('Se reemplazará el guion actual. ¿Continuar?')) return; await api(`/api/proyectos/${p.id}/guion`, { method: 'POST', body: { topic: idea, minutes } }); await reload(); return 'Guion generado.'; }}>✨ Generar guion con IA</Action>
            <Action className="btn" busyText="Mejorando…" run={async () => { const r = await api(`/api/proyectos/${p.id}/mejorar-idea`, { method: 'POST', body: { idea } }); setIdea(r.mejorada); await patch({ idea: r.mejorada }); return r.por_que ? `Idea mejorada: ${r.por_que}` : 'Idea mejorada.'; }}>Mejorar idea</Action>
          </div>
        </div>
      )}
      <div className="card">
        <div className="row between"><h3 style={{ margin: 0 }}>Guion completo generado (editable)</h3><span className="dim">{script.length.toLocaleString('es')} caracteres · {words.toLocaleString('es')} palabras</span></div>
        <textarea rows={12} value={script} onChange={(e) => setScript(e.target.value)} placeholder="Genera el guion con IA o escríbelo aquí…" readOnly={p.mode === 'audio'} style={{ marginTop: 8 }} />
        {p.mode !== 'audio' && <div className="row" style={{ marginTop: 8 }}>
          <Action className="btn" disabled={!dirty} run={async () => { await patch({ script }); return 'Cambios guardados.'; }}>Guardar cambios</Action>
          <button className="btn ghost" disabled={!dirty} onClick={() => setScript(p.script || '')}>Descartar cambios</button>
          {dirty && <span className="pill warn">Sin guardar</span>}
        </div>}
      </div>
      <div className="card">
        <h3>Ritmo de cortes</h3>
        <div className="grid" style={{ gridTemplateColumns: 'repeat(3, minmax(0,1fr))' }}>
          {RHYTHM.map(([k, l, d]) => <button key={k} type="button" className={`choice ${rhythm.preset === k ? 'on' : ''}`} onClick={() => setRhythm({ preset: k, seconds: k === 'rapido' ? 4 : k === 'normal' ? 5 : rhythm.preset === 'lento' ? rhythm.seconds : 8 })}><b>{l}</b><div className="dim">{d}</div></button>)}
        </div>
        {rhythm.preset === 'lento' && <label className="f" style={{ marginTop: 10 }}>Segundos por imagen: {rhythm.seconds}<input type="range" min={5} max={20} value={rhythm.seconds} onChange={(e) => setRhythm({ ...rhythm, seconds: Number(e.target.value) })} /></label>}
        {(rhythm.preset !== p.rhythm.preset || rhythm.seconds !== p.rhythm.seconds) && <Action className="btn sm" run={() => patch({ rhythm })}>Aplicar ritmo</Action>}
        {est && <div className="stats" style={{ marginTop: 14 }}>
          <div className="stat"><div className="k">Escenas estimadas</div><div className="v">{est.scenes}</div></div>
          <div className="stat"><div className="k">Créditos de imágenes</div><div className="v">{est.imageCredits.toLocaleString('es')}</div></div>
          <div className="stat"><div className="k">Animar todas (Veo)</div><div className="v">+{est.animateAllCredits.toLocaleString('es')}</div><div className="n">opcional</div></div>
          <div className="stat"><div className="k">Voz</div><div className="v">{est.voiceCredits.toLocaleString('es')}</div></div>
        </div>}
        <div className="row">
          <Action className="btn primary" disabled={splitting || (p.mode !== 'audio' && words < 20) || dirty} busyText="Dividiendo guion en escenas…" run={async () => { if (p.scenes.length && !confirm('Se sustituirán las escenas actuales (imágenes y voces incluidas). ¿Continuar?')) return; await patch({ rhythm }); await api(`/api/proyectos/${p.id}/dividir`, { method: 'POST' }); await reload(); return 'Dividiendo guion en escenas…'; }}>{splitting ? 'Dividiendo guion en escenas…' : p.scenes.length ? 'Volver a dividir en escenas' : 'Dividir guion en escenas'}</Action>
          {dirty && <span className="dim">Guarda el guion antes de dividirlo.</span>}
        </div>
      </div>
      <Casting p={p} reload={reload} />
      <div className="card">
        <div className="row between">
          <h2 style={{ margin: 0 }}>Escenas ({p.scenes.length})</h2>
          <div className="row">
            <span className="dim">{done}/{p.scenes.length} imágenes</span>
            <FlowButton className="btn flow">Abrir Flow</FlowButton>
            <AutoFlowButton p={p} className="btn primary flow" disabled={!pendingImgs} sceneIds={p.scenes.filter((s) => s.image_status !== 'lista').map((s) => s.id)}>Crear todas en Flow (auto)</AutoFlowButton>
            <PromptButton p={p} className="btn" disabled={!pendingImgs} sceneIds={p.scenes.filter((s) => s.image_status !== 'lista').map((s) => s.id)}>Prompts en inglés (sin imagen)</PromptButton>
            <Action className="btn" disabled={!pendingImgs || imgsRunning > 0} busyText="En cola…" run={async () => { const r = await api(`/api/proyectos/${p.id}/imagenes`, { method: 'POST', body: {} }); await reload(); return `${r.queued} imágenes en cola.`; }}>Generar todas</Action>
            <Action className="btn" disabled={!p.scenes.some((s) => s.image_status === 'lista')} run={async () => { const ids = p.scenes.filter((s) => s.image_status === 'lista').map((s) => s.id); const mode = confirm('¿Animar todas con Veo (consume créditos)? Pulsa Cancelar para usar movimiento de cámara gratuito.') ? 'veo' : 'camara'; await api(`/api/proyectos/${p.id}/animar`, { method: 'POST', body: { sceneIds: ids, mode } }); await reload(); return 'Animaciones en cola.'; }}>Animar todas</Action>
          </div>
        </div>
        {p.scenes.length > 0 && <div className="bar" style={{ margin: '12px 0' }}><i style={{ width: `${(100 * done) / p.scenes.length}%` }} /></div>}
        {!p.scenes.length && <p className="muted">Divide el guion para crear las escenas. Cada escena tendrá su fragmento de narración y una imagen que lo representa.</p>}
        {p.scenes.map((s) => <SceneCard key={s.id} p={p} s={s} reload={reload} cast={p.cast} />)}
      </div>
      <Finish p={p} reload={reload} setTab={setTab} />
    </>
  );
}
