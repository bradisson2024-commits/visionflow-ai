import { useState } from 'react';
import { api, useData, date } from '../lib/api.js';
import { Action, Loading, Empty } from '../components/ui.jsx';

const DAYS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

function Reports({ r }) {
  const { data } = useData(`/api/semanal/${r.id}/informes`, { liveFilter: (e) => e.type === 'job' && e.job?.kind === 'semanal' });
  if (!data) return <Loading />;
  if (!data.length) return <p className="muted">Aún no hay informes.</p>;
  return data.map((rep) => (
    <details key={rep.id} className="card" open={rep === data[0]}>
      <summary style={{ cursor: 'pointer' }}><b>Informe del {date(rep.created_at)}</b> — {rep.summary.message}</summary>
      <div className="meta" style={{ margin: '10px 0' }}>
        <span className="pill ok">{rep.summary.new} nuevos</span><span className="pill">{rep.summary.repeated} ya vistos</span><span className="pill info">{rep.summary.newVideos} vídeos nuevos</span><span className="pill info">{rep.summary.newChannels} canales nuevos</span><span className="pill warn">{rep.summary.newMonetizationSignals} con señales de monetización</span>
        {rep.summary.emergingNiches.length > 0 && <span className="pill run">Nichos emergentes: {rep.summary.emergingNiches.join(', ')}</span>}
      </div>
      {rep.summary.errors?.length > 0 && <div className="alert warn">{rep.summary.errors.join(' · ')}</div>}
      <table className="t"><tbody>{rep.items.map((it) => (
        <tr key={`${it.type}${it.id}`} style={{ opacity: it.isNew ? 1 : 0.6 }}>
          <td>{it.isNew ? <span className="pill ok">Nuevo</span> : <span className="pill">Visto el {date(it.firstSeen)}</span>}</td>
          <td><a href={it.url} target="_blank" rel="noreferrer">{it.title}</a><div className="dim">{it.type === 'video' ? `Vídeo · ${it.channel}` : 'Canal'} · nicho {it.niche}</div>
            <div className="meta">{(it.categories || []).map((c) => <span key={c} className="pill">{c}</span>)}{it.monetization && <span className="pill info">{it.monetization}</span>}</div>
            <details><summary className="dim">Por qué</summary><ul className="dim">{it.explanation.map((e, i) => <li key={i}>{e}</li>)}</ul></details></td>
        </tr>
      ))}</tbody></table>
    </details>
  ));
}

export default function Semanal() {
  const { data, reload } = useData('/api/semanal', { liveFilter: (e) => e.type === 'job' && e.job?.kind === 'semanal' });
  const { data: opt } = useData('/api/radar/opciones');
  const [f, setF] = useState({ name: 'Investigación semanal', niches: '', languages: ['es', 'en', 'pt'], region: '', weekday: 1, hour: 9, maxSubscribers: 50000, channelMaxAgeDays: 180, period: '7d' });
  const [open, setOpen] = useState(null);
  if (!data || !opt) return <Loading />;
  return (
    <>
      <div className="page-head"><div><h1>Investigación semanal</h1><p className="sub">Cada semana busca canales nuevos, vídeos que despegan, canales pequeños con resultados extraordinarios y señales de monetización; compara con los informes anteriores para no repetir novedades.</p></div></div>
      <div className="card">
        <h2>Nueva investigación</h2>
        <div className="grid-sm">
          <label className="f">Nombre<input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
          <label className="f">Nichos (separados por comas, máx. 6)<input value={f.niches} onChange={(e) => setF({ ...f, niches: e.target.value })} placeholder="misterios, finanzas personales, historia bíblica" /></label>
          <label className="f">Día<select value={f.weekday} onChange={(e) => setF({ ...f, weekday: Number(e.target.value) })}>{DAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}</select></label>
          <label className="f">Hora (UTC)<input type="number" min={0} max={23} value={f.hour} onChange={(e) => setF({ ...f, hour: Number(e.target.value) })} /></label>
          <label className="f">Canales de menos de (suscriptores)<input type="number" value={f.maxSubscribers} onChange={(e) => setF({ ...f, maxSubscribers: e.target.value })} /></label>
          <label className="f">Canales creados hace ≤ días<input type="number" value={f.channelMaxAgeDays} onChange={(e) => setF({ ...f, channelMaxAgeDays: e.target.value })} /></label>
          <label className="f">País (código, opcional)<input value={f.region} onChange={(e) => setF({ ...f, region: e.target.value })} maxLength={2} /></label>
        </div>
        <div className="f" style={{ marginTop: 10 }}><span className="dim">Idiomas (máx. 4)</span><div className="chips">{opt.languages.map(([c, n]) => <button key={c} type="button" className={`chip ${f.languages.includes(c) ? 'on' : ''}`} onClick={() => setF({ ...f, languages: f.languages.includes(c) ? f.languages.filter((x) => x !== c) : [...f.languages, c].slice(0, 4) })}>{n}</button>)}</div></div>
        <p className="dim">Cuota estimada por ejecución: ≈ {(f.niches.split(',').filter((x) => x.trim()).length || 1) * f.languages.length * 400} unidades de YouTube (límite diario 10.000).</p>
        <Action className="btn primary" disabled={!f.niches.trim()} run={async () => { await api('/api/semanal', { method: 'POST', body: { ...f, niches: f.niches.split(',').map((x) => x.trim()).filter(Boolean) } }); await reload(); return 'Investigación programada.'; }}>Programar</Action>
      </div>
      {!data.length ? <Empty>No hay investigaciones programadas.</Empty> : data.map((r) => (
        <div key={r.id} className="card">
          <div className="row between">
            <div><b>{r.name}</b><div className="dim">{r.config.niches.join(', ')} · {r.config.languages.join(', ')} · cada {DAYS[r.weekday]} a las {r.hour}:00 UTC · próxima: {date(r.next_run_at)} · {r.reports} informes</div></div>
            <div className="row">
              <span className={`pill ${r.enabled ? 'ok' : ''}`}>{r.enabled ? 'Activa' : 'Pausada'}</span>
              <Action className="btn sm" run={async () => { await api(`/api/semanal/${r.id}/ejecutar`, { method: 'POST' }); return 'Investigación en marcha.'; }}>Ejecutar ahora</Action>
              <Action className="btn sm" run={async () => { await api('/api/semanal', { method: 'POST', body: { ...r.config, id: r.id, name: r.name, weekday: r.weekday, hour: r.hour, enabled: !r.enabled } }); await reload(); }}>{r.enabled ? 'Pausar' : 'Reanudar'}</Action>
              <button className="btn sm" onClick={() => setOpen(open === r.id ? null : r.id)}>{open === r.id ? 'Ocultar informes' : 'Ver informes'}</button>
              <Action className="btn sm danger" run={async () => { if (confirm('¿Eliminar la investigación y su historial?')) { await api(`/api/semanal/${r.id}`, { method: 'DELETE' }); await reload(); } }}>Eliminar</Action>
            </div>
          </div>
          {open === r.id && <div style={{ marginTop: 12 }}><Reports r={r} /></div>}
        </div>
      ))}
    </>
  );
}
