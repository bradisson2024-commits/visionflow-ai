import { useState } from 'react';
import { api, fmt, date, mmss } from '../lib/api.js';
import { Action } from '../components/ui.jsx';
import { MonetizationBox } from '../components/ChannelCard.jsx';
import Inspire from '../components/Inspire.jsx';

const LABEL = { confirmada: 'A · Monetización confirmada', senales: 'B · Señales públicas de monetización', potencial: 'C · Potencial de monetización', sin_indicios: 'Sin indicios suficientes' };

export default function AnalisisCanal() {
  const [ref, setRef] = useState('');
  const [a, setA] = useState(null);
  const [sort, setSort] = useState('fecha');
  const [inspire, setInspire] = useState(null);
  const run = async () => { setA(await api('/api/canales/analizar', { method: 'POST', body: { ref } })); };
  const vids = a ? [...a.videos].sort((x, y) => (sort === 'vistas' ? y.views - x.views : sort === 'rendimiento' ? (y.vsMedian || 0) - (x.vsMedian || 0) : new Date(y.published_at) - new Date(x.published_at))) : [];
  return (
    <>
      <div className="page-head"><div><h1>Análisis de canales</h1><p className="sub">Introduce la URL, el @handle o el identificador del canal.</p></div></div>
      <div className="card row"><input className="grow" value={ref} onChange={(e) => setRef(e.target.value)} placeholder="https://www.youtube.com/@canal  ·  @canal  ·  UC…" onKeyDown={(e) => e.key === 'Enter' && ref && document.getElementById('go-an').click()} /><Action className="btn primary" disabled={!ref} busyText="Analizando…" run={run}><span id="go-an">Analizar</span></Action></div>
      {a && (
        <>
          <div className="card row" style={{ alignItems: 'center' }}>
            {a.channel.thumbnail && <img src={a.channel.thumbnail} alt="" style={{ width: 72, height: 72, borderRadius: '50%' }} />}
            <div className="grow"><a href={`https://www.youtube.com/channel/${a.channel.id}`} target="_blank" rel="noreferrer" style={{ fontSize: 20, fontWeight: 800, color: 'var(--text)' }}>{a.channel.title}</a><div className="dim">{a.channel.handle} · {a.channel.country || '—'} · creado {date(a.channel.created_at_yt)}</div></div>
            <span className="pill info">{LABEL[a.monetization.group]}</span>
          </div>
          <div className="stats">
            <div className="stat"><div className="k">Suscriptores</div><div className="v">{fmt(a.stats.subscribers)}</div></div>
            <div className="stat"><div className="k">Visualizaciones</div><div className="v">{fmt(a.stats.views)}</div><div className="n">{fmt(a.stats.videos)} vídeos</div></div>
            <div className="stat"><div className="k">Ingresos mensuales (ESTIMACIÓN)</div><div className="v">{fmt(a.stats.revenueEstimate.low)}–{fmt(a.stats.revenueEstimate.high)} $</div><div className="n">no confirmados</div></div>
            <div className="stat"><div className="k">Duración media</div><div className="v">{mmss(a.stats.avgDurationSec)}</div></div>
            <div className="stat"><div className="k">Frecuencia de publicación</div><div className="v">{a.stats.uploadsPerWeek ?? '—'}</div><div className="n">vídeos por semana</div></div>
          </div>
          <p className="dim">{a.stats.revenueEstimate.basis}</p>
          <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))' }}>
            <div className="card"><h2>Rendimiento</h2>
              <table className="t"><tbody>
                <tr><th>Mediana de vistas</th><td>{fmt(a.performance.medianViews)}</td></tr>
                <tr><th>Media vídeos largos</th><td>{fmt(a.performance.longAvg)} ({a.performance.longCount})</td></tr>
                <tr><th>Media Shorts</th><td>{fmt(a.performance.shortsAvg)} ({a.performance.shortsCount})</td></tr>
                <tr><th>Interacción media</th><td>{a.performance.engagement} %</td></tr>
              </tbody></table>
            </div>
            <div className="card"><h2>Mejores vs. peores</h2>
              {a.performance.top.map((v) => <div key={v.id} className="row between"><span style={{ maxWidth: '75%' }}>{v.title}</span><span className="pill ok">{v.vsMedian}× mediana</span></div>)}
              <hr style={{ borderColor: 'var(--line)' }} />
              {a.performance.bottom.map((v) => <div key={v.id} className="row between"><span style={{ maxWidth: '75%' }}>{v.title}</span><span className="pill bad">{v.vsMedian}×</span></div>)}
            </div>
            <div className="card"><h2>Monetización</h2><MonetizationBox m={a.monetization} channelId={a.channel.id} onSaved={run} /></div>
          </div>
          <div className="row between"><h2 style={{ margin: 0 }}>Vídeos ({a.videos.length})</h2><label className="row dim">Ordenar<select value={sort} onChange={(e) => setSort(e.target.value)}><option value="fecha">Más recientes</option><option value="vistas">Más vistos</option><option value="rendimiento">Mejor rendimiento relativo</option></select></label></div>
          <div className="grid" style={{ marginTop: 12 }}>
            {vids.map((v) => (
              <article key={v.id} className="vcard">
                <a className="thumb" href={`https://www.youtube.com/watch?v=${v.id}`} target="_blank" rel="noreferrer">{v.thumbnail && <img src={v.thumbnail} alt="" loading="lazy" />}{v.vsMedian != null && <span className="badge">{v.vsMedian}×</span>}</a>
                <div className="body"><span className="t">{v.title}</span><span className="dim">{date(v.published_at)} · {fmt(v.views)} vistas · {mmss(v.duration_sec)}{v.is_short ? ' · Short' : ''}</span>
                  <button className="btn sm" style={{ marginTop: 'auto' }} onClick={() => setInspire(v)}>Crear vídeo inspirado</button></div>
              </article>
            ))}
          </div>
        </>
      )}
      {inspire && <Inspire video={inspire} onClose={() => setInspire(null)} />}
    </>
  );
}
