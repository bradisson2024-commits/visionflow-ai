import { useState } from 'react';
import { api, fmt, date } from '../lib/api.js';
import { Action, Modal } from './ui.jsx';

const GROUP_CLASS = { confirmada: 'ok', senales: 'info', potencial: 'warn', sin_indicios: '' };

export function MonetizationBox({ m, channelId, onSaved }) {
  const [ev, setEv] = useState(null);
  return (
    <div className="col" style={{ gap: 4 }}>
      <div className="dim">{m.disclaimer}</div>
      {m.evidence && <div className="dim">Evidencia: <a href={m.evidence.source} target="_blank" rel="noreferrer">{m.evidence.source}</a> — {m.evidence.note}</div>}
      {m.signals?.map((s, i) => <div key={i} className="dim">• {s}</div>)}
      {m.potential?.reasons?.map((s, i) => <div key={i} className="dim">• {s}</div>)}
      {m.potential && <div className="dim">Requisitos de YouTube: {m.potential.meetsFull ? 'parece cumplir el nivel completo (estimado)' : m.potential.meetsEarly ? 'parece cumplir el nivel inicial (estimado)' : 'no se aprecia que los cumpla con los datos públicos'}.</div>}
      <button className="btn sm ghost" style={{ alignSelf: 'flex-start' }} onClick={() => setEv({ sourceUrl: '', note: '' })}>Registrar evidencia de monetización confirmada</button>
      {ev && <Modal title="Evidencia directa y verificable" onClose={() => setEv(null)}>
        <p className="dim">Sólo pruebas fiables del estado de monetización del creador (p. ej. una publicación o entrevista donde muestra sus ingresos de YouTube). Pasará al grupo A para tu cuenta.</p>
        <label className="f">URL de la fuente<input value={ev.sourceUrl} onChange={(e) => setEv({ ...ev, sourceUrl: e.target.value })} /></label>
        <label className="f">Qué demuestra<textarea rows={3} value={ev.note} onChange={(e) => setEv({ ...ev, note: e.target.value })} /></label>
        <Action className="btn primary" run={async () => { await api(`/api/canales/${channelId}/evidencia`, { method: 'POST', body: ev }); setEv(null); onSaved?.(); return 'Evidencia registrada.'; }}>Guardar</Action>
      </Modal>}
    </div>
  );
}

export function ChannelCard({ it, labels, onSaved }) {
  const c = it.channel, e = it.evidence, mon = e.monetization;
  const age = c.created_at_yt ? Math.floor((Date.now() - new Date(c.created_at_yt)) / 86400e3) : null;
  return (
    <article className="card" style={{ marginBottom: 12 }}>
      <div className="row" style={{ alignItems: 'flex-start' }}>
        {c.thumbnail && <img src={c.thumbnail} alt="" style={{ width: 64, height: 64, borderRadius: '50%' }} />}
        <div className="grow col" style={{ gap: 4 }}>
          <div className="row between"><a href={`https://www.youtube.com/channel/${c.id}`} target="_blank" rel="noreferrer" style={{ fontSize: 17, fontWeight: 800, color: 'var(--text)' }}>{c.title}</a><span className={`pill ${GROUP_CLASS[it.monetization]}`}>{labels.monetization[it.monetization]}</span></div>
          <span className="dim">{c.handle} · País: {c.country || '—'} · Idioma: {c.default_language || '—'} · Creado: {c.created_at_yt ? `${date(c.created_at_yt)} (hace ${age} días, según YouTube)` : 'no indicado'}</span>
          <div className="meta"><span className="pill">{fmt(c.subscribers)} suscriptores</span><span className="pill">{fmt(c.views)} visualizaciones</span><span className="pill">{c.video_count} vídeos</span>{e.profile.uploadsPerWeek != null && <span className="pill">{e.profile.uploadsPerWeek} vídeos/semana</span>}<span className="pill">{fmt(e.recentViews)} vistas en vídeos de 30 días</span>{it.categories.includes('canal_nuevo') && <span className="pill info">Canal nuevo</span>}{it.categories.includes('canal_pequeno') && <span className="pill warn">Canal pequeño con vídeo gigante</span>}</div>
          <h3 style={{ marginTop: 8 }}>Por qué es una oportunidad</h3>
          <ul className="dim" style={{ margin: 0, paddingLeft: 18 }}>{it.explanation.map((x, i) => <li key={i}>{x}</li>)}</ul>
          <h3 style={{ marginTop: 8 }}>Monetización según la evidencia</h3>
          <MonetizationBox m={mon} channelId={c.id} onSaved={onSaved} />
        </div>
      </div>
    </article>
  );
}
