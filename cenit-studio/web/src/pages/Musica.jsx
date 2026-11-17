import { useState } from 'react';
import { api, useData, fileUrl, mmss } from '../lib/api.js';
import { Loading, Action } from '../components/ui.jsx';

export function UploadTrack({ onDone }) {
  const [f, setF] = useState({ kind: 'musica', title: '', license: '', file: null });
  return (
    <div className="card">
      <h2>Subir audio propio</h2>
      <p className="dim">Sólo audio con derechos adecuados para usarlo en tus vídeos (propio, con licencia o de la Biblioteca de audio de YouTube). Indica la licencia.</p>
      <div className="grid-sm">
        <label className="f">Tipo<select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}><option value="musica">Música</option><option value="efecto">Efecto de sonido</option></select></label>
        <label className="f">Título<input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></label>
        <label className="f">Licencia / origen<input value={f.license} onChange={(e) => setF({ ...f, license: e.target.value })} placeholder="p. ej. Biblioteca de audio de YouTube, sin atribución" /></label>
        <label className="f">Archivo<input type="file" accept="audio/*" onChange={(e) => setF({ ...f, file: e.target.files[0] || null })} /></label>
      </div>
      <Action className="btn primary" disabled={!f.file || !f.license.trim()} run={async () => {
        const fd = new FormData(); fd.append('kind', f.kind); fd.append('title', f.title); fd.append('license', f.license); fd.append('file', f.file);
        await api('/api/musica', { method: 'POST', form: fd }); setF({ ...f, title: '', file: null }); onDone?.(); return 'Audio subido.';
      }}>Subir</Action>
    </div>
  );
}

export default function Musica() {
  const { data, reload } = useData('/api/musica');
  if (!data) return <Loading />;
  const section = (kind, title) => (
    <div className="card"><h2>{title}</h2>
      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))' }}>
        {data.filter((t) => t.kind === kind).map((t) => (
          <div key={t.id} className="choice" style={{ padding: 12 }}>
            <div className="row between"><b>{t.title}</b><span className="dim">{mmss(t.duration)}</span></div>
            <div className="dim">{t.mood} · {t.owner_id ? 'Tuya' : 'Biblioteca de Cenit'}</div>
            <div className="dim">Licencia: {t.license}</div>
            <audio controls preload="none" src={fileUrl(t.path)} style={{ width: '100%', marginTop: 6 }} />
            {t.owner_id && <Action className="btn sm danger" run={async () => { await api(`/api/musica/${t.id}`, { method: 'DELETE' }); await reload(); }}>Eliminar</Action>}
          </div>
        ))}
      </div>
    </div>
  );
  return (
    <>
      <div className="page-head"><div><h1>Música</h1><p className="sub">Biblioteca de música y efectos. Las pistas de Cenit son obras originales libres de derechos para tus vídeos.</p></div></div>
      {section('musica', 'Música')}
      {section('efecto', 'Efectos de sonido')}
      <UploadTrack onDone={reload} />
    </>
  );
}
