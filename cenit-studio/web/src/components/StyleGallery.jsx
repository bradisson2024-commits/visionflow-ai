import { useState } from 'react';
import { api, fileUrl } from '../lib/api.js';
import { Modal, useToast } from './ui.jsx';

const hue = (id) => { let h = 0; for (const c of id) h = (h * 31 + c.charCodeAt(0)) % 360; return h; };

export function StyleCard({ s, on, onPick }) {
  return (
    <button type="button" className={`choice style-card ${on ? 'on' : ''}`} onClick={() => onPick(s.id)} style={{ position: 'relative' }}>
      {s.sample_path ? <div className="thumb" style={{ borderRadius: 0, border: 'none' }}><img src={fileUrl(s.sample_path)} alt={`Ejemplo de ${s.name}`} loading="lazy" /></div>
        : <div className="ph" style={{ background: `linear-gradient(135deg, hsl(${hue(s.id)} 55% 28%), hsl(${(hue(s.id) + 60) % 360} 50% 16%))` }}>Ejemplo pendiente<br />(se genera con tu proveedor en Ajustes)</div>}
      {on && <span className="active-tag">Activo</span>}
      <div className="info"><b>{s.name}</b><span>{s.description}</span></div>
    </button>
  );
}

export function NewStyle({ onClose, onCreated }) {
  const [f, setF] = useState({ name: '', description: '', base: '', palette: '', lighting: '', camera: '', characters: '', avoid: 'text, logos, watermarks' });
  const toast = useToast();
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  return (
    <Modal title="Nuevo estilo visual" onClose={onClose}>
      <p className="dim">El perfil se añade a cada prompt de imagen. Escribe las instrucciones visuales en inglés para mejores resultados. No uses personajes ni marcas de terceros.</p>
      <div className="col">
        <label className="f">Nombre<input value={f.name} onChange={set('name')} /></label>
        <label className="f">Descripción<input value={f.description} onChange={set('description')} /></label>
        <label className="f">Estilo base<textarea value={f.base} onChange={set('base')} placeholder="e.g. watercolor storybook illustration, soft textured paper" /></label>
        <div className="grid-sm">
          <label className="f">Paleta<input value={f.palette} onChange={set('palette')} /></label>
          <label className="f">Iluminación<input value={f.lighting} onChange={set('lighting')} /></label>
          <label className="f">Cámara<input value={f.camera} onChange={set('camera')} /></label>
          <label className="f">Personajes<input value={f.characters} onChange={set('characters')} /></label>
          <label className="f">Evitar<input value={f.avoid} onChange={set('avoid')} /></label>
        </div>
        <button className="btn primary" onClick={async () => { try { const s = await api('/api/estilos', { method: 'POST', body: f }); onCreated(s); onClose(); } catch (e) { toast(e.message, true); } }}>Crear estilo</button>
      </div>
    </Modal>
  );
}
