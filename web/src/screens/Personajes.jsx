import { useState } from 'react';
import { Users, Plus, Sparkles, Upload, Trash2, PencilLine } from 'lucide-react';
import { api, useApi } from '../api.js';
import { Spinner, Modal, Seg, useAction, Empty } from '../components/ui.jsx';

export default function Personajes() {
  const { data: chars, reload, loading } = useApi('/characters');
  const { data: styles } = useApi('/styles');
  const [edit, setEdit] = useState(null);
  const [busy, run] = useAction();
  const [styleFor, setStyleFor] = useState({});
  const selectable = (styles || []).filter(s => s.selectable);

  return (
    <div className="page">
      <div className="page-head">
        <div><h1 className="page-title">Personajes</h1><p className="page-sub">Crea personajes reutilizables. Su ficha visual y su imagen de referencia se usan en cada escena para que conserven su apariencia.</p></div>
        <button className="btn gold" onClick={() => setEdit({ name: '', description: '', role: 'principal' })}><Plus /> Nuevo personaje</button>
      </div>
      {loading && !chars ? <Spinner /> : !chars?.length ? <Empty icon={Users}>Aún no hay personajes. Créalos aquí o deja que Vimo los detecte al analizar un guion.</Empty> : (
        <div className="stack">
          {chars.map(c => {
            const st = styleFor[c.id] || c.refs[0]?.style_id || '2d-stickman';
            return (
              <div className="card section" key={c.id} style={{ marginBottom: 0 }}>
                <div className="row" style={{ alignItems: 'flex-start', gap: 18 }}>
                  <div className="row" style={{ gap: 8 }}>
                    {c.refs.length ? c.refs.map(r => (
                      <figure key={r.style_id} style={{ margin: 0, width: 110 }}>
                        <img src={r.url} alt="" style={{ width: 110, height: 110, objectFit: 'cover', borderRadius: 10, display: 'block', border: '1px solid var(--line)' }} />
                        <figcaption className="hint" style={{ fontSize: 11 }}>{styles?.find(s => s.id === r.style_id)?.name || r.style_id}</figcaption>
                      </figure>
                    )) : <div style={{ width: 110, height: 110, borderRadius: 10, background: '#efeee9', display: 'grid', placeItems: 'center' }}><Users color="#bbb" /></div>}
                  </div>
                  <div style={{ flex: 1, minWidth: 240 }}>
                    <div className="row" style={{ gap: 8 }}><b style={{ fontSize: 15 }}>{c.name}</b><span className="chip">{c.role}</span></div>
                    <p style={{ margin: '6px 0', color: 'var(--ink-2)' }}>{c.description}</p>
                    {c.projects.length > 0 && <p className="hint" style={{ margin: 0 }}>Usado en: {c.projects.map(p => p.title).join(', ')}</p>}
                    <div className="row" style={{ marginTop: 10 }}>
                      <select className="select" style={{ maxWidth: 200 }} value={st} onChange={e => setStyleFor({ ...styleFor, [c.id]: e.target.value })}>
                        {selectable.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                      </select>
                      <button className="btn sm" disabled={!!busy} onClick={() => run('ref' + c.id, async () => { await api.post(`/characters/${c.id}/reference`, { style_id: st }); await reload(); }, 'Referencia generada')}>
                        {busy === 'ref' + c.id ? <Spinner /> : <Sparkles />} Generar referencia
                      </button>
                      <label className="btn sm"><Upload /> Subir referencia
                        <input type="file" accept="image/*" hidden onChange={e => e.target.files[0] && run('up', async () => { await api.upload(`/characters/${c.id}/reference/upload`, { file: e.target.files[0], style_id: st }); await reload(); }, 'Referencia subida')} />
                      </label>
                      <div className="spacer" />
                      <button className="icon-btn" title="Editar" onClick={() => setEdit(c)}><PencilLine /></button>
                      <button className="icon-btn" title="Eliminar" onClick={() => confirm(`¿Eliminar a ${c.name}?`) && run('d', async () => { await api.del(`/characters/${c.id}`); await reload(); })}><Trash2 /></button>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
      {edit && <CharacterForm c={edit} onClose={() => setEdit(null)} onSaved={async () => { setEdit(null); await reload(); }} />}
    </div>
  );
}

function CharacterForm({ c, onClose, onSaved }) {
  const [v, setV] = useState(c);
  const [busy, run] = useAction();
  return (
    <Modal title={c.id ? 'Editar personaje' : 'Nuevo personaje'} onClose={onClose}>
      <div className="stack">
        <label className="field">Nombre<input className="input" value={v.name} onChange={e => setV({ ...v, name: e.target.value })} /></label>
        <label className="field">Descripción visual fija
          <textarea className="textarea" value={v.description} onChange={e => setV({ ...v, description: e.target.value })} placeholder="Ej.: man in his 30s, short messy black hair, round glasses, mustard yellow hoodie, blue jeans, red sneakers, always carries a brown backpack" />
          <span className="hint">Sé concreto: edad, complexión, peinado, ropa con colores y accesorios. En inglés da mejores resultados con los generadores de imagen. Si la cambias, las referencias se regeneran.</span>
        </label>
        <label className="field">Rol<Seg value={v.role} onChange={role => setV({ ...v, role })} options={[{ value: 'principal', label: 'Principal' }, { value: 'secundario', label: 'Secundario' }]} /></label>
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button className="btn" onClick={onClose}>Cancelar</button>
          <button className="btn gold" disabled={!v.name.trim() || !v.description.trim() || !!busy} onClick={() => run('s', async () => { c.id ? await api.put(`/characters/${c.id}`, v) : await api.post('/characters', v); await onSaved(); }, 'Personaje guardado')}>Guardar</button>
        </div>
      </div>
    </Modal>
  );
}
