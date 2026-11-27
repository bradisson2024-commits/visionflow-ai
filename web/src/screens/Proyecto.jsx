import { useCallback, useEffect, useState } from 'react';
import {
  FileSearch, LayoutList, Users, Image as ImageIcon, Mic, Music, Clapperboard, Film, Check, X, Download, PencilLine, RefreshCw,
  Play, Square, AlertTriangle, ArrowLeft, Ban, ImageOff, Volume2, FolderOpen, CirclePlay,
} from 'lucide-react';
import { api, useEvents, fmtDuration, fmtDate } from '../api.js';
import { Spinner, StatusChip, Modal, useAction, Empty } from '../components/ui.jsx';

const STAGE_ORDER = [
  ['analyzing', 'Analizando guion', FileSearch],
  ['scenes', 'Creando escenas', LayoutList],
  ['characters', 'Personajes', Users],
  ['images', 'Generando imágenes', ImageIcon],
  ['voice', 'Preparando narración', Mic],
  ['music', 'Creando música', Music],
  ['montage', 'Montando video', Clapperboard],
  ['render', 'Renderizando', Film],
];

export default function Proyecto({ id, navigate }) {
  const [p, setP] = useState(null);
  const [err, setErr] = useState(null);
  const [job, setJob] = useState(null);
  const [busy, run] = useAction();
  const [editScene, setEditScene] = useState(null);
  const [showFiles, setShowFiles] = useState(false);

  const load = useCallback(async () => {
    try { const d = await api.get(`/projects/${id}`); setP(d); setJob(d.job); setErr(null); }
    catch (e) { setErr(e); }
  }, [id]);
  useEffect(() => { load(); }, [load]);

  // Progreso real: cada cambio del trabajo llega por SSE; al cambiar de etapa o terminar se recarga el proyecto.
  useEvents((type, data) => {
    if (type === 'job' && data.project_id === id) {
      setJob(prev => {
        const finished = !['queued', 'running'].includes(data.status);
        if (finished || prev?.stage !== data.stage || (data.stage === 'images' && prev?.done !== data.done)) load();
        return finished ? null : data;
      });
    }
    if (type === 'project' && data.id === id) load();
  });

  if (err) return <div className="page"><div className="alert"><AlertTriangle />{err.message}</div></div>;
  if (!p) return <div className="page"><Spinner /></div>;

  const generating = !!job;
  const act = (key, fn, ok) => run(key, async () => { const r = await fn(); await load(); return r; }, ok);
  const castByKey = Object.fromEntries(p.cast.map(c => [c.key, c]));

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <button className="btn ghost sm" style={{ padding: 0, marginBottom: 6 }} onClick={() => navigate('/biblioteca')}><ArrowLeft /> Biblioteca</button>
          <h1 className="page-title">{p.title} <StatusChip status={p.status} job={job} /></h1>
          <p className="page-sub">{p.style_name} · {p.words.toLocaleString('es-ES')} palabras · {p.scenes.length} escenas · creado {fmtDate(p.created_at)}</p>
        </div>
        <div className="row">
          <button className="btn" onClick={() => setShowFiles(true)}><FolderOpen /> Archivos</button>
          <button className="btn" disabled={generating} onClick={() => navigate(`/crear/${p.id}`)}><PencilLine /> Editar</button>
          {p.video_url && <a className="btn dark" href={`/api/projects/${p.id}/download`}><Download /> Descargar MP4</a>}
        </div>
      </div>

      {(generating || ['failed', 'canceled'].includes(p.status)) && <ProgressPanel job={job} project={p} onCancel={() => act('cancel', () => api.post(`/projects/${p.id}/cancel`))} onResume={() => act('resume', () => api.post(`/projects/${p.id}/generate`))} busy={busy} />}

      {p.status === 'storyboard' && !generating && (
        <div className="card section" style={{ borderColor: '#f3dc8c', background: 'var(--gold-soft)' }}>
          <div className="row">
            <LayoutList /> <div><b>Storyboard listo.</b> Revisa el orden y el contenido de las escenas; puedes editar cualquier escena antes de generar las imágenes.</div>
            <div className="spacer" />
            <button className="btn gold" disabled={!!busy} onClick={() => act('continue', () => api.post(`/projects/${p.id}/continue`))}>{busy === 'continue' ? <Spinner /> : <Play />} Generar imágenes y video</button>
          </div>
        </div>
      )}

      {p.status === 'outdated' && !generating && (
        <div className="alert warn" style={{ marginBottom: 16 }}>
          <AlertTriangle /><div style={{ flex: 1 }}>Hay cambios que aún no están en el video. Vuelve a renderizar para incluirlos (solo se generará lo que falte).</div>
          <button className="btn sm gold" disabled={!!busy} onClick={() => act('rerender', () => api.post(`/projects/${p.id}/generate`))}>{busy === 'rerender' ? <Spinner /> : <RefreshCw />} Volver a renderizar</button>
        </div>
      )}

      {p.video_url && (
        <div className="card section">
          <h2 className="section-title"><CirclePlay /> Video final <span className="right">{fmtDuration(p.duration)} · MP4</span></h2>
          <video className="player" src={p.video_url} controls preload="metadata" poster={p.thumbnail_url || undefined} />
        </div>
      )}

      {p.cast.length > 0 && (
        <div className="card section">
          <h2 className="section-title"><Users /> Personajes del video <span className="right">referencias en estilo {p.style_name}</span></h2>
          <div className="row" style={{ gap: 16, alignItems: 'flex-start' }}>
            {p.cast.map(c => (
              <div key={c.id} style={{ width: 150 }}>
                <div style={{ aspectRatio: '1', borderRadius: 10, background: '#efeee9', overflow: 'hidden', display: 'grid', placeItems: 'center' }}>
                  {c.ref_url ? <img src={c.ref_url} alt={c.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <Users color="#bbb" />}
                </div>
                <div style={{ fontWeight: 650, marginTop: 6 }}>{c.name} <span className="chip" style={{ fontSize: 10.5 }}>{c.role}</span></div>
                <div className="hint" style={{ fontSize: 11.5 }}>{c.description.slice(0, 120)}{c.description.length > 120 ? '…' : ''}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="card section">
        <h2 className="section-title"><LayoutList /> Storyboard <span className="right">{p.images}/{p.scenes.length} imágenes · duración estimada {fmtDuration(p.scenes.reduce((a, s) => a + (s.duration || s.est_duration || 0), 0))}</span></h2>
        {p.analysis?.summary && <p className="hint" style={{ marginTop: -4 }}>{p.analysis.summary}</p>}
        {!p.scenes.length ? (
          <Empty icon={LayoutList}>Aún no hay escenas. {!generating && <button className="btn sm" onClick={() => act('sb', () => api.post(`/projects/${p.id}/storyboard`))}>Crear storyboard</button>}</Empty>
        ) : (
          <div className="storyboard">
            {p.scenes.map(s => <SceneCard key={s.id} s={s} cast={castByKey} disabled={generating || !!busy} busy={busy}
              onEdit={() => setEditScene(s)}
              onImage={() => act('img' + s.id, () => api.post(`/projects/${p.id}/scenes/${s.id}/image`))}
              onAudio={() => act('aud' + s.id, () => api.post(`/projects/${p.id}/scenes/${s.id}/audio`))}
              narrationOn={p.narration.enabled} />)}
          </div>
        )}
      </div>

      {editScene && <SceneEditor scene={editScene} cast={p.cast} onClose={() => setEditScene(null)}
        onSave={body => act('save', async () => { await api.put(`/projects/${p.id}/scenes/${editScene.id}`, body); setEditScene(null); }, 'Escena guardada')} />}
      {showFiles && <FilesModal id={p.id} onClose={() => setShowFiles(false)} />}
    </div>
  );
}

function ProgressPanel({ job, project, onCancel, onResume, busy }) {
  const failed = !job && ['failed', 'canceled'].includes(project.status);
  const lj = job || project.last_job;
  const cur = lj?.stage;
  const curIdx = STAGE_ORDER.findIndex(s => s[0] === cur);
  const pct = lj ? Math.round((lj.progress || 0) * 100) : 0;
  return (
    <div className="card section">
      <h2 className="section-title">
        {failed ? <AlertTriangle color="var(--danger)" /> : <Spinner />}
        {failed ? (project.status === 'canceled' ? 'Generación cancelada' : 'La generación se detuvo') : (lj?.stage_label || 'En cola')}
        <span className="right">
          {!failed && lj?.total > 0 && <span>{lj.done}/{lj.total}</span>}
          {!failed && <span>{pct} %</span>}
          {job && <button className="btn sm danger" disabled={busy === 'cancel'} onClick={onCancel}><Ban /> Cancelar</button>}
          {failed && <button className="btn sm gold" disabled={busy === 'resume'} onClick={onResume}>{busy === 'resume' ? <Spinner /> : <RefreshCw />} Reanudar</button>}
        </span>
      </h2>
      <div className="stages">
        {STAGE_ORDER.map(([key, label, Icon], i) => {
          const state = failed ? (i < curIdx ? 'done' : '') : i < curIdx ? 'done' : i === curIdx ? 'current' : '';
          return <div key={key} className={`stage ${state}`}><div className="dot">{state === 'done' ? <Check /> : i === curIdx && failed ? <X color="var(--danger)" /> : <Icon />}</div>{label}</div>;
        })}
      </div>
      {!failed && <div className="progress"><div style={{ width: `${pct}%` }} /></div>}
      {!failed && lj?.message && <p className="hint" style={{ margin: '8px 0 0' }}>{lj.message}</p>}
      {failed && project.error && <div className="alert" style={{ marginTop: 8 }}><AlertTriangle /><div>{project.error}<div className="hint" style={{ color: 'inherit', opacity: .8 }}>Lo ya generado se conserva: al reanudar solo se hace lo que falta.</div></div></div>}
      {lj?.log?.length > 0 && <details style={{ marginTop: 10 }}><summary className="hint" style={{ cursor: 'pointer' }}>Registro</summary><div className="log">{lj.log.join('\n')}</div></details>}
    </div>
  );
}

function SceneCard({ s, cast, onEdit, onImage, onAudio, disabled, busy, narrationOn }) {
  const [playing, setPlaying] = useState(null);
  const play = () => {
    if (playing) { playing.pause(); setPlaying(null); return; }
    const a = new Audio(s.audio_url); a.onended = () => setPlaying(null); a.play(); setPlaying(a);
  };
  return (
    <div className="card scene">
      <div className="img">
        {s.image_url ? <img src={s.image_url} alt={`Escena ${s.idx + 1}`} loading="lazy" /> : s.image_error ? <div className="stack" style={{ alignItems: 'center', padding: 10, textAlign: 'center' }}><ImageOff /><span className="hint" style={{ color: 'var(--danger)' }}>{s.image_error.slice(0, 140)}</span></div> : <ImageIcon />}
        <span className="num">{s.idx + 1}</span>
        <span className="dur">{fmtDuration(s.duration || s.est_duration)}</span>
      </div>
      <div className="body">
        <div className="narr">{s.narration}</div>
        <div className="tags">
          {s.shot && <span className="chip">{s.shot}</span>}
          {s.emotion && <span className="chip">{s.emotion}</span>}
          {s.location && <span className="chip">{s.location}</span>}
          {s.characters.map(k => cast[k] && <span key={k} className="chip gold"><Users />{cast[k].name}</span>)}
        </div>
        <div className="acts">
          <button className="icon-btn" title="Editar escena" disabled={disabled} onClick={onEdit}><PencilLine /></button>
          <button className="icon-btn" title={s.image_url ? 'Regenerar imagen' : 'Generar imagen'} disabled={disabled} onClick={onImage}>{busy === 'img' + s.id ? <Spinner /> : <RefreshCw />}</button>
          {narrationOn && <button className="icon-btn" title="Regenerar narración de la escena" disabled={disabled} onClick={onAudio}>{busy === 'aud' + s.id ? <Spinner /> : <Volume2 />}</button>}
          {s.audio_url && <button className="icon-btn" title="Escuchar narración" onClick={play}>{playing ? <Square /> : <Play />}</button>}
        </div>
      </div>
    </div>
  );
}

function SceneEditor({ scene, cast, onClose, onSave }) {
  const [v, setV] = useState({ ...scene });
  const f = k => e => setV({ ...v, [k]: e.target.value });
  return (
    <Modal title={`Escena ${scene.idx + 1}`} onClose={onClose} width={820}>
      <div className="stack">
        <label className="field">Narración (texto que se leerá)<textarea className="textarea" value={v.narration} onChange={f('narration')} /></label>
        <label className="field">Descripción visual<textarea className="textarea" style={{ minHeight: 60 }} value={v.visual_description || ''} onChange={f('visual_description')} /></label>
        <label className="field">Prompt de imagen (inglés)<textarea className="textarea" value={v.image_prompt || ''} onChange={f('image_prompt')} /></label>
        <div className="grid3">
          <label className="field">Acción<input className="input" value={v.action || ''} onChange={f('action')} /></label>
          <label className="field">Lugar<input className="input" value={v.location || ''} onChange={f('location')} /></label>
          <label className="field">Emoción<input className="input" value={v.emotion || ''} onChange={f('emotion')} /></label>
          <label className="field">Encuadre<select className="select" value={v.shot || ''} onChange={f('shot')}>{['plano general', 'plano medio', 'primer plano', 'plano detalle', 'plano sobre el hombro', 'contrapicado', 'picado', 'plano cenital', 'plano aéreo'].map(o => <option key={o}>{o}</option>)}</select></label>
          <label className="field">Movimiento de cámara<select className="select" value={v.camera || 'zoom_in'} onChange={f('camera')}>
            {[['zoom_in', 'Acercar'], ['zoom_out', 'Alejar'], ['pan_left', 'Paneo izquierda'], ['pan_right', 'Paneo derecha'], ['pan_up', 'Paneo arriba'], ['pan_down', 'Paneo abajo'], ['static', 'Fijo']].map(([a, b]) => <option key={a} value={a}>{b}</option>)}
          </select></label>
          <label className="field">Iluminación<input className="input" value={v.lighting || ''} onChange={f('lighting')} /></label>
        </div>
        {cast.length > 0 && <div className="field"><span style={{ fontWeight: 550, fontSize: 13, color: 'var(--ink-2)' }}>Personajes en la escena</span>
          <div className="row">{cast.map(c => <button key={c.key} type="button" className={`btn sm ${v.characters.includes(c.key) ? 'gold' : ''}`} onClick={() => setV({ ...v, characters: v.characters.includes(c.key) ? v.characters.filter(k => k !== c.key) : [...v.characters, c.key] })}>{c.name}</button>)}</div></div>}
        <label className="row hint" style={{ gap: 6 }}><input type="checkbox" checked={!!v.clear_image} onChange={e => setV({ ...v, clear_image: e.target.checked })} /> Descartar la imagen actual (se generará una nueva al volver a renderizar)</label>
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button className="btn" onClick={onClose}>Cancelar</button>
          <button className="btn gold" onClick={() => onSave(v)}>Guardar escena</button>
        </div>
      </div>
    </Modal>
  );
}

function FilesModal({ id, onClose }) {
  const [files, setFiles] = useState(null);
  useEffect(() => { api.get(`/projects/${id}/files`).then(setFiles); }, [id]);
  return (
    <Modal title="Archivos del proyecto" onClose={onClose}>
      {!files ? <Spinner /> : !files.length ? <Empty icon={FolderOpen}>Aún no hay archivos.</Empty> : (
        <div className="card list" style={{ maxHeight: 460, overflow: 'auto' }}>
          {files.map(f => <div className="list-row" key={f.name}><span style={{ flex: 1 }} className="kbd">{f.name}</span><span className="hint">{(f.size / 1024 / 1024).toFixed(2)} MB</span><a className="btn sm" href={f.url} download>Descargar</a></div>)}
        </div>
      )}
    </Modal>
  );
}
