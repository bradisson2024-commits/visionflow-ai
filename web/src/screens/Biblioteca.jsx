import { useState } from 'react';
import { Library, FolderOpen, PencilLine, Copy, Trash2, Download, Film, Plus } from 'lucide-react';
import { api, useApi, useEvents, fmtDuration, fmtDate } from '../api.js';
import { StatusChip, Spinner, useAction, Empty } from '../components/ui.jsx';

export default function Biblioteca({ navigate }) {
  const { data, reload, loading } = useApi('/projects');
  const [tab, setTab] = useState('all');
  const [q, setQ] = useState('');
  const [busy, run] = useAction();
  useEvents(type => { if (type === 'project') reload(); });

  const list = (data || []).filter(p => (tab === 'all' || (tab === 'done' ? !!p.video_url : !p.video_url)) && (!q || p.title.toLowerCase().includes(q.toLowerCase())));
  return (
    <div className="page">
      <div className="page-head">
        <div><h1 className="page-title">Biblioteca</h1><p className="page-sub">Tus proyectos, videos terminados y archivos generados.</p></div>
        <button className="btn gold" onClick={() => navigate('/crear')}><Plus /> Nuevo video</button>
      </div>
      <div className="row" style={{ marginBottom: 0 }}>
        <div className="tabs" style={{ flex: 1 }}>
          {[['all', 'Todos'], ['done', 'Videos terminados'], ['wip', 'En progreso / borradores']].map(([k, l]) => <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>)}
        </div>
        <input className="input" style={{ maxWidth: 240, marginBottom: 16 }} placeholder="Buscar proyecto…" value={q} onChange={e => setQ(e.target.value)} />
      </div>
      {loading && !data ? <Spinner /> : !list.length ? (
        <Empty icon={Library}>No hay proyectos todavía. <button className="btn sm" onClick={() => navigate('/crear')}>Crear el primero</button></Empty>
      ) : (
        <div className="lib">
          {list.map(p => (
            <div className="card proj" key={p.id}>
              <div className="thumb" onClick={() => navigate(`/proyecto/${p.id}`)}>{p.thumbnail_url ? <img src={p.thumbnail_url} alt="" loading="lazy" /> : <Film />}</div>
              <div className="body">
                <div className="title">{p.title}</div>
                <div className="meta"><StatusChip status={p.status} job={p.job} /><span>{fmtDate(p.created_at)}</span></div>
                <div className="meta"><span>{p.style_name || '—'}</span>·<span>{p.duration ? fmtDuration(p.duration) : `${p.scene_count} escenas`}</span></div>
              </div>
              <div className="acts">
                <button className="icon-btn" title="Abrir" onClick={() => navigate(`/proyecto/${p.id}`)}><FolderOpen /></button>
                <button className="icon-btn" title="Editar" disabled={!!p.job} onClick={() => navigate(`/crear/${p.id}`)}><PencilLine /></button>
                <button className="icon-btn" title="Duplicar" onClick={() => run('dup' + p.id, async () => { await api.post(`/projects/${p.id}/duplicate`); await reload(); }, 'Proyecto duplicado')}>{busy === 'dup' + p.id ? <Spinner /> : <Copy />}</button>
                {p.video_url && <a className="icon-btn" title="Descargar MP4" href={`/api/projects/${p.id}/download`}><Download /></a>}
                <div className="spacer" />
                <button className="icon-btn" title="Eliminar" onClick={() => confirm(`¿Eliminar «${p.title}» y todos sus archivos?`) && run('del', async () => { await api.del(`/projects/${p.id}`); await reload(); }, 'Proyecto eliminado')}><Trash2 /></button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
