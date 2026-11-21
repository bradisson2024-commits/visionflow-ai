import { useEffect, useRef, useState } from 'react';
import { api, fileUrl } from '../../lib/api.js';
import { Action } from '../../components/ui.jsx';

const STEPS = [['contenido', 'Contenido'], ['voz', 'Voz'], ['subtitulos', 'Subtítulos'], ['musica', 'Música'], ['edicion', 'Edición'], ['mp4', 'MP4']];
const stepOf = (job) => (!job ? -1 : job.status === 'hecho' ? 6 : job.progress < 0.55 ? 1 : job.progress < 0.57 ? 2 : job.progress < 0.6 ? 3 : job.progress < 0.97 ? 4 : 5);

/** «Terminar vídeo»: pasa solo por Voz → Subtítulos → Música → Edición → MP4 y deja el vídeo listo para descargar. */
export function Finish({ p, reload, setTab, compact }) {
  const job = p.jobs.find((j) => j.kind === 'proyecto.producir');
  const active = job && ['en_cola', 'en_curso'].includes(job.status);
  const missing = p.scenes.filter((s) => s.image_status !== 'lista').length;
  const cur = stepOf(job);
  const [res, setRes] = useState('1080p');
  const prev = useRef(null);
  useEffect(() => { // sigue el avance en la pestaña correspondiente y abre Edición al terminar
    if (!job) return;
    const k = cur >= 6 ? 'edicion' : STEPS[Math.min(cur, 4)]?.[0];
    if (k && prev.current !== `${job.id}:${k}`) { if (prev.current !== null || active) setTab(k); prev.current = `${job.id}:${k}`; }
  }, [job?.id, cur]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!p.scenes.length) return null;
  if (compact && !job) return null; // arriba sólo aparece una vez pulsado el botón (en Contenido)
  return (
    <div className="card" style={{ borderColor: 'var(--accent, #34d399)' }}>
      <div className="row between" style={{ flexWrap: 'wrap', gap: 10 }}>
        <div>
          <h2 style={{ margin: 0 }}>{compact ? 'Terminando el vídeo' : 'Último paso: terminar el vídeo'}</h2>
          <div className="dim">Voz → Subtítulos → Música → Edición → MP4, sin tocar nada. Usa la voz y la música que hayas elegido; si no, una voz gratuita en español y una pista de la biblioteca.</div>
        </div>
        <div className="row">
          <label className="row dim">Calidad<select value={res} onChange={(e) => setRes(e.target.value)}>{['720p', '1080p', '1440p'].map((r) => <option key={r}>{r}</option>)}</select></label>
          <Action className="btn primary lg" disabled={active || missing > 0} busyText="Empezando…" title={missing ? `Faltan ${missing} imágenes` : ''} run={async () => { await api(`/api/proyectos/${p.id}/producir`, { method: 'POST', body: { resolution: res } }); await reload(); return 'Terminando el vídeo: voz, subtítulos, música y MP4…'; }}>{active ? 'Trabajando…' : '▶ Terminar vídeo'}</Action>
        </div>
      </div>
      {missing > 0 && <div className="alert warn" style={{ marginTop: 10 }}>Faltan {missing} imágenes de escena: créalas primero (por ejemplo con «Crear todas en Flow (auto)»).</div>}
      <div className="chips" style={{ marginTop: 12 }}>
        {STEPS.map(([k, l], i) => <span key={k} className={`pill ${cur > i || (i === 0 && !missing) ? 'ok' : cur === i ? 'run' : ''}`}>{cur > i || (i === 0 && !missing) ? '✓ ' : ''}{l}</span>)}
      </div>
      {active && <div style={{ marginTop: 10 }}><div className="dim">{job.message || 'En cola…'}</div><div className="bar" style={{ marginTop: 6 }}><i style={{ width: `${Math.round((job.progress || 0) * 100)}%` }} /></div></div>}
      {job?.status === 'error' && <div className="alert bad" style={{ marginTop: 10 }}>{job.message}</div>}
      {job?.status === 'hecho' && p.export_path && <div className="row" style={{ marginTop: 12 }}><a className="btn primary lg" href={fileUrl(p.export_path, true)}>⬇ Descargar MP4</a><span className="dim">{p.export_meta?.resolution} · {p.export_meta?.duration} s</span></div>}
    </div>
  );
}

