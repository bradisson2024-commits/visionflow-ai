import { useEffect, useState } from 'react';
import { Type, Mic, FileText, LayoutGrid, Wand2, Play, ChevronDown, ChevronRight, Users, Music, UserCircle, Film, AlertTriangle, Settings2 } from 'lucide-react';
import { api, useApi, countWords } from '../api.js';
import { Toggle, Seg, Modal, Spinner, useAction } from '../components/ui.jsx';
import Catalog from '../components/Catalog.jsx';
import VoiceList from '../components/VoiceList.jsx';
import { ServicesStatus } from './Sistema.jsx';

const VOICE_PROVIDER = { piper: 'Piper · gratis', kokoro: 'Kokoro · gratis', elevenlabs: 'ElevenLabs', openai: 'OpenAI' };
const LANGS = [['es', 'Español'], ['en', 'English'], ['pt', 'Português'], ['fr', 'Français'], ['it', 'Italiano'], ['de', 'Deutsch']];

const blank = settings => ({
  title: '',
  script: '',
  style_id: '2d-stickman',
  narration: {
    enabled: true,
    ...(settings?.free_only !== 'off' && settings?.default_voice_provider === 'openai'
      ? { provider: settings?.tts_provider || 'piper', voice_id: null, voice_name: null }
      : { provider: settings?.default_voice_provider || settings?.tts_provider || 'piper', voice_id: settings?.default_voice_id || null, voice_name: settings?.default_voice_name || null }),
    speed: Number(settings?.default_voice_speed) || 1,
    stability: 0.5, style: 0, tone: '', language: settings?.language || 'es',
  },
  music: { mode: 'none', mood: 'historia', prompt: '', track_id: null, volume: Number(settings?.music_volume) || 0.18 },
  options: { aspect: '16:9', review_storyboard: false, avatar_id: null },
  character_ids: [],
});

export default function CrearVideo({ projectId, navigate, prefill }) {
  const { data: styles, reload: reloadStyles } = useApi('/styles');
  const { data: settingsRes } = useApi('/settings');
  const [form, setForm] = useState(null);
  const [voiceModal, setVoiceModal] = useState(false);
  const [aiModal, setAiModal] = useState(false);
  const [more, setMore] = useState(false);
  const [titles, setTitles] = useState(null);
  const [busy, run] = useAction();

  useEffect(() => {
    if (!settingsRes) return;
    if (projectId) {
      api.get(`/projects/${projectId}`).then(p => setForm({
        id: p.id, title: p.title, script: p.script, style_id: p.style_id, narration: p.narration, music: p.music, options: p.options,
        character_ids: p.cast.map(c => c.id), status: p.status, job: p.job,
      }));
    } else {
      const b = blank(settingsRes.values);
      if (prefill) Object.assign(b, prefill);
      setForm(b);
    }
  }, [projectId, settingsRes, prefill]);

  if (!form || !styles) return <div className="page"><Spinner /></div>;
  const set = patch => setForm(f => ({ ...f, ...patch }));
  const setN = patch => setForm(f => ({ ...f, narration: { ...f.narration, ...patch } }));
  const words = countWords(form.script);
  const minutes = words / 150 / (form.narration.speed || 1);
  const style = styles.find(s => s.id === form.style_id);
  const voiceMissing = form.narration.enabled && !form.narration.voice_id && form.narration.provider !== 'openai';
  const canCreate = form.title.trim() && words > 0 && style?.selectable && !voiceMissing && !form.job;

  const save = async () => {
    const body = { title: form.title, script: form.script, style_id: form.style_id, narration: form.narration, music: form.music, options: form.options, character_ids: form.character_ids };
    return form.id ? api.put(`/projects/${form.id}`, body) : api.post('/projects', body);
  };
  const create = mode => run(mode, async () => {
    const p = await save();
    await api.post(`/projects/${p.id}/${mode === 'storyboard' ? 'storyboard' : 'generate'}`);
    navigate(`/proyecto/${p.id}`);
  });
  const saveOnly = () => run('save', async () => { const p = await save(); navigate(`/proyecto/${p.id}`); }, 'Proyecto guardado');

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1 className="page-title">{form.id ? 'Editar video' : 'Crear Video'}</h1>
          <p className="page-sub">Escribe o pega tu guion, elige un estilo y Vimo genera escenas, imágenes, voz, música y el video final.</p>
        </div>
        {form.id && <button className="btn" onClick={() => navigate(`/proyecto/${form.id}`)}><Film /> Ver proyecto</button>}
      </div>
 <ServicesStatus compact />
      {form.job && <div className="alert warn" style={{ marginBottom: 14 }}><AlertTriangle />Este proyecto se está generando. Podrás editarlo cuando termine.</div>}

      <div className="card section">
        <h2 className="section-title"><Type /> Nombre del video
          <span className="right"><button className="btn sm" disabled={!!busy || !(form.title.trim() || form.script.trim())} onClick={() => run('titles', async () => setTitles((await api.post('/script/titles', { title: form.title, script: form.script, language: form.narration.language })).titles))}>
            {busy === 'titles' ? <Spinner size={14} /> : <Wand2 />} Sugerir títulos</button></span>
        </h2>
        <input className="input lg" placeholder="Ej.: El hombre que caminaba solo" value={form.title} onChange={e => set({ title: e.target.value })} maxLength={140} />
        {titles?.length > 0 && <div className="row" style={{ marginTop: 10, gap: 6 }}>{titles.map(t => <button key={t} className="btn sm" onClick={() => { set({ title: t }); setTitles(null); }}>{t}</button>)}</div>}
      </div>

      <div className="card section">
        <h2 className="section-title"><Mic /> Narración
          <span className="right">Voz IA <Toggle on={form.narration.enabled} onChange={v => setN({ enabled: v })} label="Voz IA" /></span>
        </h2>
        {form.narration.enabled ? (
          <div className="grid3">
            <div className="field" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span style={{ fontWeight: 550, fontSize: 13, color: 'var(--ink-2)' }}>Voz</span>
              <button className="btn" style={{ justifyContent: 'space-between' }} onClick={() => setVoiceModal(true)}>
                <span>{form.narration.voice_name || (form.narration.provider === 'openai' ? 'Alloy (OpenAI)' : 'Elegir voz…')}</span>
                <span className={`chip ${['piper', 'kokoro'].includes(form.narration.provider) ? 'ok' : ''}`}>{VOICE_PROVIDER[form.narration.provider] || form.narration.provider}</span>
              </button>
              {voiceMissing && <span className="hint" style={{ color: 'var(--danger)' }}>Elige una voz.</span>}
            </div>
            <label className="field">Velocidad: {Number(form.narration.speed).toFixed(2)}×
              <input type="range" min={form.narration.provider === 'elevenlabs' ? 0.7 : 0.5} max={form.narration.provider === 'elevenlabs' ? 1.2 : 2} step="0.05" value={form.narration.speed} onChange={e => setN({ speed: Number(e.target.value) })} />
            </label>
            <label className="field">Idioma
              <select className="select" value={form.narration.language} onChange={e => setN({ language: e.target.value })}>{LANGS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
            </label>
          </div>
        ) : <p className="hint" style={{ margin: 0 }}>Sin narración: la duración de cada escena se calcula por la longitud de su texto.</p>}
      </div>

      <div className="card section">
        <h2 className="section-title"><FileText /> Guion
          <span className="right">
            <span><b style={{ color: 'var(--ink)' }}>{words.toLocaleString('es-ES')}</b> palabras · ~{minutes < 1 ? `${Math.round(minutes * 60)} s` : `${minutes.toFixed(1)} min`}</span>
            <button className="btn sm" onClick={() => setAiModal(true)}><Wand2 /> Escribir con IA</button>
          </span>
        </h2>
        <textarea className="textarea script" placeholder="Escribe o pega aquí el guion completo de la narración…" value={form.script} onChange={e => set({ script: e.target.value })} />
      </div>

      <div className="card section">
        <h2 className="section-title"><LayoutGrid /> Catálogo
          <span className="right">Seleccionado: <b style={{ color: 'var(--ink)' }}>{style?.name || '—'}</b></span>
        </h2>
        <Catalog styles={styles} selected={form.style_id} onSelect={id => set({ style_id: id })} onChanged={reloadStyles} />
      </div>

      <div className="card section">
        <button className="btn ghost" style={{ padding: 0, fontWeight: 650 }} onClick={() => setMore(!more)}>
          {more ? <ChevronDown /> : <ChevronRight />}<Settings2 /> Más opciones
        </button>
        {more && <MoreOptions form={form} set={set} />}
      </div>

      <div className="row" style={{ justifyContent: 'flex-end', gap: 10 }}>
        <button className="btn" disabled={!!busy || !form.title.trim()} onClick={saveOnly}>{busy === 'save' && <Spinner />}Guardar</button>
        <button className="btn" disabled={!canCreate || !!busy} onClick={() => create('storyboard')} title="Analiza el guion y crea las escenas para revisarlas antes de generar imágenes">
          {busy === 'storyboard' && <Spinner />}Solo storyboard
        </button>
        <button className="btn gold xl" disabled={!canCreate || !!busy} onClick={() => create('generate')}>
          {busy === 'generate' ? <Spinner /> : <Play />} Crear video
        </button>
      </div>

      {voiceModal && (
        <Modal title="Elegir voz" onClose={() => setVoiceModal(false)} width={820}>
          <VoiceList provider={form.narration.provider} onProvider={p => setN({ provider: p, voice_id: p === 'openai' ? 'alloy' : null, voice_name: p === 'openai' ? 'Alloy' : null, speed: 1 })}
            selected={form.narration.voice_id} settings={form.narration}
            onSelect={v => { setN({ voice_id: v.id, voice_name: v.name, provider: v.provider }); setVoiceModal(false); }} />
        </Modal>
      )}
      {aiModal && <ScriptAI title={form.title} script={form.script} language={form.narration.language} onClose={() => setAiModal(false)} onDone={(script) => { set({ script }); setAiModal(false); }} />}
    </div>
  );
}

function MoreOptions({ form, set }) {
  const { data: chars } = useApi('/characters');
  const { data: tracks } = useApi('/music');
  const { data: moods } = useApi('/music/moods');
  const { data: avatars } = useApi('/avatars');
  const setM = patch => set({ music: { ...form.music, ...patch } });
  const setO = patch => set({ options: { ...form.options, ...patch } });
  const toggleChar = id => set({ character_ids: form.character_ids.includes(id) ? form.character_ids.filter(x => x !== id) : [...form.character_ids, id] });
  return (
    <div className="stack" style={{ marginTop: 14, gap: 18 }}>
      <div>
        <div className="section-title" style={{ fontSize: 14 }}><Users /> Personajes guardados</div>
        {!chars?.length ? <p className="hint">No tienes personajes guardados. Vimo detectará los personajes del guion automáticamente y los guardará en «Personajes».</p> : (
          <div className="row">{chars.map(c => (
            <button key={c.id} className={`btn sm ${form.character_ids.includes(c.id) ? 'gold' : ''}`} onClick={() => toggleChar(c.id)}>
              {c.refs[0] && <img src={c.refs[0].url} alt="" style={{ width: 18, height: 18, borderRadius: 4, objectFit: 'cover' }} />}{c.name}
            </button>))}
          </div>
        )}
      </div>
      <div>
        <div className="section-title" style={{ fontSize: 14 }}><Music /> Música de fondo</div>
        <div className="row">
          <Seg value={form.music.mode} onChange={v => setM({ mode: v })} options={[{ value: 'none', label: 'Sin música' }, { value: 'generate', label: 'Música IA' }, { value: 'track', label: 'De mi biblioteca' }]} />
          {form.music.mode === 'generate' && moods && (
            <select className="select" style={{ maxWidth: 220 }} value={form.music.mood} onChange={e => setM({ mood: e.target.value })}>{moods.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}</select>
          )}
          {form.music.mode === 'track' && (
            <select className="select" style={{ maxWidth: 280 }} value={form.music.track_id || ''} onChange={e => setM({ track_id: e.target.value || null })}>
              <option value="">Elige una pista…</option>{(tracks || []).map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          )}
          {form.music.mode !== 'none' && <label className="hint row" style={{ gap: 6 }}>Volumen <input type="range" min="0.03" max="0.6" step="0.01" value={form.music.volume} onChange={e => setM({ volume: Number(e.target.value) })} /> {Math.round(form.music.volume * 100)} %</label>}
        </div>
        {form.music.mode === 'generate' && <input className="input" style={{ marginTop: 8 }} placeholder="Descripción musical personalizada (opcional, en inglés funciona mejor)" value={form.music.prompt} onChange={e => setM({ prompt: e.target.value })} />}
      </div>
      <div className="grid3">
        <label className="field"><span className="row" style={{ gap: 6 }}><UserCircle size={15} /> Avatar presentador</span>
          <select className="select" value={form.options.avatar_id || ''} onChange={e => setO({ avatar_id: e.target.value || null })}>
            <option value="">Ninguno</option>{(avatars || []).map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </label>
        <label className="field">Formato
          <Seg value={form.options.aspect} onChange={v => setO({ aspect: v })} options={[{ value: '16:9', label: '16:9 YouTube' }, { value: '9:16', label: '9:16 Shorts' }, { value: '1:1', label: '1:1' }]} />
        </label>
        <label className="field">Revisar storyboard antes de generar imágenes
          <Toggle on={!!form.options.review_storyboard} onChange={v => setO({ review_storyboard: v })} label="Revisar storyboard" />
        </label>
      </div>
    </div>
  );
}

function ScriptAI({ title, script, language, onClose, onDone }) {
  const [v, setV] = useState({ title, idea: '', minutes: 3, tone: '' });
  const [mode, setMode] = useState(script.trim() ? 'improve' : 'write');
  const [instr, setInstr] = useState('');
  const [busy, run] = useAction();
  return (
    <Modal title="Guion con IA" onClose={onClose}>
      <div className="stack">
        <Seg value={mode} onChange={setMode} options={[{ value: 'write', label: 'Escribir uno nuevo' }, { value: 'improve', label: 'Mejorar el guion actual' }]} />
        {mode === 'improve' ? <>
          <label className="field">Qué quieres mejorar (opcional)<textarea className="textarea" value={instr} onChange={e => setInstr(e.target.value)} placeholder="Ej.: gancho inicial más fuerte, frases más cortas, más suspenso…" /></label>
          <div className="row" style={{ justifyContent: 'flex-end' }}>
            <button className="btn" onClick={onClose}>Cancelar</button>
            <button className="btn gold" disabled={!!busy || !script.trim()} onClick={() => run('i', async () => { const r = await api.post('/script/improve', { script, instructions: instr, language }); onDone(r.script); }, 'Guion mejorado')}>
              {busy ? <Spinner /> : <Wand2 />} Mejorar guion</button>
          </div>
        </> : <>
        <label className="field">Título o tema<input className="input" value={v.title} onChange={e => setV({ ...v, title: e.target.value })} /></label>
        <label className="field">Idea, datos o indicaciones<textarea className="textarea" value={v.idea} onChange={e => setV({ ...v, idea: e.target.value })} placeholder="De qué trata, puntos que debe incluir, público…" /></label>
        <div className="grid2">
          <label className="field">Duración aproximada (min)<input className="input" type="number" min="0.5" max="30" step="0.5" value={v.minutes} onChange={e => setV({ ...v, minutes: e.target.value })} /></label>
          <label className="field">Tono<input className="input" value={v.tone} onChange={e => setV({ ...v, tone: e.target.value })} placeholder="Misterioso, emotivo, divulgativo…" /></label>
        </div>
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button className="btn" onClick={onClose}>Cancelar</button>
          <button className="btn gold" disabled={!!busy || !(v.title.trim() || v.idea.trim())} onClick={() => run('g', async () => { const r = await api.post('/script/generate', { ...v, language }); onDone(r.script); }, 'Guion generado')}>
            {busy ? <Spinner /> : <Wand2 />} Generar guion
          </button>
        </div>
        </>}
      </div>
    </Modal>
  );
}
