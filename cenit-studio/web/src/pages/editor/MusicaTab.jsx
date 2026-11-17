import { useEffect, useState } from 'react';
import { useData, fileUrl, mmss } from '../../lib/api.js';
import { Action, Loading } from '../../components/ui.jsx';
import { UploadTrack } from '../Musica.jsx';

export default function MusicaTab({ p, patch }) {
  const { data: tracks, reload } = useData('/api/musica');
  const [m, setM] = useState({ volume: 0.25, ducking: true, fadeIn: 2, fadeOut: 3, sfx: [], ...(p.music || {}) });
  useEffect(() => setM({ volume: 0.25, ducking: true, fadeIn: 2, fadeOut: 3, sfx: [], ...(p.music || {}) }), [p.id]);
  if (!tracks) return <Loading />;
  const music = tracks.filter((t) => t.kind === 'musica'), sfx = tracks.filter((t) => t.kind === 'efecto');
  const n = p.scenes.length;
  return (
    <>
      <div className="card">
        <h2>Música de fondo</h2>
        <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))' }}>
          <button className={`choice ${!m.trackId ? 'on' : ''}`} onClick={() => setM({ ...m, trackId: null })}><b>Sin música</b></button>
          {music.map((t) => (
            <div key={t.id} className={`choice ${m.trackId === t.id ? 'on' : ''}`} style={{ padding: 12 }}>
              <div className="row between"><b>{t.title}</b><span className="dim">{mmss(t.duration)}</span></div>
              <div className="dim">{t.mood} · {t.owner_id ? 'Tuya' : 'Biblioteca'} · {t.license}</div>
              <audio controls preload="none" src={fileUrl(t.path)} style={{ width: '100%', marginTop: 6 }} />
              <button className={`btn sm ${m.trackId === t.id ? 'primary' : ''}`} onClick={() => setM({ ...m, trackId: t.id })}>{m.trackId === t.id ? 'Seleccionada' : 'Seleccionar'}</button>
            </div>
          ))}
        </div>
        {m.trackId && <div className="grid-sm" style={{ marginTop: 14 }}>
          <label className="f">Volumen: {Math.round(m.volume * 100)} %<input type="range" min={0.02} max={1} step={0.01} value={m.volume} onChange={(e) => setM({ ...m, volume: Number(e.target.value) })} /></label>
          <label className="f">Fundido de entrada: {m.fadeIn} s<input type="range" min={0} max={8} step={0.5} value={m.fadeIn} onChange={(e) => setM({ ...m, fadeIn: Number(e.target.value) })} /></label>
          <label className="f">Fundido de salida: {m.fadeOut} s<input type="range" min={0} max={10} step={0.5} value={m.fadeOut} onChange={(e) => setM({ ...m, fadeOut: Number(e.target.value) })} /></label>
          <label className="f">Desde la escena<select value={m.startScene || 1} onChange={(e) => setM({ ...m, startScene: Number(e.target.value) })}>{p.scenes.map((s) => <option key={s.id} value={s.idx}>{s.idx}</option>)}</select></label>
          <label className="f">Hasta la escena<select value={m.endScene || n} onChange={(e) => setM({ ...m, endScene: Number(e.target.value) })}>{p.scenes.map((s) => <option key={s.id} value={s.idx}>{s.idx}</option>)}</select></label>
          <label className="row"><input type="checkbox" checked={m.ducking !== false} onChange={(e) => setM({ ...m, ducking: e.target.checked })} /> Bajar la música cuando habla la voz</label>
        </div>}
      </div>
      <div className="card">
        <div className="row between"><h2 style={{ margin: 0 }}>Efectos de sonido</h2><button className="btn sm" disabled={!sfx.length || !n} onClick={() => setM({ ...m, sfx: [...(m.sfx || []), { trackId: sfx[0].id, scene: 1, volume: 0.6, offset: 0 }] })}>＋ Añadir efecto</button></div>
        {(m.sfx || []).map((x, i) => (
          <div className="row" key={i} style={{ marginTop: 8 }}>
            <select value={x.trackId} onChange={(e) => { const a = [...m.sfx]; a[i] = { ...x, trackId: e.target.value }; setM({ ...m, sfx: a }); }}>{sfx.map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}</select>
            <label className="row dim">en la escena<select value={x.scene} onChange={(e) => { const a = [...m.sfx]; a[i] = { ...x, scene: Number(e.target.value) }; setM({ ...m, sfx: a }); }}>{p.scenes.map((s) => <option key={s.id} value={s.idx}>{s.idx}</option>)}</select></label>
            <label className="row dim">volumen<input type="range" min={0.05} max={1} step={0.05} value={x.volume} onChange={(e) => { const a = [...m.sfx]; a[i] = { ...x, volume: Number(e.target.value) }; setM({ ...m, sfx: a }); }} /></label>
            <audio controls preload="none" src={fileUrl(sfx.find((t) => t.id === x.trackId)?.path)} style={{ height: 32 }} />
            <button className="btn sm ghost" onClick={() => setM({ ...m, sfx: m.sfx.filter((_, k) => k !== i) })}>✕</button>
          </div>
        ))}
        {!m.sfx?.length && <p className="muted">Sin efectos.</p>}
      </div>
      <div className="row" style={{ marginBottom: 16 }}><Action className="btn primary" run={async () => { await patch({ music: m }); return 'Música guardada.'; }}>Guardar música y efectos</Action></div>
      <UploadTrack onDone={reload} />
    </>
  );
}
