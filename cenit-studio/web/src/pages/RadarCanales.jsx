import { useState } from 'react';
import { api, useData, date } from '../lib/api.js';
import { Loading, Action, Empty } from '../components/ui.jsx';
import { ChannelCard } from '../components/ChannelCard.jsx';

const GROUPS = [['confirmada', 'A · Monetización confirmada', 'Evidencia directa y verificable registrada.'], ['senales', 'B · Señales públicas de monetización', 'Elementos públicos compatibles con funciones monetizadas; no verifica el Programa de Socios.'], ['potencial', 'C · Potencial de monetización', 'Parece reunir las condiciones de audiencia (estimación); estado no confirmable.'], ['sin_indicios', 'Sin indicios suficientes', '']];

export default function RadarCanales() {
  const { data: opt } = useData('/api/radar/opciones');
  const { data: hist, reload } = useData('/api/radar/busquedas?kind=canales');
  const [f, setF] = useState({ niche: '', keyword: '', languages: ['es'], region: '', maxSubscribers: 10000, channelMaxAgeDays: 90, createdAfter: '', period: '30d' });
  const [res, setRes] = useState(null);
  if (!opt) return <Loading />;
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const run = async () => { const body = Object.fromEntries(Object.entries(f).filter(([, v]) => v !== '' && v != null)); const r = await api('/api/radar/canales', { method: 'POST', body }); setRes(r); reload(); return `${r.items.length} canales · ${r.quota_used} unidades de cuota.`; };
  return (
    <>
      <div className="page-head"><div><h1>Radar de Canales</h1><p className="sub">Canales nuevos y pequeños con resultados extraordinarios. La fecha de creación sale de YouTube; si no está disponible, no se afirma que el canal sea nuevo.</p></div></div>
      <div className="alert info">YouTube no publica el estado del Programa de Socios de otros canales, y que un vídeo muestre anuncios no demuestra que su creador cobre. Por eso los resultados se separan por el tipo de evidencia disponible.</div>
      <div className="card">
        <div className="grid-sm">
          <label className="f">Nicho<input list="niches2" value={f.niche} onChange={set('niche')} /></label>
          <datalist id="niches2">{opt.niches.map((n) => <option key={n} value={n} />)}</datalist>
          <label className="f">Palabra clave<input value={f.keyword} onChange={set('keyword')} /></label>
          <label className="f">Suscriptores<select value={f.maxSubscribers} onChange={set('maxSubscribers')}>{[1000, 5000, 10000, 50000, 100000].map((n) => <option key={n} value={n}>Menos de {n.toLocaleString('es')}</option>)}</select></label>
          <label className="f">Antigüedad del canal (días máx.)<input type="number" value={f.channelMaxAgeDays} onChange={set('channelMaxAgeDays')} /></label>
          <label className="f">Creado después de<input type="date" value={f.createdAfter} onChange={set('createdAfter')} /></label>
          <label className="f">País (código)<input value={f.region} onChange={set('region')} maxLength={2} /></label>
          <label className="f">Crecimiento reciente (vídeos de)<select value={f.period} onChange={set('period')}><option value="7d">7 días</option><option value="30d">30 días</option><option value="90d">90 días</option></select></label>
        </div>
        <div className="f" style={{ marginTop: 10 }}><span className="dim">Idiomas (hasta 3; el español primero)</span><div className="chips">{opt.languages.map(([c, n]) => <button key={c} type="button" className={`chip ${f.languages.includes(c) ? 'on' : ''}`} onClick={() => setF({ ...f, languages: f.languages.includes(c) ? f.languages.filter((x) => x !== c) : [...f.languages, c].slice(0, 3) })}>{n}</button>)}</div></div>
        <div className="row" style={{ marginTop: 12 }}><Action className="btn primary lg" disabled={!f.niche && !f.keyword} busyText="Buscando canales…" run={run}>Buscar canales</Action></div>
      </div>
      {res && (res.items.length ? GROUPS.map(([g, title, desc]) => {
        const items = res.items.filter((i) => i.monetization === g);
        if (!items.length) return null;
        return <section key={g}><h2 style={{ marginTop: 18 }}>{title} ({items.length})</h2>{desc && <p className="dim">{desc}</p>}{items.map((it) => <ChannelCard key={it.item_id} it={it} labels={res.labels} onSaved={async () => setRes(await api(`/api/radar/busquedas/${res.id}`))} />)}</section>;
      }) : <Empty>No hay canales que cumplan esos filtros.</Empty>)}
      <div className="card" style={{ marginTop: 18 }}><h2>Historial</h2>
        {hist?.length ? <table className="t"><tbody>{hist.map((h) => <tr key={h.id}><td>{[h.filters.niche, h.filters.keyword].filter(Boolean).join(' · ')}<div className="dim">&lt; {Number(h.filters.maxSubscribers || 0).toLocaleString('es')} subs · {(h.filters.languages || []).join(', ')}</div></td><td>{h.results} canales</td><td className="dim">{date(h.created_at)}</td><td><Action className="btn sm" run={async () => setRes(await api(`/api/radar/busquedas/${h.id}`))}>Abrir</Action></td></tr>)}</tbody></table> : <p className="muted">Sin búsquedas.</p>}
      </div>
    </>
  );
}
