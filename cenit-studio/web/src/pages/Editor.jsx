import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { api, useData, mmss } from '../lib/api.js';
import { Loading, ErrorBox, Status } from '../components/ui.jsx';
import Contenido from './editor/Contenido.jsx';
import { Finish } from './editor/Finish.jsx';
import VozTab from './editor/VozTab.jsx';
import Subtitulos from './editor/Subtitulos.jsx';
import MusicaTab from './editor/MusicaTab.jsx';
import Edicion from './editor/Edicion.jsx';

const TABS = [['contenido', 'Contenido'], ['voz', 'Voz'], ['subtitulos', 'Subtítulos'], ['musica', 'Música'], ['edicion', 'Edición']];
const MODE = { guion: 'Desde Guion', idea: 'Desde Idea', url: 'Desde URL', audio: 'Desde Audio' };

export default function Editor({ onCredits }) {
  const { id } = useParams();
  const [tab, setTab] = useState('contenido');
  const { data: p, error, reload } = useData(`/api/proyectos/${id}`, { liveFilter: (e) => e.projectId === id || e.job?.project_id === id });
  if (error) return <ErrorBox error={error} />;
  if (!p) return <Loading />;
  const patch = async (body) => { await api(`/api/proyectos/${id}`, { method: 'PATCH', body }); await reload(); };
  const running = p.jobs.filter((j) => ['en_cola', 'en_curso'].includes(j.status));
  const ctx = { p, reload: async () => { await reload(); onCredits?.(); }, patch, setTab };
  return (
    <>
      <div className="card proj-head">
        <div className="grow">
          <input key={p.title} defaultValue={p.title} onBlur={(e) => e.target.value.trim() && e.target.value !== p.title && patch({ title: e.target.value.trim() })} style={{ fontSize: 22, fontWeight: 800, background: 'transparent', border: 'none', padding: 0, width: '100%' }} aria-label="Nombre del proyecto" />
          <div className="meta" style={{ marginTop: 8 }}>
            <span className="pill info">{MODE[p.mode]}</span>
            <span className="pill">Formato {p.format}</span>
            <span className="pill">Estilo: {p.style.name}</span>
            <span className="pill">{p.summary.scenes} escenas</span>
            <span className="pill">Duración estimada {mmss(p.summary.durationSec)}</span>
            {running.length > 0 && <span className="pill run">{running.length} trabajo(s) en curso</span>}
          </div>
        </div>
      </div>
      {running.map((j) => <div key={j.id} className="card" style={{ padding: 12 }}><div className="row between"><span>{j.message || j.kind}</span><Status s={j.status} /></div><div className="bar" style={{ marginTop: 8 }}><i style={{ width: `${Math.round((j.progress || 0) * 100)}%` }} /></div></div>)}
      <Finish p={p} reload={ctx.reload} setTab={setTab} compact />
      <div className="tabs" role="tablist">{TABS.map(([k, l]) => <button key={k} role="tab" className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>)}</div>
      {tab === 'contenido' && <Contenido {...ctx} />}
      {tab === 'voz' && <VozTab {...ctx} />}
      {tab === 'subtitulos' && <Subtitulos {...ctx} />}
      {tab === 'musica' && <MusicaTab {...ctx} />}
      {tab === 'edicion' && <Edicion {...ctx} />}
    </>
  );
}
