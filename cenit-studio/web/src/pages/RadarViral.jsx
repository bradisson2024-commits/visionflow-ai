import { useState } from 'react';
import { api, useData, fmt, date, ago, mmss } from '../lib/api.js';
import { Loading, Action, ErrorBox, Empty } from '../components/ui.jsx';
import Inspire from '../components/Inspire.jsx';

const CAT_CLASS = { despegando: 'info', acelerado: 'run', viral: 'ok', extraordinario: 'ok', canal_pequeno: 'warn', excepcional: 'info', tendencia: 'warn' };

export default function RadarViral() {
  const { data: opt, error } = useData('/api/radar/opciones');
  const { data: hist, reload: reloadHist } = useData('/api/radar/busquedas?kind=viral');
  const [f, setF] = useState({ niche: '', subniche: '', keyword: '', languages: ['es'], region: '', period: '7d', duration: '', minViews: '', minSubscribers: '', maxSubscribers: '', channelMaxAgeDays: '' });
  const [res, setRes] = useState(null);
  const [inspire, setInspire] = useState(null);
  const [gap, setGap] = useState({});
  if (error) return <ErrorBox error={error} />;
  if (!opt) return <Loading />;
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const toggleLang = (l) => setF({ ...f, languages: f.languages.includes(l) ? f.languages.filter((x) => x !== l) : [...f.languages, l].slice(0, 4) });
  const run = async () => { const body = Object.fromEntries(Object.entries(f).filter(([, v]) => v !== '' && v != null)); const r = await api('/api/radar/viral', { method: 'POST', body }); setRes(r); reloadHist(); return `${r.items.filter((i) => i.categories.length).length} oportunidades · ${r.quota_used} unidades de cuota.`; };
  return (
    <>
      <div className="page-head"><div><h1>Radar Viral</h1><p className="sub">Descubre vídeos que acaban de despegar (no los más vistos de la historia). Cuota de YouTube hoy: {fmt(opt.quota.used)} / {fmt(opt.quota.limit)}.</p></div></div>
      <div className="card">
        <div className="grid-sm">
          <label className="f">Nicho<input list="niches" value={f.niche} onChange={set('niche')} placeholder="Misterios, Finanzas…" /></label>
          <datalist id="niches">{opt.niches.map((n) => <option key={n} value={n} />)}</datalist>
          <label className="f">Subnicho<input value={f.subniche} onChange={set('subniche')} placeholder="faros abandonados" /></label>
          <label className="f">Palabra clave<input value={f.keyword} onChange={set('keyword')} /></label>
          <label className="f">País (código, p. ej. MX)<input value={f.region} onChange={set('region')} maxLength={2} /></label>
          <label className="f">Fecha de publicación<select value={f.period} onChange={set('period')}><option value="24h">Últimas 24 horas</option><option value="3d">Últimos 3 días</option><option value="7d">Últimos 7 días</option><option value="30d">Últimos 30 días</option></select></label>
          <label className="f">Duración<select value={f.duration} onChange={set('duration')}><option value="">Cualquiera</option><option value="shorts">Shorts</option><option value="largos">Vídeos largos</option><option value="medio">4–20 min</option><option value="largo">Más de 20 min</option></select></label>
          <label className="f">Visualizaciones mínimas<input type="number" value={f.minViews} onChange={set('minViews')} /></label>
          <label className="f">Suscriptores mínimos<input type="number" value={f.minSubscribers} onChange={set('minSubscribers')} /></label>
          <label className="f">Canales pequeños: suscriptores máx.<input type="number" value={f.maxSubscribers} onChange={set('maxSubscribers')} placeholder="p. ej. 10000" /></label>
          <label className="f">Canales nuevos: creados hace ≤ días<input type="number" value={f.channelMaxAgeDays} onChange={set('channelMaxAgeDays')} placeholder="p. ej. 90" /></label>
        </div>
        <div className="f" style={{ marginTop: 10 }}><span className="dim">Idiomas (hasta 4; el español se busca primero)</span><div className="chips">{opt.languages.map(([c, n]) => <button key={c} type="button" className={`chip ${f.languages.includes(c) ? 'on' : ''}`} onClick={() => toggleLang(c)}>{n}</button>)}</div></div>
        <div className="row" style={{ marginTop: 12 }}><Action className="btn primary lg" disabled={!f.niche && !f.subniche && !f.keyword} busyText="Consultando YouTube…" run={run}>Buscar</Action><span className="dim">Cada idioma ≈ 100 unidades + 2 por canal analizado.</span></div>
      </div>
      {res && (
        <>
          <div className="row between" style={{ marginBottom: 10 }}>
            <h2 style={{ margin: 0 }}>{res.items.length} vídeos analizados · {res.items.filter((i) => i.categories.length).length} oportunidades</h2>
            <Action className="btn" run={async () => { setRes(await api(`/api/radar/busquedas/${res.id}/actualizar`, { method: 'POST' })); return 'Nueva captura tomada: la velocidad se mide frente a la anterior.'; }}>Nueva captura (medir velocidad)</Action>
          </div>
          {!res.items.length ? <Empty>YouTube no devolvió vídeos con esos filtros.</Empty> : (
            <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))' }}>
              {res.items.map((it) => {
                const v = it.video, c = it.channel, m = it.evidence.metrics;
                return (
                  <article key={it.item_id} className="vcard">
                    <a className="thumb" href={`https://www.youtube.com/watch?v=${v.id}`} target="_blank" rel="noreferrer">{v.thumbnail && <img src={v.thumbnail} alt="" loading="lazy" />}<span className="badge">{Math.round(it.score)}</span></a>
                    <div className="body">
                      <a className="t" href={`https://www.youtube.com/watch?v=${v.id}`} target="_blank" rel="noreferrer" style={{ color: 'var(--text)' }}>{v.title}</a>
                      <span className="dim"><a href={`https://www.youtube.com/channel/${v.channel_id}`} target="_blank" rel="noreferrer">{c?.title}</a> · {fmt(c?.subscribers)} subs · {ago(v.published_at)} · {mmss(v.duration_sec)}{v.is_short ? ' · Short' : ''}</span>
                      <div className="meta">{it.categories.length ? it.categories.map((k) => <span key={k} className={`pill ${CAT_CLASS[k]}`}>{res.labels.categories[k]}</span>) : <span className="pill">Sin categoría</span>}</div>
                      <div className="meta"><span className="pill">👁 {fmt(m.views)}</span><span className="pill">{fmt(m.viewsPerHour)} vistas/h{m.velocityMeasured ? ' (medida)' : ''}</span>{m.outperformance != null && <span className="pill">{m.outperformance}× canal</span>}{m.viewsPerSub != null && <span className="pill">{m.viewsPerSub} vistas/sub</span>}</div>
                      <ul className="dim" style={{ margin: 0, paddingLeft: 18 }}>{it.explanation.map((e, i) => <li key={i}>{e}</li>)}</ul>
                      {gap[v.id] && <div className={`alert ${gap[v.id].adaptable ? 'ok' : 'warn'}`} style={{ margin: 0 }}>{gap[v.id].explanation}</div>}
                      <div className="row" style={{ marginTop: 'auto' }}>
                        <button className="btn primary sm" onClick={() => setInspire(v)}>Crear vídeo inspirado en esta oportunidad</button>
                        {v.language && !v.language.startsWith('es') && <Action className="btn sm" run={async () => setGap({ ...gap, [v.id]: await api('/api/radar/hueco-espanol', { method: 'POST', body: { q: [f.niche, f.subniche, f.keyword].filter(Boolean).join(' ') } }) })}>¿Hueco en español?</Action>}
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </>
      )}
      <div className="card" style={{ marginTop: 18 }}><h2>Historial</h2>
        {hist?.length ? <table className="t"><tbody>{hist.map((h) => <tr key={h.id}><td>{[h.filters.niche, h.filters.subniche, h.filters.keyword].filter(Boolean).join(' · ')}<div className="dim">{(h.filters.languages || []).join(', ')} · {h.filters.period}</div></td><td>{h.results} vídeos</td><td className="dim">{h.quota_used} u.</td><td className="dim">{date(h.created_at)}</td><td><Action className="btn sm" run={async () => setRes(await api(`/api/radar/busquedas/${h.id}`))}>Abrir</Action></td></tr>)}</tbody></table> : <p className="muted">Sin búsquedas.</p>}
      </div>
      {inspire && <Inspire video={inspire} onClose={() => setInspire(null)} />}
    </>
  );
}
