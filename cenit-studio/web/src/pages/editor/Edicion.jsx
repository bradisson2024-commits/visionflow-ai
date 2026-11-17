import { useEffect, useState } from 'react';
import { api, fileUrl, useData, mmss } from '../../lib/api.js';
import { Action, Loading, Status } from '../../components/ui.jsx';

const TR = { corte: 'Corte', fundido: 'Fundido', deslizar: 'Deslizar', zoom: 'Zoom', disolver: 'Disolver', barrido: 'Barrido', circulo: 'Círculo' };

export default function Edicion({ p, reload, patch }) {
  const { data: opt } = useData('/api/opciones-edicion');
  const { data: tl, reload: reloadTl } = useData(`/api/proyectos/${p.id}/linea-tiempo`);
  const [e, setE] = useState({ brightness: 0, contrast: 1, saturation: 1, kenBurns: false, voiceVolume: 1, transitionSec: 0.4, pauseSec: 0.35, ...(p.edit || {}) });
  const [res, setRes] = useState('1080p');
  useEffect(() => { reloadTl(); }, [p.scenes.map((s) => `${s.id}${s.idx}${s.audio_sec}${s.duration_sec}${s.transition}`).join()]);
  if (!opt || !tl) return <Loading />;
  const total = tl.reduce((a, x) => a + x.duration, 0);
  const renders = p.jobs.filter((j) => j.kind === 'proyecto.render');
  const busy = renders.some((j) => ['en_cola', 'en_curso'].includes(j.status));
  const move = async (i, d) => { const ids = p.scenes.map((s) => s.id); const [x] = ids.splice(i, 1); ids.splice(i + d, 0, x); await api(`/api/proyectos/${p.id}/escenas/orden`, { method: 'POST', body: { ids } }); await reload(); };
  const scenePatch = async (s, body) => { await api(`/api/proyectos/${p.id}/escenas/${s.id}`, { method: 'PATCH', body }); await reload(); };
  const missing = p.scenes.filter((s) => s.image_status !== 'lista').length;
  return (
    <>
      <div className="card">
        <div className="row between"><h2 style={{ margin: 0 }}>Vista previa</h2>
          <Action className="btn" disabled={busy || missing > 0} busyText="En cola…" run={async () => { await api(`/api/proyectos/${p.id}/render`, { method: 'POST', body: { kind: 'previa' } }); await reload(); return 'Generando vista previa (480p)…'; }}>Generar vista previa</Action></div>
        {missing > 0 && <div className="alert warn" style={{ marginTop: 10 }}>Faltan {missing} imágenes por generar en la pestaña Contenido.</div>}
        {p.edit?.previewPath ? <video key={p.edit.previewPath} controls src={fileUrl(p.edit.previewPath)} style={{ width: '100%', maxHeight: 480, background: '#000', borderRadius: 12, marginTop: 10 }} /> : <p className="muted">Aún no hay vista previa.</p>}
      </div>
      <div className="card">
        <div className="row between"><h2 style={{ margin: 0 }}>Secuencia de escenas</h2><span className="dim">Duración total {mmss(total)}</span></div>
        <table className="t"><thead><tr><th>Orden</th><th /><th>Narración</th><th>Duración</th><th>Transición de entrada</th></tr></thead><tbody>
          {p.scenes.map((s, i) => {
            const t = tl.find((x) => x.id === s.id);
            return (
              <tr key={s.id}>
                <td><div className="row"><b>{s.idx}</b><button className="btn sm ghost" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Subir">↑</button><button className="btn sm ghost" disabled={i === p.scenes.length - 1} onClick={() => move(i, 1)} aria-label="Bajar">↓</button></div></td>
                <td style={{ width: 90 }}>{s.image_path ? <img src={fileUrl(s.image_path)} alt="" style={{ width: 80, borderRadius: 6 }} /> : <Status s={s.image_status} />}</td>
                <td style={{ maxWidth: 380 }}>{s.narration}</td>
                <td><input type="number" min={1} step={0.5} defaultValue={s.duration_sec || ''} placeholder={t?.duration.toFixed(1)} style={{ width: 80 }} onBlur={(ev) => ev.target.value !== String(s.duration_sec || '') && scenePatch(s, { duration_sec: ev.target.value ? Number(ev.target.value) : null })} /><div className="dim">{t ? `${t.duration.toFixed(1)} s` : ''}{s.audio_sec ? ` (voz ${s.audio_sec.toFixed(1)} s)` : ''}</div></td>
                <td>{i === 0 ? <span className="dim">Inicio</span> : <select value={s.transition} onChange={(ev) => scenePatch(s, { transition: ev.target.value })}>{opt.transitions.map((x) => <option key={x} value={x}>{TR[x]}</option>)}</select>}</td>
              </tr>
            );
          })}
        </tbody></table>
        <p className="dim">La duración de cada imagen se ajusta a su voz (más una pausa); puedes alargarla, nunca acortarla por debajo de su narración.</p>
      </div>
      <div className="card">
        <h2>Ajustes de imagen y audio</h2>
        <div className="grid-sm">
          <label className="f">Brillo: {e.brightness.toFixed(2)}<input type="range" min={-0.3} max={0.3} step={0.01} value={e.brightness} onChange={(x) => setE({ ...e, brightness: Number(x.target.value) })} /></label>
          <label className="f">Contraste: {e.contrast.toFixed(2)}<input type="range" min={0.6} max={1.6} step={0.01} value={e.contrast} onChange={(x) => setE({ ...e, contrast: Number(x.target.value) })} /></label>
          <label className="f">Saturación: {e.saturation.toFixed(2)}<input type="range" min={0} max={2} step={0.01} value={e.saturation} onChange={(x) => setE({ ...e, saturation: Number(x.target.value) })} /></label>
          <label className="f">Duración de transiciones: {e.transitionSec.toFixed(2)} s<input type="range" min={0.1} max={1.2} step={0.05} value={e.transitionSec} onChange={(x) => setE({ ...e, transitionSec: Number(x.target.value) })} /></label>
          <label className="f">Pausa tras cada frase: {e.pauseSec.toFixed(2)} s<input type="range" min={0} max={1.5} step={0.05} value={e.pauseSec} onChange={(x) => setE({ ...e, pauseSec: Number(x.target.value) })} /></label>
          <label className="f">Volumen de la voz: {Math.round(e.voiceVolume * 100)} %<input type="range" min={0.3} max={2} step={0.05} value={e.voiceVolume} onChange={(x) => setE({ ...e, voiceVolume: Number(x.target.value) })} /></label>
          <label className="row"><input type="checkbox" checked={e.kenBurns} onChange={(x) => setE({ ...e, kenBurns: x.target.checked })} /> Acercamiento lento en imágenes fijas</label>
        </div>
        <p className="dim">El volumen y los fundidos de la música se ajustan en la pestaña Música.</p>
        <Action className="btn primary" run={async () => { await patch({ edit: { ...(p.edit || {}), ...e } }); return 'Ajustes guardados.'; }}>Guardar ajustes</Action>
      </div>
      <div className="card">
        <h2>Exportación</h2>
        <div className="row">
          <label className="row dim">Resolución<select value={res} onChange={(x) => setRes(x.target.value)}>{opt.exports.map((r) => <option key={r}>{r}</option>)}</select></label>
          <span className="dim">Formato {p.format} · 30 fps · H.264 + AAC</span>
          <Action className="btn primary lg" disabled={busy || missing > 0} busyText="En cola…" run={async () => { await patch({ edit: { ...(p.edit || {}), ...e } }); await api(`/api/proyectos/${p.id}/render`, { method: 'POST', body: { kind: 'final', resolution: res } }); await reload(); return 'Exportando el vídeo…'; }}>Exportar MP4</Action>
        </div>
        {renders.slice(0, 3).map((j) => <div key={j.id} className="row" style={{ marginTop: 8 }}><Status s={j.status} /><span className="dim">{j.payload?.kind === 'previa' ? 'Vista previa' : `Exportación ${j.payload?.resolution}`} · {j.message || ''}</span></div>)}
        {p.export_path && (
          <div style={{ marginTop: 14 }}>
            <video controls src={fileUrl(p.export_path)} style={{ width: '100%', maxHeight: 520, background: '#000', borderRadius: 12 }} />
            <div className="row" style={{ marginTop: 10 }}>
              <a className="btn primary" href={fileUrl(p.export_path, true)}>⬇ Descargar MP4</a>
              <span className="dim">{p.export_meta.resolution} · {p.export_meta.duration} s · {(p.export_meta.sizeBytes / 1048576).toFixed(1)} MB · comprobado: {p.export_meta.checks.join(', ')}</span>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
