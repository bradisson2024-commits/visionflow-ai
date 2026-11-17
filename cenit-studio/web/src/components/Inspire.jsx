import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api.js';
import { Modal, Action } from './ui.jsx';
import { StyleCard } from './StyleGallery.jsx';
import VoicePicker from './VoicePicker.jsx';

/** «Crear vídeo inspirado en esta oportunidad»: elige formato, estilo, duración y voz y lanza el proceso completo. */
export default function Inspire({ video, onClose }) {
  const [styles, setStyles] = useState([]);
  const [f, setF] = useState({ format: video.is_short ? '9:16' : '16:9', styleId: 'cinematic-stickman', minutes: video.is_short ? 1 : 3, voice: null, auto: true });
  const nav = useNavigate();
  useEffect(() => { api('/api/estilos').then(setStyles); }, []);
  return (
    <Modal wide title="Crear vídeo inspirado en esta oportunidad" onClose={onClose}>
      <p className="muted">Referencia: <b>{video.title}</b>. Se analizarán su gancho, estructura, ritmo y formato para proponer una <b>idea original</b>; no se copia su guion, imágenes, voz ni música.</p>
      <ol className="dim" style={{ columns: 2 }}>{['Analizar el vídeo de referencia', 'Estructura narrativa', 'Gancho inicial', 'Tema', 'Duración', 'Formato visual', 'Ritmo', 'Qué contribuye a su rendimiento', 'Idea original', 'Guion propio', 'Modalidad (Desde URL)', 'Estilo visual', 'Escenas', 'Voz', 'Vídeo'].map((s) => <li key={s}>{s}</li>)}</ol>
      <div className="row" style={{ margin: '12px 0' }}>
        <label className="f">Formato<select value={f.format} onChange={(e) => setF({ ...f, format: e.target.value })}><option value="9:16">Vertical 9:16</option><option value="16:9">Horizontal 16:9</option><option value="1:1">Cuadrado 1:1</option></select></label>
        <label className="f">Duración del guion<select value={f.minutes} onChange={(e) => setF({ ...f, minutes: Number(e.target.value) })}>{[1, 2, 3, 5, 8, 10].map((m) => <option key={m} value={m}>{m} min</option>)}</select></label>
        <label className="row"><input type="checkbox" checked={f.auto} onChange={(e) => setF({ ...f, auto: e.target.checked })} /> Hacerlo todo automáticamente hasta el MP4</label>
      </div>
      <h3>Estilo visual</h3>
      <div className="grid" style={{ maxHeight: 330, overflowY: 'auto' }}>{styles.map((s) => <StyleCard key={s.id} s={s} on={f.styleId === s.id} onPick={(id) => setF({ ...f, styleId: id })} />)}</div>
      <h3 style={{ marginTop: 14 }}>Voz {f.voice && <span className="pill ok">{f.voice.name}</span>}</h3>
      <VoicePicker value={f.voice} onPick={(v) => setF({ ...f, voice: v })} />
      <div className="row" style={{ justifyContent: 'flex-end', marginTop: 14 }}>
        <Action className="btn primary lg" disabled={f.auto && !f.voice} run={async () => { const p = await api('/api/oportunidad', { method: 'POST', body: { videoId: video.id, ...f } }); nav(`/proyectos/${p.id}`); }}>Crear vídeo</Action>
      </div>
      {f.auto && !f.voice && <p className="dim" style={{ textAlign: 'right' }}>Elige una voz para el proceso automático.</p>}
    </Modal>
  );
}
