import { useState } from 'react';
import { Check, Sparkles, HelpCircle, PencilLine } from 'lucide-react';
import { api } from '../api.js';
import { Modal, Spinner, useAction } from './ui.jsx';
import StylePreview from './StylePreview.jsx';

export function StyleThumb({ style }) {
  return style.preview_url ? <img className="thumb" src={style.preview_url} alt={style.name} loading="lazy" /> : <StylePreview style={style} />;
}

export default function Catalog({ styles, selected, onSelect, onChanged }) {
  const [busy, run] = useAction();
  const [editing, setEditing] = useState(null);
  const verified = styles.filter(s => s.verified).length;
  const genPreview = (e, s) => {
    e.stopPropagation();
    run(s.id, async () => { await api.post(`/styles/${s.id}/preview`); await onChanged?.(); }, `Vista previa de «${s.name}» generada`);
  };
  return (
    <>
      <div className="catalog">
        {styles.map(s => (
          s.selectable ? (
            <button type="button" key={s.id} className={`style-card ${selected === s.id ? 'selected' : ''}`} onClick={() => onSelect(s.id)} title={s.description}>
              <StyleThumb style={s} />
              <span className="slot">{s.slot}</span>
              {selected === s.id && <span className="check"><Check /></span>}
              <span className="icon-btn gen" role="button" tabIndex={0} title="Generar vista previa real con IA" onClick={e => genPreview(e, s)}>
                {busy === s.id ? <Spinner size={14} /> : <Sparkles />}
              </span>
              <div className="meta"><div className="name">{s.name}</div><div className="desc">{s.description}</div></div>
            </button>
          ) : (
            <div key={s.id} className="style-card pending">
              <StylePreview style={s} />
              <span className="slot">{s.slot}</span>
              <div className="meta">
                <div className="name" style={{ display: 'flex', alignItems: 'center', gap: 4 }}><HelpCircle size={13} /> Pendiente de verificación</div>
                <div className="desc">Nombre no legible en la referencia.</div>
                <button type="button" className="btn sm" style={{ marginTop: 6 }} onClick={() => setEditing(s)}><PencilLine /> Definir estilo</button>
              </div>
            </div>
          )
        ))}
      </div>
      <p className="hint" style={{ marginTop: 10 }}>
        {styles.length} estilos · {verified} con nombre verificado en la referencia · {styles.filter(s => s.defined_by_user).length} definidos por ti · {styles.filter(s => !s.selectable).length} pendientes.
        Las miniaturas son ilustrativas hasta que generes la vista previa real con <Sparkles size={12} style={{ verticalAlign: -2 }} />.
      </p>
      {editing && <StyleEditor style={editing} onClose={() => setEditing(null)} onSaved={async () => { setEditing(null); await onChanged?.(); }} />}
    </>
  );
}

function StyleEditor({ style, onClose, onSaved }) {
  const [v, setV] = useState({ name: style.name || '', description: style.description || '', prompt: style.prompt || '', palette: style.palette || '', lighting: style.lighting || '', character_design: style.character_design || '', environment: style.environment || '' });
  const [busy, run] = useAction();
  const f = k => e => setV({ ...v, [k]: e.target.value });
  return (
    <Modal title={`Definir el estilo ${style.slot}`} onClose={onClose}>
      <div className="alert warn" style={{ marginBottom: 12 }}>Usa el nombre exacto que veas en la referencia. El prompt (en inglés) describe el estilo artístico que se aplicará a todas las escenas.</div>
      <div className="stack">
        <label className="field">Nombre del estilo<input className="input" value={v.name} onChange={f('name')} /></label>
        <label className="field">Descripción<input className="input" value={v.description} onChange={f('description')} /></label>
        <label className="field">Prompt visual (inglés)<textarea className="textarea" value={v.prompt} onChange={f('prompt')} /></label>
        <div className="grid2">
          <label className="field">Paleta<input className="input" value={v.palette} onChange={f('palette')} /></label>
          <label className="field">Iluminación<input className="input" value={v.lighting} onChange={f('lighting')} /></label>
          <label className="field">Diseño de personajes<input className="input" value={v.character_design} onChange={f('character_design')} /></label>
          <label className="field">Escenarios<input className="input" value={v.environment} onChange={f('environment')} /></label>
        </div>
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button className="btn" onClick={onClose}>Cancelar</button>
          <button className="btn gold" disabled={!v.name.trim() || !v.prompt.trim() || busy} onClick={() => run('s', async () => { await api.put(`/styles/${style.id}`, v); await onSaved(); }, 'Estilo guardado')}>
            {busy && <Spinner />} Guardar estilo
          </button>
        </div>
      </div>
    </Modal>
  );
}
