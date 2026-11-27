import { useMemo, useRef, useState } from 'react';
import { Play, Square, Check, Mic, AlertTriangle, Download } from 'lucide-react';
import { api, useApi } from '../api.js';
import { Seg, Spinner, useAction, Empty } from './ui.jsx';

/** Lista de voces del proveedor con escucha previa real y selección. */
export default function VoiceList({ provider, onProvider, selected, onSelect, settings = {}, sampleText }) {
  const { data: voices, error, loading, reload } = useApi(`/voices?provider=${provider}`, [provider]);
  const [gender, setGender] = useState('todas');
  const [q, setQ] = useState('');
  const [playing, setPlaying] = useState(null);
  const [busy, run] = useAction();
  const audio = useRef(null);

  const list = useMemo(() => (voices || []).filter(v =>
    (gender === 'todas' || v.gender === gender) &&
    (!q || `${v.name} ${v.language} ${v.accent || ''} ${v.description}`.toLowerCase().includes(q.toLowerCase()))), [voices, gender, q]);

  const stop = () => { audio.current?.pause(); setPlaying(null); };
  const play = async (v, live) => {
    if (playing === v.id) return stop();
    let url = !live && v.preview_url;
    if (!url) {
      const r = await run(v.id, () => api.post('/voices/preview', { provider, voice_id: v.id, ...settings, text: sampleText }));
      if (!r) return;
      url = r.url;
    }
    audio.current?.pause();
    audio.current = new Audio(url);
    audio.current.onended = () => setPlaying(null);
    audio.current.play();
    setPlaying(v.id);
  };

  return (
    <div className="stack">
      <div className="row">
        <Seg value={provider} onChange={p => { stop(); onProvider(p); }} options={[{ value: 'piper', label: 'Piper (gratis)' }, { value: 'kokoro', label: 'Kokoro (gratis)' }, { value: 'elevenlabs', label: 'ElevenLabs' }, { value: 'openai', label: 'OpenAI TTS' }]} />
        <Seg value={gender} onChange={setGender} options={[{ value: 'todas', label: 'Todas' }, { value: 'femenina', label: 'Femeninas' }, { value: 'masculina', label: 'Masculinas' }]} />
        <input className="input" style={{ maxWidth: 220 }} placeholder="Buscar por nombre, idioma…" value={q} onChange={e => setQ(e.target.value)} />
      </div>
      {loading && <div className="row hint"><Spinner /> Cargando voces…</div>}
      {error && <div className="alert"><AlertTriangle />{error.message}</div>}
      {!loading && !error && !list.length && <Empty icon={Mic}>No hay voces que coincidan.</Empty>}
      <div className="card list" style={{ maxHeight: 420, overflow: 'auto' }}>
        {list.map(v => (
          <div className="list-row" key={v.id} style={selected === v.id ? { background: 'var(--gold-soft)' } : undefined}>
            <button className="icon-btn" disabled={v.installed === false} title={v.installed === false ? 'Descarga la voz para escucharla' : v.preview_url ? 'Escuchar muestra' : 'Generar y escuchar muestra'} onClick={() => play(v)}>
              {busy === v.id ? <Spinner /> : playing === v.id ? <Square /> : <Play />}
            </button>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 600 }}>{v.name}</div>
              <div className="hint" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {[v.gender, v.language, v.accent, v.description].filter(Boolean).join(' · ')}
              </div>
            </div>
            {v.preview_url && <button className="btn sm ghost" onClick={() => play(v, true)} title="Escuchar con tu texto y ajustes">Con mi texto</button>}
            {v.installed === false
              ? <button className="btn sm" disabled={!!busy} onClick={() => run('dl' + v.id, async () => { await api.post(`/providers/piper/voices/${encodeURIComponent(v.id)}`); await reload(); }, `Voz ${v.name} descargada`)}>{busy === 'dl' + v.id ? <Spinner size={14} /> : <Download />} Descargar</button>
              : onSelect && (selected === v.id
                ? <span className="chip gold"><Check /> Seleccionada</span>
                : <button className="btn sm" onClick={() => onSelect(v)}>Usar</button>)}
          </div>
        ))}
      </div>
    </div>
  );
}
