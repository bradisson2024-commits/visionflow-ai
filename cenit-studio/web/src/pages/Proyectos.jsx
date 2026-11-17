import { Link } from 'react-router-dom';
import { api, useData, fileUrl, date } from '../lib/api.js';
import { Loading, ErrorBox, Empty, Action } from '../components/ui.jsx';

const MODE = { guion: 'Desde Guion', idea: 'Desde Idea', url: 'Desde URL', audio: 'Desde Audio' };

export default function Proyectos() {
  const { data, error, reload } = useData('/api/proyectos', { liveFilter: (e) => e.type === 'project' });
  if (error) return <ErrorBox error={error} />;
  if (!data) return <Loading />;
  return (
    <>
      <div className="page-head"><div><h1>Proyectos</h1><p className="sub">{data.length} proyectos</p></div><Link className="btn primary" to="/crear">＋ Crear vídeo</Link></div>
      {!data.length ? <Empty>Aún no hay proyectos.</Empty> : (
        <div className="grid">
          {data.map((p) => (
            <div key={p.id} className="vcard">
              <Link to={`/proyectos/${p.id}`} className="thumb">{p.cover ? <img src={fileUrl(p.cover)} alt="" /> : 'Sin imágenes'}</Link>
              <div className="body">
                <Link to={`/proyectos/${p.id}`} className="t" style={{ color: 'var(--text)' }}>{p.title}</Link>
                <div className="meta"><span className="pill">{MODE[p.mode]}</span><span className="pill">{p.format}</span><span className="pill">{p.style_name}</span>{p.export_path && <span className="pill ok">Exportado</span>}</div>
                <span className="dim">{p.scenes} escenas · actualizado {date(p.updated_at)}</span>
                <div className="row" style={{ marginTop: 'auto' }}>
                  <Link className="btn sm" to={`/proyectos/${p.id}`}>Abrir</Link>
                  {p.export_path && <a className="btn sm" href={fileUrl(p.export_path, true)}>⬇ MP4</a>}
                  <Action className="btn sm danger" run={async () => { if (confirm(`¿Eliminar «${p.title}» y sus archivos?`)) { await api(`/api/proyectos/${p.id}`, { method: 'DELETE' }); await reload(); } }}>Eliminar</Action>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
