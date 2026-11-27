import { useRef, useState } from 'react';
import { Puzzle, UserCircle, Upload, Trash2, Sparkles, Music, Play, Square, Wand2, Info, Check } from 'lucide-react';
import { api, useApi, fmtDuration, fmtDate, countWords } from '../api.js';
import { Spinner, Modal, useAction, Empty, Seg } from '../components/ui.jsx';
import VoiceList from '../components/VoiceList.jsx';

// ---------------- Extensión ----------------
export function Extension({ navigate }) {
  const { data: projects } = useApi('/projects');
  const [pid, setPid] = useState('');
  const [text, setText] = useState('');
  const [busy, run] = useAction();
  const { data: p } = useApi(pid ? `/projects/${pid}` : null, [pid]);
  const finished = (projects || []).filter(x => x.scene_count > 0);
  return (
    <div className="page">
      <div className="page-head"><div><h1 className="page-title">Extensión</h1><p className="page-sub">Continúa un video existente: añade más guion y Vimo crea las nuevas escenas con los mismos personajes y estilo, y vuelve a renderizar el video completo.</p></div></div>
      <div className="alert info" style={{ marginBottom: 16 }}><Info /><div>La función exacta de este apartado en la herramienta original no se puede verificar con la información disponible. Aquí se implementa como <b>extensión de videos</b> (continuar un proyecto), una función compatible con el flujo de creación. Si en la referencia corresponde a otra cosa, debe ajustarse.</div></div>
      <div className="card section">
        <label className="field">Proyecto a extender
          <select className="select" value={pid} onChange={e => setPid(e.target.value)}>
            <option value="">Elige un proyecto…</option>{finished.map(x => <option key={x.id} value={x.id}>{x.title} — {x.scene_count} escenas</option>)}
          </select>
        </label>
        {p && (
          <div style={{ marginTop: 14 }}>
            <div className="hint" style={{ marginBottom: 6 }}>Últimas escenas ({p.style_name})</div>
            <div className="row" style={{ alignItems: 'stretch' }}>
              {p.scenes.slice(-3).map(s => (
                <div key={s.id} className="card" style={{ width: 220, overflow: 'hidden' }}>
                  {s.image_url ? <img src={s.image_url} alt="" style={{ width: '100%', aspectRatio: '16/9', objectFit: 'cover', display: 'block' }} /> : <div style={{ aspectRatio: '16/9', background: '#efeee9' }} />}
                  <div style={{ padding: 8, fontSize: 12 }}>{s.idx + 1}. {s.narration.slice(0, 110)}…</div>
                </div>
              ))}
            </div>
            <label className="field" style={{ marginTop: 14 }}>Continuación del guion <span className="hint">{countWords(text)} palabras</span>
              <textarea className="textarea script" style={{ minHeight: 180 }} value={text} onChange={e => setText(e.target.value)} placeholder="Escribe cómo continúa la historia…" />
            </label>
            <div className="row" style={{ justifyContent: 'flex-end', marginTop: 10 }}>
              <button className="btn" disabled={!!busy} onClick={() => run('ai', async () => {
                const r = await api.post('/script/generate', { title: p.title, idea: `Continúa esta historia de forma natural, sin repetir lo ya contado. Final del guion actual: «${p.script.slice(-1500)}»`, minutes: 1.5, language: p.narration.language });
                setText(r.script);
              })}>{busy === 'ai' ? <Spinner /> : <Wand2 />} Proponer continuación con IA</button>
              <button className="btn gold" disabled={!text.trim() || !!busy || !!p.job} onClick={() => run('ext', async () => { await api.post(`/projects/${p.id}/extend`, { text }); navigate(`/proyecto/${p.id}`); })}>
                {busy === 'ext' ? <Spinner /> : <Puzzle />} Extender video
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------- Avatares ----------------
export function Avatares() {
  const { data: avatars, reload, loading } = useApi('/avatars');
  const { data: styles } = useApi('/styles');
  const [form, setForm] = useState(null);
  const [busy, run] = useAction();
  return (
    <div className="page">
      <div className="page-head">
        <div><h1 className="page-title">Avatares</h1><p className="page-sub">Avatares presentadores para tus videos. Elige uno en «Crear Video → Más opciones» y aparecerá en la esquina del video.</p></div>
        <div className="row">
          <label className="btn"><Upload /> Subir imagen<input type="file" accept="image/*" hidden onChange={e => e.target.files[0] && run('up', async () => { await api.upload('/avatars/upload', { file: e.target.files[0], name: e.target.files[0].name.replace(/\.\w+$/, '') }); await reload(); }, 'Avatar subido')} /></label>
          <button className="btn gold" onClick={() => setForm({ name: '', description: '', style_id: '2d-personaje' })}><Sparkles /> Crear con IA</button>
        </div>
      </div>
      {loading && !avatars ? <Spinner /> : !avatars?.length ? <Empty icon={UserCircle}>No hay avatares todavía.</Empty> : (
        <div className="lib">{avatars.map(a => (
          <div className="card proj" key={a.id}>
            <div className="thumb" style={{ aspectRatio: '1' }}>{a.image_url ? <img src={a.image_url} alt={a.name} /> : <UserCircle />}</div>
            <div className="body"><div className="title">{a.name}</div><div className="meta">{a.description}</div><div className="meta">{fmtDate(a.created_at)}</div></div>
            <div className="acts"><div className="spacer" /><button className="icon-btn" title="Eliminar" onClick={() => confirm('¿Eliminar avatar?') && run('d', async () => { await api.del(`/avatars/${a.id}`); await reload(); })}><Trash2 /></button></div>
          </div>))}
        </div>
      )}
      {form && (
        <Modal title="Crear avatar con IA" onClose={() => setForm(null)}>
          <div className="stack">
            <label className="field">Nombre<input className="input" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></label>
            <label className="field">Descripción<textarea className="textarea" value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} placeholder="Ej.: friendly woman presenter, curly red hair, green jacket" /></label>
            <label className="field">Estilo<select className="select" value={form.style_id} onChange={e => setForm({ ...form, style_id: e.target.value })}>{(styles || []).filter(s => s.selectable).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
            <div className="row" style={{ justifyContent: 'flex-end' }}>
              <button className="btn" onClick={() => setForm(null)}>Cancelar</button>
              <button className="btn gold" disabled={!form.name.trim() || !form.description.trim() || !!busy} onClick={() => run('c', async () => { await api.post('/avatars', form); setForm(null); await reload(); }, 'Avatar creado')}>{busy === 'c' ? <Spinner /> : <Sparkles />} Generar avatar</button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ---------------- Voces ----------------
export function Voces() {
  const { data: s, reload } = useApi('/settings');
  const [provider, setProvider] = useState(null);
  const [cfg, setCfg] = useState({ speed: 1, stability: 0.5, style: 0, tone: '' });
  const [text, setText] = useState('Hola, esta es mi voz. Así sonará la narración de tu video.');
  const [busy, run] = useAction();
  if (!s) return <div className="page"><Spinner /></div>;
  const v = s.values;
  const prov = provider || v.default_voice_provider || v.tts_provider;
  return (
    <div className="page">
      <div className="page-head"><div><h1 className="page-title">Voces</h1><p className="page-sub">Escucha las voces disponibles en tu cuenta del proveedor y elige la voz por defecto para tus narraciones.</p></div></div>
      <div className="card section">
        <div className="grid3">
          <label className="field">Velocidad: {cfg.speed.toFixed(2)}×<input type="range" min={prov === 'elevenlabs' ? 0.7 : 0.5} max={prov === 'elevenlabs' ? 1.2 : 2} step="0.05" value={cfg.speed} onChange={e => setCfg({ ...cfg, speed: Number(e.target.value) })} /></label>
          {prov === 'elevenlabs' ? <>
            <label className="field">Estabilidad: {cfg.stability.toFixed(2)}<input type="range" min="0" max="1" step="0.05" value={cfg.stability} onChange={e => setCfg({ ...cfg, stability: Number(e.target.value) })} /></label>
            <label className="field">Expresividad (estilo): {cfg.style.toFixed(2)}<input type="range" min="0" max="1" step="0.05" value={cfg.style} onChange={e => setCfg({ ...cfg, style: Number(e.target.value) })} /></label>
          </> : prov !== 'openai' ? <p className="hint" style={{ gridColumn: 'span 2', alignSelf: 'center' }}>{prov === 'piper' ? 'Piper: voces locales gratis. Pulsa «Descargar» en una voz (una sola vez) y luego «Usar». Si Piper no está instalado, instálalo en «Claves API → Servicios locales».' : 'Kokoro: voces locales gratis servidas por Kokoro-FastAPI en tu computador. Voces en español: ef_dora, em_alex, em_santa.'}</p>
          : <label className="field" style={{ gridColumn: 'span 2' }}>Tono (instrucciones para gpt-4o-mini-tts)<input className="input" value={cfg.tone} onChange={e => setCfg({ ...cfg, tone: e.target.value })} placeholder="Ej.: narrador cálido y pausado, con suspenso" /></label>}
        </div>
        <label className="field" style={{ marginTop: 12 }}>Texto de prueba<input className="input" value={text} onChange={e => setText(e.target.value)} /></label>
      </div>
      <div className="card section">
        <h2 className="section-title">Voz por defecto: <span style={{ fontWeight: 500 }}>{v.default_voice_name ? `${v.default_voice_name} (${v.default_voice_provider})` : 'ninguna'}</span></h2>
        <VoiceList provider={prov} onProvider={setProvider} selected={v.default_voice_id} settings={cfg} sampleText={text}
          onSelect={voice => run('sel', async () => { await api.put('/settings', { default_voice_provider: voice.provider, default_voice_id: voice.id, default_voice_name: voice.name, default_voice_speed: cfg.speed, tts_provider: voice.provider }); await reload(); }, `Voz por defecto: ${voice.name}`)} />
        {busy && <Spinner />}
      </div>
    </div>
  );
}

// ---------------- Música IA ----------------
export function MusicaIA() {
  const { data: moods } = useApi('/music/moods');
  const { data: tracks, reload } = useApi('/music');
  const { data: st, setData: setSt } = useApi('/settings');
  const provider = st?.values?.music_provider || 'local';
  const [mood, setMood] = useState('suspenso');
  const [prompt, setPrompt] = useState('');
  const [seconds, setSeconds] = useState(60);
  const [busy, run] = useAction();
  const [playing, setPlaying] = useState(null);
  const audio = useRef(null);
  const play = t => {
    if (playing === t.id) { audio.current.pause(); setPlaying(null); return; }
    audio.current?.pause(); audio.current = new Audio(t.url); audio.current.onended = () => setPlaying(null); audio.current.play(); setPlaying(t.id);
  };
  return (
    <div className="page">
      <div className="page-head"><div><h1 className="page-title">Música IA</h1><p className="page-sub">Genera música instrumental de fondo con IA o sube tus pistas. Al usarla en un video, Vimo baja su volumen automáticamente cuando habla la voz.</p></div>
        <label className="btn"><Upload /> Subir pista<input type="file" accept="audio/*" hidden onChange={e => e.target.files[0] && run('up', async () => { await api.upload('/music/upload', { file: e.target.files[0], name: e.target.files[0].name.replace(/\.\w+$/, '') }); await reload(); }, 'Pista subida')} /></label>
      </div>
      <div className="card section">
        <h2 className="section-title"><Music /> Generador
          <span className="right"><Seg value={provider} onChange={v => run('prov', async () => setSt(await api.put('/settings', { music_provider: v })))} options={[{ value: 'local', label: 'Compositor local (gratis)' }, { value: 'elevenlabs', label: 'ElevenLabs Music (de pago)' }]} /></span>
        </h2>
        <p className="hint" style={{ marginTop: -4 }}>{provider === 'local'
          ? 'Compone música instrumental original en tu computador (pad, piano, bajo, pulso y percusión según el ambiente). Gratis, sin límites y sin derechos de terceros: puedes usarla en YouTube. Calidad sencilla, pensada como fondo bajo la voz.'
          : 'ElevenLabs Music consume créditos de tu plan de pago.'}</p>
        <h2 className="section-title" style={{ marginTop: 14 }}><Music /> Ambiente</h2>
        <div className="catalog" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))' }}>
          {(moods || []).map(m => (
            <button key={m.id} className={`style-card ${mood === m.id ? 'selected' : ''}`} style={{ padding: '14px 12px' }} onClick={() => setMood(m.id)}>
              {mood === m.id && <span className="check"><Check /></span>}<div className="name">{m.name}</div>
            </button>
          ))}
        </div>
        {provider !== 'local' && <label className="field" style={{ marginTop: 14 }}>Descripción personalizada (opcional)<input className="input" value={prompt} onChange={e => setPrompt(e.target.value)} placeholder={moods?.find(m => m.id === mood)?.prompt} /></label>}
        <div className="row" style={{ marginTop: 12 }}>
          <label className="field" style={{ flexDirection: 'row', alignItems: 'center' }}>Duración: {seconds} s <input type="range" min="10" max="600" step="5" value={seconds} onChange={e => setSeconds(Number(e.target.value))} /></label>
          <div className="spacer" />
          <button className="btn gold" disabled={!!busy} onClick={() => run('gen', async () => { await api.post('/music/generate', { mood, prompt, seconds }); await reload(); }, 'Música generada')}>{busy === 'gen' ? <Spinner /> : <Sparkles />} Generar música</button>
        </div>
        {busy === 'gen' && <p className="hint">Componiendo… puede tardar un minuto.</p>}
      </div>
      <div className="card section">
        <h2 className="section-title">Mis pistas</h2>
        <p className="hint" style={{ marginTop: -4 }}>También puedes subir música con licencia libre para YouTube: <b>Biblioteca de audio de YouTube</b> (studio.youtube.com → Biblioteca de audio), <b>Pixabay Music</b> (pixabay.com/music) o <b>Incompetech</b> (CC BY: requiere citar al autor en la descripción). Revisa siempre la licencia de cada pista.</p>
        {!tracks?.length ? <Empty icon={Music}>Aún no hay pistas.</Empty> : (
          <div className="list">{tracks.map(t => (
            <div className="list-row" key={t.id}>
              <button className="icon-btn" onClick={() => play(t)}>{playing === t.id ? <Square /> : <Play />}</button>
              <div style={{ flex: 1 }}><div style={{ fontWeight: 600 }}>{t.name}</div><div className="hint">{t.source === 'local' ? 'Compositor local (gratis)' : t.source === 'ai' ? 'Música IA (ElevenLabs)' : 'Subida'} · {fmtDuration(t.duration)} · {fmtDate(t.created_at)}</div></div>
              <a className="btn sm" href={t.url} download>Descargar</a>
              <button className="icon-btn" onClick={() => confirm('¿Eliminar pista?') && run('d', async () => { await api.del(`/music/${t.id}`); await reload(); })}><Trash2 /></button>
            </div>))}
          </div>
        )}
      </div>
    </div>
  );
}

