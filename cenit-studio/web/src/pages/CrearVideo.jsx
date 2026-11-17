import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useToast } from '../components/ui.jsx';
import { StyleCard, NewStyle } from '../components/StyleGallery.jsx';

const MODES = [
  { id: 'guion', ico: '📝', name: 'Desde Guion', desc: 'Pega un guion ya redactado y genera el vídeo automáticamente.' },
  { id: 'idea', ico: '💡', name: 'Desde Idea', desc: 'Escribe una idea breve y la inteligencia artificial desarrollará el guion y el vídeo.' },
  { id: 'url', ico: '🔗', name: 'Desde URL', desc: 'Pega un enlace de YouTube u otra fuente compatible para analizar su estructura y crear un vídeo original.' },
  { id: 'audio', ico: '🎧', name: 'Desde Audio', desc: 'Sube una narración en audio y genera el vídeo a partir de ella.' },
];
const FORMATS = [['9:16', 'Vertical', 'Shorts, Reels, TikTok', 36, 64], ['16:9', 'Horizontal', 'YouTube clásico', 72, 40], ['1:1', 'Cuadrado', 'Feeds y anuncios', 52, 52]];

export default function CrearVideo() {
  const [step, setStep] = useState(1);
  const [mode, setMode] = useState(null);
  const [input, setInput] = useState({ script: '', idea: '', url: '', audio: null });
  const [format, setFormat] = useState('16:9');
  const [styles, setStyles] = useState([]);
  const [style, setStyle] = useState('cinematic-stickman');
  const [newStyle, setNewStyle] = useState(false);
  const [busy, setBusy] = useState(false);
  const nav = useNavigate();
  const toast = useToast();
  useEffect(() => { api('/api/estilos').then(setStyles).catch((e) => toast(e.message, true)); }, []);

  const words = input.script.trim().split(/\s+/).filter(Boolean).length;
  const valid = mode === 'guion' ? words >= 20 : mode === 'idea' ? input.idea.trim().length > 2 : mode === 'url' ? /^https?:\/\/\S+/.test(input.url) : mode === 'audio' ? !!input.audio : false;

  const create = async () => {
    setBusy(true);
    try {
      const p = await api('/api/proyectos', { method: 'POST', body: { mode, format, style_id: style, script: input.script, idea: input.idea, url: input.url, title: mode === 'audio' ? input.audio.name.replace(/\.[^.]+$/, '') : undefined } });
      if (mode === 'audio') { const fd = new FormData(); fd.append('file', input.audio); await api(`/api/proyectos/${p.id}/audio`, { method: 'POST', form: fd }); }
      nav(`/proyectos/${p.id}`);
    } catch (e) { toast(e.message, true); setBusy(false); }
  };

  return (
    <>
      <div className="page-head"><div><h1>Crear nuevo vídeo</h1><p className="sub">Configura tu proyecto en unos pasos.</p></div></div>
      <div className="steps">
        <div className={`step ${step === 1 ? 'on' : 'done'}`}><b>{step > 1 ? '✓' : 1}</b>Paso 1: Modo</div>
        <div className={`step ${step === 2 ? 'on' : ''}`}><b>2</b>Paso 2: Formato</div>
      </div>

      {step === 1 && (
        <>
          <h2>¿Cómo quieres crear tu vídeo?</h2>
          <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))' }}>
            {MODES.map((m) => (
              <button key={m.id} type="button" className={`choice ${mode === m.id ? 'on' : ''}`} onClick={() => setMode(m.id)}>
                <div className="ico">{m.ico}</div><h3 style={{ margin: '8px 0 4px' }}>{m.name}</h3><div className="muted">{m.desc}</div>
              </button>
            ))}
          </div>
          {mode && (
            <div className="card" style={{ marginTop: 16 }}>
              {mode === 'guion' && <><label className="f">Guion completo<textarea rows={10} value={input.script} onChange={(e) => setInput({ ...input, script: e.target.value })} placeholder="Pega aquí tu guion…" /></label><div className="dim">{input.script.length} caracteres · {words} palabras {words < 20 && '(mínimo 20)'}</div></>}
              {mode === 'idea' && <label className="f">Idea o palabra clave<input value={input.idea} onChange={(e) => setInput({ ...input, idea: e.target.value })} placeholder="¿Por qué el cangrejo de los cocoteros sabe a langosta?" /></label>}
              {mode === 'url' && <><label className="f">URL de YouTube u otra fuente compatible (página web)<input value={input.url} onChange={(e) => setInput({ ...input, url: e.target.value })} placeholder="https://www.youtube.com/watch?v=…" /></label><p className="dim">Se analiza la estructura para crear un vídeo original. No se descarga ni se copia el contenido.</p></>}
              {mode === 'audio' && <><label className="f">Narración (mp3, wav, m4a, ogg, aac, flac · máx. 19 MB para la transcripción)<input type="file" accept="audio/*,.mp3,.wav,.m4a,.ogg,.aac,.flac" onChange={(e) => setInput({ ...input, audio: e.target.files[0] || null })} /></label>{input.audio && <audio controls src={URL.createObjectURL(input.audio)} style={{ width: '100%', marginTop: 8 }} />}</>}
              <div className="row" style={{ justifyContent: 'flex-end', marginTop: 14 }}><button className="btn primary lg" disabled={!valid} onClick={() => setStep(2)}>Continuar →</button></div>
            </div>
          )}
        </>
      )}

      {step === 2 && (
        <>
          <h2>Formato</h2>
          <div className="grid" style={{ gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', marginBottom: 22 }}>
            {FORMATS.map(([id, name, use, w, h]) => (
              <button key={id} type="button" className={`choice fmt ${format === id ? 'on' : ''}`} onClick={() => setFormat(id)}>
                <i style={{ width: w, height: h }} /><b>{name} {id}</b><span className="dim">{use}</span>
              </button>
            ))}
          </div>
          <div className="row between"><h2>Estilo visual</h2><button className="btn sm" onClick={() => setNewStyle(true)}>＋ Nuevo estilo</button></div>
          <div className="grid">{styles.map((s) => <StyleCard key={s.id} s={s} on={style === s.id} onPick={setStyle} />)}</div>
          <div className="row" style={{ justifyContent: 'space-between', marginTop: 20 }}>
            <button className="btn" onClick={() => setStep(1)}>← Volver</button>
            <button className="btn primary lg" disabled={busy} onClick={create}>{busy ? 'Creando proyecto…' : 'Crear proyecto'}</button>
          </div>
          {newStyle && <NewStyle onClose={() => setNewStyle(false)} onCreated={(s) => { setStyles([...styles, s]); setStyle(s.id); }} />}
        </>
      )}
    </>
  );
}
