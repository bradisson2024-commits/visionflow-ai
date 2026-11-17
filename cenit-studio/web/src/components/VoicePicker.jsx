import { useMemo, useState } from 'react';
import { api, fileUrl, useData } from '../lib/api.js';
import { Action, Loading } from './ui.jsx';

const PROV = { gemini: 'Gemini', edge: 'Microsoft Edge', elevenlabs: 'ElevenLabs' };

/** Catálogo de voces con filtros, vista previa real y ajustes de velocidad y tono. */
export default function VoicePicker({ value, onPick, onSettings }) {
  const { data, error } = useData('/api/voces');
  const [f, setF] = useState({ provider: '', gender: '', language: 'es', q: '' });
  const [audio, setAudio] = useState({});
  const [speed, setSpeed] = useState(value?.speed ?? 1);
  const [pitch, setPitch] = useState(value?.pitch ?? 0);
  const langs = useMemo(() => [...new Set((data?.voices || []).map((v) => v.language))].sort(), [data]);
  if (error) return <div className="alert bad">{error}</div>;
  if (!data) return <Loading />;
  const list = data.voices.filter((v) => (!f.provider || v.provider === f.provider) && (!f.gender || v.gender === f.gender) && (!f.language || v.language === f.language || v.language === 'multi') && (!f.q || `${v.name} ${v.accent} ${v.description}`.toLowerCase().includes(f.q.toLowerCase())));
  const pitchAvailable = (value?.provider || '') === 'edge';
  return (
    <>
      {data.errors.length > 0 && <div className="alert warn">{data.errors.join(' ')}</div>}
      <div className="row" style={{ marginBottom: 12 }}>
        <select value={f.provider} onChange={(e) => setF({ ...f, provider: e.target.value })}><option value="">Todos los proveedores</option>{Object.entries(PROV).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
        <select value={f.gender} onChange={(e) => setF({ ...f, gender: e.target.value })}><option value="">Masculinas y femeninas</option><option value="masculina">Masculinas</option><option value="femenina">Femeninas</option><option value="sin clasificar">Sin clasificar</option></select>
        <select value={f.language} onChange={(e) => setF({ ...f, language: e.target.value })}><option value="">Todos los idiomas</option>{langs.map((l) => <option key={l} value={l}>{l}</option>)}</select>
        <input className="grow" placeholder="Buscar por nombre o acento (p. ej. es-MX)" value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} />
      </div>
      {onSettings && <div className="grid-sm" style={{ marginBottom: 12 }}>
        <label className="f">Velocidad de narración: {speed.toFixed(2)}×<input type="range" min={0.7} max={1.4} step={0.05} value={speed} onChange={(e) => setSpeed(Number(e.target.value))} onMouseUp={() => onSettings({ speed, pitch })} onTouchEnd={() => onSettings({ speed, pitch })} /></label>
        <label className="f">Tono: {pitch > 0 ? '+' : ''}{pitch} Hz {!pitchAvailable && '(sólo voces de Microsoft Edge)'}<input type="range" min={-30} max={30} step={2} value={pitch} disabled={!pitchAvailable} onChange={(e) => setPitch(Number(e.target.value))} onMouseUp={() => onSettings({ speed, pitch })} onTouchEnd={() => onSettings({ speed, pitch })} /></label>
      </div>}
      <p className="dim">{list.length} voces</p>
      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))', maxHeight: 520, overflowY: 'auto' }}>
        {list.slice(0, 300).map((v) => {
          const on = value?.provider === v.provider && value?.voiceId === v.id;
          const k = `${v.provider}:${v.id}`;
          return (
            <div key={k} className={`choice ${on ? 'on' : ''}`} style={{ padding: 12 }}>
              <div className="row between"><b>{v.name}</b><span className="pill">{PROV[v.provider]}</span></div>
              <div className="dim">{v.gender} · {v.accent} · {v.description}</div>
              {audio[k] && <audio controls autoPlay src={fileUrl(audio[k])} style={{ width: '100%', marginTop: 6 }} />}
              <div className="row" style={{ marginTop: 8 }}>
                <Action className="btn sm" busyText="Generando…" run={async () => { const r = await api('/api/voces/previa', { method: 'POST', body: { provider: v.provider, voiceId: v.id, speed, pitch } }); setAudio({ ...audio, [k]: r.key }); }}>▶ Vista previa</Action>
                {onPick && <button className={`btn sm ${on ? 'primary' : ''}`} onClick={() => onPick({ provider: v.provider, voiceId: v.id, name: v.name, speed, pitch })}>{on ? 'Seleccionada' : 'Seleccionar'}</button>}
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}
