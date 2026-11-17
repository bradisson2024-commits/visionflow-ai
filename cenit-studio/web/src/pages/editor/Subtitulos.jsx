import { useEffect, useState } from 'react';
import { api, useData, mmss } from '../../lib/api.js';
import { Action, Loading } from '../../components/ui.jsx';

const ANIM = { none: 'Sin animación', fade: 'Fundido', pop: 'Aparición (pop)', karaoke: 'Karaoke palabra a palabra', deslizar: 'Giro/deslizamiento' };
const POS = { abajo: 'Abajo', centro: 'Centro', arriba: 'Arriba' };

export default function Subtitulos({ p, patch }) {
  const { data: opt } = useData('/api/subtitulos/opciones');
  const [sub, setSub] = useState(null);
  useEffect(() => { if (opt) setSub({ enabled: p.subtitles?.enabled !== false, manual: !!p.subtitles?.manual, cues: p.subtitles?.cues || [], style: { ...opt.defaults, ...(p.subtitles?.style || {}) } }); }, [opt, p.id]);
  if (!opt || !sub) return <Loading />;
  const st = sub.style;
  const set = (k, v) => setSub({ ...sub, style: { ...st, [k]: v } });
  const sample = (st.uppercase ? 'ASÍ SE VERÁN TUS SUBTÍTULOS' : 'Así se verán tus subtítulos');
  return (
    <>
      <div className="card">
        <div className="row between"><h2 style={{ margin: 0 }}>Estilo de subtítulos</h2><label className="row"><input type="checkbox" checked={sub.enabled} onChange={(e) => setSub({ ...sub, enabled: e.target.checked })} /> Mostrar subtítulos</label></div>
        <div className="chips" style={{ margin: '12px 0' }}>{Object.entries(opt.presets).map(([k, v]) => <button key={k} className="chip" onClick={() => setSub({ ...sub, style: { ...v } })}>{k}</button>)}</div>
        <div className="grid-sm">
          <label className="f">Tipografía<select value={st.font} onChange={(e) => set('font', e.target.value)}>{opt.fonts.map((f) => <option key={f}>{f}</option>)}</select></label>
          <label className="f">Tamaño: {st.size}<input type="range" min={28} max={110} value={st.size} onChange={(e) => set('size', Number(e.target.value))} /></label>
          <label className="f">Posición<select value={st.position} onChange={(e) => set('position', e.target.value)}>{Object.entries(POS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
          <label className="f">Animación<select value={st.animation} onChange={(e) => set('animation', e.target.value)}>{opt.animations.map((a) => <option key={a} value={a}>{ANIM[a]}</option>)}</select></label>
          <label className="f">Color del texto<input type="color" value={st.primary} onChange={(e) => set('primary', e.target.value)} /></label>
          <label className="f">Color de resaltado (karaoke)<input type="color" value={st.highlight} onChange={(e) => set('highlight', e.target.value)} /></label>
          <label className="f">Color del contorno<input type="color" value={st.outline} onChange={(e) => set('outline', e.target.value)} /></label>
          <label className="f">Contorno: {st.outlineWidth}<input type="range" min={0} max={10} value={st.outlineWidth} onChange={(e) => set('outlineWidth', Number(e.target.value))} /></label>
          <label className="f">Palabras por línea: {st.maxWords}<input type="range" min={2} max={12} value={st.maxWords} onChange={(e) => set('maxWords', Number(e.target.value))} /></label>
          <label className="row"><input type="checkbox" checked={st.uppercase} onChange={(e) => set('uppercase', e.target.checked)} /> Mayúsculas</label>
          <label className="row"><input type="checkbox" checked={st.background} onChange={(e) => set('background', e.target.checked)} /> Caja de fondo</label>
          <label className="row"><input type="checkbox" checked={st.bold} onChange={(e) => set('bold', e.target.checked)} /> Negrita</label>
        </div>
        <div className="sub-preview" style={{ marginTop: 14, alignItems: st.position === 'arriba' ? 'flex-start' : st.position === 'centro' ? 'center' : 'flex-end', justifyContent: 'center', maxWidth: 560 }}>
          <span style={{ fontFamily: st.font, fontSize: st.size / 3, fontWeight: st.bold ? 800 : 400, color: st.primary, WebkitTextStroke: `${st.outlineWidth / 3}px ${st.outline}`, background: st.background ? '#000000aa' : 'none', padding: st.background ? '4px 10px' : 0, borderRadius: 6 }}>
            {st.animation === 'karaoke' ? <><span style={{ color: st.highlight }}>{sample.split(' ').slice(0, 2).join(' ')} </span>{sample.split(' ').slice(2).join(' ')}</> : sample}
          </span>
        </div>
        <p className="dim">La vista previa es orientativa; el vídeo se renderiza con libass usando exactamente estos valores.</p>
      </div>
      <div className="card">
        <div className="row between"><h2 style={{ margin: 0 }}>Texto y tiempos</h2>
          <div className="row">
            <Action className="btn" disabled={!p.scenes.some((s) => s.audio_sec)} title="Necesita la voz generada" run={async () => { const r = await api(`/api/proyectos/${p.id}/subtitulos/auto?maxWords=${st.maxWords}`); setSub({ ...sub, cues: r.cues, manual: true }); return `${r.cues.length} subtítulos sincronizados con la voz.`; }}>Generar automáticamente</Action>
          </div>
        </div>
        <p className="dim">{sub.manual ? 'Se usarán estos subtítulos editados.' : 'Sin edición manual: al exportar se generan automáticamente con la voz.'}</p>
        {sub.cues.length > 0 && <table className="t"><thead><tr><th>Inicio</th><th>Fin</th><th>Texto</th><th /></tr></thead><tbody>
          {sub.cues.map((c, i) => (
            <tr key={i}>
              <td><input type="number" step="0.1" value={c.start} style={{ width: 80 }} onChange={(e) => { const cues = [...sub.cues]; cues[i] = { ...c, start: Number(e.target.value) }; setSub({ ...sub, cues, manual: true }); }} /><div className="dim">{mmss(c.start)}</div></td>
              <td><input type="number" step="0.1" value={c.end} style={{ width: 80 }} onChange={(e) => { const cues = [...sub.cues]; cues[i] = { ...c, end: Number(e.target.value) }; setSub({ ...sub, cues, manual: true }); }} /></td>
              <td><input value={c.text} style={{ width: '100%' }} onChange={(e) => { const cues = [...sub.cues]; cues[i] = { ...c, text: e.target.value }; setSub({ ...sub, cues, manual: true }); }} /></td>
              <td><button className="btn sm ghost" onClick={() => setSub({ ...sub, cues: sub.cues.filter((_, k) => k !== i), manual: true })}>✕</button></td>
            </tr>
          ))}
        </tbody></table>}
        <div className="row" style={{ marginTop: 10 }}>
          <Action className="btn primary" run={async () => { await patch({ subtitles: sub }); return 'Subtítulos guardados.'; }}>Guardar subtítulos</Action>
          {sub.manual && <Action className="btn ghost" run={async () => { const s2 = { ...sub, manual: false, cues: [] }; setSub(s2); await patch({ subtitles: s2 }); }}>Volver a automáticos</Action>}
        </div>
      </div>
    </>
  );
}
