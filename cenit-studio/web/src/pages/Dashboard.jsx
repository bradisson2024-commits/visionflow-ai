import { Link } from 'react-router-dom';
import { useData, fileUrl, fmt, date } from '../lib/api.js';
import { Loading, ErrorBox, Status, Empty } from '../components/ui.jsx';

const KIND = { 'proyecto.dividir': 'Dividir en escenas', 'escena.imagen': 'Imagen de escena', 'escena.animar': 'Animación', 'proyecto.voz': 'Voz', 'proyecto.render': 'Render', 'proyecto.url': 'Análisis de URL', 'proyecto.audio': 'Transcripción', 'proyecto.audio_cortar': 'Narración subida', 'oportunidad.crear': 'Vídeo inspirado', semanal: 'Investigación semanal' };

export default function Dashboard() {
  const { data: d, error } = useData('/api/dashboard', { liveFilter: (e) => e.type === 'job' });
  if (error) return <ErrorBox error={error} />;
  if (!d) return <Loading />;
  const max = Math.max(1, ...d.activity.map((a) => a.n));
  return (
    <>
      <div className="page-head"><div><h1>Dashboard</h1><p className="sub">Tu actividad, tus proyectos y tus investigaciones.</p></div><Link className="btn primary lg" to="/crear">＋ Crear vídeo</Link></div>
      <div className="stats">
        <div className="stat"><div className="k">Proyectos</div><div className="v">{d.stats.projects}</div><div className="n">{d.stats.exported} exportados</div></div>
        <div className="stat"><div className="k">Imágenes generadas</div><div className="v">{fmt(d.stats.images)}</div></div>
        <div className="stat"><div className="k">Créditos disponibles</div><div className="v">{fmt(d.credits)}</div><div className="n">{fmt(d.stats.credits30)} usados en 30 días</div></div>
        <div className="stat"><div className="k">Cuota de YouTube hoy</div><div className="v">{fmt(d.quota.used)}</div><div className="n">de {fmt(d.quota.limit)} unidades</div></div>
        <div className="stat"><div className="k">Búsquedas en YouTube</div><div className="v">{d.stats.searches}</div></div>
      </div>
      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))' }}>
        <div className="card"><h2>Actividad (14 días)</h2>{d.activity.length ? <div className="spark">{d.activity.map((a) => <i key={a.day} title={`${date(a.day)}: ${a.n} trabajos`} style={{ height: `${(100 * a.n) / max}%` }} />)}</div> : <p className="muted">Sin actividad todavía.</p>}</div>
        <div className="card"><h2>Investigación</h2><div className="col">
          <Link className="btn" to="/radar-viral">📈 Radar Viral: vídeos que están despegando</Link>
          <Link className="btn" to="/radar-canales">📡 Radar de Canales: canales nuevos y monetización</Link>
          <Link className="btn" to="/canales">🔎 Análisis de un canal</Link>
          <Link className="btn" to="/semanal">🗓 Investigación semanal</Link>
        </div></div>
      </div>
      <div className="card"><div className="row between"><h2 style={{ margin: 0 }}>Proyectos recientes</h2><Link to="/proyectos">Ver todos</Link></div>
        {d.projects.length ? <div className="grid" style={{ marginTop: 12 }}>{d.projects.map((p) => <Link key={p.id} to={`/proyectos/${p.id}`} className="vcard"><div className="thumb">{p.cover ? <img src={fileUrl(p.cover)} alt="" /> : 'Sin imágenes'}</div><div className="body"><span className="t">{p.title}</span><span className="dim">{p.style_name} · {p.format} · {p.scenes} escenas</span>{p.export_path && <span className="pill ok">Exportado</span>}</div></Link>)}</div> : <Empty>Aún no tienes proyectos. <Link to="/crear">Crea tu primer vídeo</Link>.</Empty>}
      </div>
      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(380px, 1fr))' }}>
        <div className="card"><h2>Trabajos recientes</h2>{d.jobs.length ? <table className="t"><tbody>{d.jobs.map((j) => <tr key={j.id}><td>{KIND[j.kind] || j.kind}<div className="dim">{j.title}</div></td><td><Status s={j.status} /></td><td className="dim">{j.message}</td></tr>)}</tbody></table> : <p className="muted">Sin trabajos.</p>}</div>
        <div className="card"><h2>Últimas búsquedas</h2>{d.radar.length ? <table className="t"><tbody>{d.radar.map((r) => <tr key={r.id}><td>{r.kind === 'viral' ? 'Radar Viral' : r.kind === 'canales' ? 'Radar de Canales' : 'Análisis de canal'}<div className="dim">{[r.filters.niche, r.filters.keyword, r.filters.ref].filter(Boolean).join(' · ')}</div></td><td>{r.kind !== 'canal' && <span className="pill info">{r.hits} oportunidades</span>}</td><td className="dim">{date(r.created_at)}</td></tr>)}</tbody></table> : <p className="muted">Sin búsquedas.</p>}</div>
      </div>
    </>
  );
}
