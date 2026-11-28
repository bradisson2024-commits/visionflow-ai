import { useEffect, useState } from 'react';
import { KeyRound, Check, X, ExternalLink, PlayCircle, AlertTriangle, Save, Info, Sparkles, Download, RefreshCw, Server } from 'lucide-react';
import { api, useApi } from '../api.js';
import { Spinner, useAction } from '../components/ui.jsx';

export const DEMO = {
  title: 'El último tren de la noche',
  script: `Tomás salió de la oficina cuando ya era de noche. La calle estaba vacía y solo se oía el sonido de sus pasos sobre el asfalto mojado.

Caminó hasta la estación con las manos en los bolsillos, pensando en todo lo que había salido mal ese día. Había perdido el proyecto en el que llevaba meses trabajando.

En el andén, un anciano con un paraguas rojo le sonrió y se sentó a su lado. Le preguntó por qué parecía tan triste.

Tomás le contó todo. El anciano escuchó en silencio y, al final, le dijo que él también había perdido muchas cosas, pero que cada final había sido el comienzo de algo mejor.

Cuando llegó el tren, Tomás se dio la vuelta para darle las gracias, pero el banco estaba vacío. Solo quedaba el paraguas rojo, apoyado contra la pared.

Esa noche, mientras el tren cruzaba la ciudad iluminada, Tomás sonrió por primera vez en mucho tiempo.`,
  style_id: '2d-stickman',
};

// ---------------- Demo ----------------
export function Demo({ navigate }) {
  return (
    <div className="page prose">
      <div className="page-head"><div><h1 className="page-title">Demo</h1><p className="page-sub">Cómo funciona Vimo, paso a paso, con un guion de ejemplo.</p></div></div>
      <ServicesStatus />
      <div className="card section">
        <h2 className="section-title"><PlayCircle /> El proceso</h2>
        <ol>
          <li><b>Analizar el guion</b>: la IA lee el texto completo y entiende la secuencia de acontecimientos.</li>
          <li><b>Dividir en escenas</b>: cada escena recibe su texto exacto de narración, descripción visual, personajes, acción, lugar, emoción, encuadre y prompt.</li>
          <li><b>Storyboard</b>: puedes revisarlo y editarlo antes de generar imágenes (opción «Revisar storyboard»).</li>
          <li><b>Personajes</b>: se crea una imagen de referencia de cada personaje en el estilo elegido y se usa en todas sus escenas.</li>
          <li><b>Imágenes</b>: una imagen distinta para cada escena, siguiendo la narración.</li>
          <li><b>Voz</b>: la narración se genera escena por escena para que cada frase suene mientras se ve su imagen.</li>
          <li><b>Música</b>: música IA o tu pista, con el volumen bajando automáticamente bajo la voz.</li>
          <li><b>Montaje y render</b>: movimientos de cámara suaves, transiciones y exportación a MP4 (H.264 + AAC).</li>
        </ol>
        <p>El guion de ejemplo es una historia corta en estilo <b>2D Stickman</b>, con un protagonista que aparece en varias escenas (calle, estación, andén, tren).</p>
        <button className="btn gold xl" onClick={() => navigate('/crear', DEMO)}><PlayCircle /> Abrir la demo en Crear Video</button>
      </div>
    </div>
  );
}

// ---------------- Claves API ----------------
export function ClavesAPI() {
  const { data: keys, setData } = useApi('/keys');
  const { data: st } = useApi('/settings');
  const freeOnly = st?.values?.free_only !== 'off';
  const [vals, setVals] = useState({});
  const [tests, setTests] = useState({});
  const [busy, run] = useAction();
  return (
    <div className="page">
      <div className="page-head"><div><h1 className="page-title">Claves API</h1><p className="page-sub">Conecta los servicios de IA que usará Vimo. Las claves se guardan solo en tu servidor (base de datos local) y nunca se muestran completas.</p></div></div>
      <ServicesStatus />
      <LocalServices />
      <h2 className="section-title" style={{ margin: '22px 0 10px' }}><KeyRound /> Claves de servicios en la nube</h2>
      {!keys ? <Spinner /> : (
        <div className="stack">
          {freeOnly && <p className="hint" style={{ margin: 0 }}>Modo gratuito activado: las claves de servicios que piden saldo (Anthropic, OpenAI, Replicate) están ocultas. Puedes desactivarlo en Ajustes.</p>}
          {keys.filter(k => !(freeOnly && k.paid)).map(k => (
            <div className="card section" key={k.id} style={{ marginBottom: 0 }}>
              <div className="row">
                <b style={{ fontSize: 15 }}>{k.label}</b>{k.free && <span className="chip gold">Gratis con límites</span>}
                {k.configured ? <span className="chip ok"><Check /> Configurada {k.source === 'env' ? '(variable de entorno)' : ''} · {k.masked}</span> : <span className="chip">Sin configurar</span>}
                <div className="spacer" />
                <a className="btn sm ghost" href={k.url} target="_blank" rel="noreferrer">Obtener clave <ExternalLink /></a>
              </div>
              <p className="hint" style={{ margin: '4px 0 10px' }}>{k.use} · variable de entorno: <span className="kbd">{k.env}</span></p>
              <div className="row">
                <input className="input" style={{ flex: 1, minWidth: 220 }} type="password" autoComplete="off" placeholder={k.configured ? 'Pega una clave nueva para reemplazarla' : 'Pega tu clave API'} value={vals[k.id] || ''} onChange={e => setVals({ ...vals, [k.id]: e.target.value })} />
                <button className="btn" disabled={!vals[k.id] || !!busy} onClick={() => run('s' + k.id, async () => { setData(await api.put(`/keys/${k.id}`, { value: vals[k.id] })); setVals({ ...vals, [k.id]: '' }); }, 'Clave guardada')}><Save /> Guardar</button>
                <button className="btn" disabled={!k.configured || !!busy} onClick={() => run('t' + k.id, async () => setTests({ ...tests, [k.id]: await api.post(`/keys/${k.id}/test`) }))}>{busy === 't' + k.id ? <Spinner /> : null} Probar conexión</button>
                {k.source === 'app' && <button className="btn danger" disabled={!!busy} onClick={() => run('d', async () => setData(await api.put(`/keys/${k.id}`, { value: '' })), 'Clave eliminada')}>Quitar</button>}
              </div>
              {tests[k.id] && <div className={`alert ${tests[k.id].ok ? 'info' : ''}`} style={{ marginTop: 10 }}>{tests[k.id].ok ? <Check color="var(--ok)" /> : <AlertTriangle />}{tests[k.id].message}</div>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}


const KIND_LABEL = { llm: 'Guion y escenas', image: 'Imágenes', tts: 'Voz', music: 'Música', render: 'Montaje y render' };

/** Estado real de los proveedores elegidos en Ajustes (qué funciona y qué falta). */
export function ServicesStatus({ compact }) {
  const [st, setSt] = useState(null);
  const [loading, setLoading] = useState(false);
  const load = async () => { setLoading(true); try { setSt(await api.get('/providers/status')); } finally { setLoading(false); } };
  useEffect(() => { load(); }, []);
  if (!st) return <div className="card section"><Spinner /> Comprobando servicios…</div>;
  const missing = Object.values(st).filter(x => !x.ready).length;
  if (compact && !missing) return null;
  return (
    <div className="card section" style={missing ? { borderColor: '#f3dc8c' } : undefined}>
      <h2 className="section-title"><Server /> Servicios que usará Vimo
        <span className="right">{missing ? <span className="chip gold">{missing} por conectar</span> : <span className="chip ok"><Check /> Todo listo</span>}
          <button className="btn sm" onClick={load} disabled={loading}>{loading ? <Spinner size={14} /> : <RefreshCw />} Comprobar</button></span>
      </h2>
      <div className="list">
        {Object.entries(st).map(([kind, x]) => (
          <div key={kind} className="list-row" style={{ padding: '8px 4px' }}>
            {x.ready ? <Check color="var(--ok)" size={16} /> : <X color="var(--danger)" size={16} />}
            <b style={{ minWidth: 150 }}>{KIND_LABEL[kind]}</b>
            <span style={{ minWidth: 200 }}>{x.label}</span>
            <span className={`chip ${/Gratis/.test(x.cost) ? 'ok' : ''}`}>{x.cost}</span>
            <span className="hint" style={{ flex: 1 }}>{x.message}{!x.ready && x.fix ? ` — ${x.fix}` : ''}</span>
          </div>
        ))}
      </div>
      <p className="hint" style={{ margin: '8px 0 0' }}>Los proveedores se eligen en «Ajustes» (botón «Usar configuración gratuita» para coste $0).</p>
    </div>
  );
}

function LocalServices() {
  const { data: piper, setData: setPiper } = useApi('/providers/piper');
  const [busy, run] = useAction();
  return (
    <div className="card section">
      <h2 className="section-title"><Server /> Servicios gratuitos y locales <span className="right">sin claves, sin créditos: se ejecutan en tu computador</span></h2>
      <div className="stack" style={{ gap: 16 }}>
        <div>
          <div className="row"><b>Piper — voz local</b><span className="chip ok">Gratis · sin límites · funciona en CPU</span>
            {piper?.installed ? <span className="chip ok"><Check /> Instalado · {piper.voices.length} voz/voces</span> : <span className="chip">No instalado</span>}
            <div className="spacer" />
            {!piper?.installed && <button className="btn sm gold" disabled={!!busy} onClick={() => run('piper', async () => setPiper(await api.post('/providers/piper/install')), 'Piper instalado')}>{busy === 'piper' ? <Spinner size={14} /> : <Download />} Instalar Piper (≈ 25 MB)</button>}
          </div>
          <p className="hint" style={{ margin: '4px 0 0' }}>Después descarga voces en español en «Voces» → Piper (cada voz se descarga una sola vez, 20–110 MB).</p>
        </div>
        <div>
          <div className="row"><b>ComfyUI — imágenes locales</b><span className="chip ok">Gratis · sin límites</span><span className="chip gold">Lento sin tarjeta gráfica NVIDIA</span></div>
          <ol className="hint" style={{ margin: '4px 0 0', paddingLeft: 18 }}>
            <li>Descarga «ComfyUI portable» para Windows desde <span className="kbd">github.com/comfyanonymous/ComfyUI/releases</span> y extráelo con 7-Zip.</li>
            <li>Descarga un modelo <span className="kbd">.safetensors</span> a <span className="kbd">ComfyUI\models\checkpoints</span>. Recomendados: <b>DreamShaper XL Lightning</b> (SDXL, 4–8 pasos, ≈7 GB; necesita GPU con 8 GB) o <b>DreamShaper 8</b> (SD 1.5, ≈2 GB; para equipos modestos o CPU). Ambos en <span className="kbd">huggingface.co/Lykon</span>.</li>
            <li>Ábrelo con <span className="kbd">run_nvidia_gpu.bat</span> (NVIDIA) o <span className="kbd">run_cpu.bat</span>. Debe quedar en <span className="kbd">http://127.0.0.1:8188</span>.</li>
            <li>En «Ajustes → Imágenes» elige ComfyUI y pulsa el preajuste de tu modelo. En CPU cada imagen puede tardar varios minutos.</li>
          </ol>
        </div>
        <div>
          <div className="row"><b>Ollama — guion y escenas con modelos locales</b><span className="chip ok">Gratis · sin límites</span></div>
          <ol className="hint" style={{ margin: '4px 0 0', paddingLeft: 18 }}>
            <li>Instálalo desde <span className="kbd">ollama.com/download</span> (o <span className="kbd">winget install Ollama.Ollama</span>).</li>
            <li>En PowerShell: <span className="kbd">ollama pull qwen2.5:7b</span> (≈4,7 GB, 8 GB de RAM o más) o <span className="kbd">ollama pull qwen2.5:3b</span> (≈2 GB, equipos modestos; peor calidad).</li>
            <li>En «Ajustes → Modelos de lenguaje» elige Ollama.</li>
          </ol>
        </div>
        <div>
          <div className="row"><b>Kokoro — voz local alternativa</b><span className="chip ok">Gratis · sin límites</span></div>
          <p className="hint" style={{ margin: '4px 0 0' }}>Necesita Docker Desktop. En PowerShell: <span className="kbd">docker run -d -p 8880:8880 ghcr.io/remsky/kokoro-fastapi-cpu:latest</span>. Voces en español: ef_dora, em_alex, em_santa. Después elige Kokoro en «Voces».</p>
        </div>
        <div>
          <div className="row"><b>Gemini y Groq — guion en la nube con cuota gratuita</b><span className="chip gold">Gratis con límites</span></div>
          <p className="hint" style={{ margin: '4px 0 0' }}>Crea la clave gratis (abajo) y elige el proveedor en Ajustes. Tienen límites de peticiones por minuto y por día: si se superan, espera y pulsa «Reanudar».</p>
        </div>
      </div>
    </div>
  );
}

// ---------------- Licencia ----------------
export function Licencia() {
  const { data: health } = useApi('/health');
  return (
    <div className="page prose">
      <div className="page-head"><div><h1 className="page-title">Licencia</h1><p className="page-sub">Licencia de esta aplicación y de los componentes que utiliza.</p></div></div>
      <div className="card section">
        <h2 className="section-title">Vimo</h2>
        <p>Aplicación construida desde cero: código, componentes, ilustraciones de las tarjetas y arquitectura propios. No incluye código, imágenes, videos ni recursos de la herramienta original de referencia.</p>
        <pre className="license">{`MIT License

Copyright (c) ${new Date().getFullYear()} Vimo

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.`}</pre>
      </div>
      <div className="card section">
        <h2 className="section-title">Componentes de terceros</h2>
        <ul>
          <li><b>FFmpeg</b> ({health?.ffmpeg || 'no detectado'}) — LGPL/GPL según la compilación instalada. Se usa como programa externo para el montaje y el render.</li>
          <li><b>React</b>, <b>Vite</b>, <b>Express</b>, <b>Multer</b>, <b>Lucide</b> — licencia MIT (Lucide: ISC).</li>
          <li><b>Anthropic SDK</b> — licencia MIT.</li>
        </ul>
        <h3>Contenido generado</h3>
        <p>Las imágenes, voces y música se generan con tus propias cuentas de OpenAI, Google, Replicate, Anthropic y ElevenLabs. Los derechos y condiciones de uso comercial (por ejemplo, en YouTube) dependen de los términos y del plan de cada proveedor. Revisa especialmente las condiciones de ElevenLabs para voces y música en tu plan.</p>
      </div>
    </div>
  );
}

// ---------------- Ajustes ----------------
const FREE = ' — GRATIS';
export const PAID = { llm_provider: ['anthropic', 'openai'], image_provider: ['openai', 'replicate'], tts_provider: ['openai'], music_provider: ['elevenlabs'] };
// [clave, etiqueta, opciones | 'models:proveedor' | 'textarea' | undefined, mostrar-si(valores)]
const FIELDS = [
  ['Modelos de lenguaje (guion, escenas y prompts)', [
    ['llm_provider', 'Proveedor', [['gemini', 'Google Gemini' + ' — gratis con límites'], ['groq', 'Groq — gratis con límites'], ['ollama', 'Ollama (local)' + FREE], ['anthropic', 'Anthropic (Claude) — de pago'], ['openai', 'OpenAI — de pago']]],
    ['gemini_llm_model', 'Modelo de Gemini', null, v => v.llm_provider === 'gemini'],
    ['groq_model', 'Modelo de Groq', 'models:groq', v => v.llm_provider === 'groq'],
    ['ollama_model', 'Modelo de Ollama', 'models:ollama', v => v.llm_provider === 'ollama'],
    ['ollama_url', 'Dirección de Ollama', null, v => v.llm_provider === 'ollama'],
    ['anthropic_model', 'Modelo de Claude', null, v => v.llm_provider === 'anthropic'],
    ['openai_llm_model', 'Modelo de OpenAI', null, v => v.llm_provider === 'openai'],
  ]],
  ['Imágenes', [
    ['image_provider', 'Proveedor', [['comfyui', 'ComfyUI (local)' + FREE], ['openai', 'OpenAI (gpt-image-1) — de pago'], ['gemini', 'Nano Banana (Gemini) — ≈0,04 US$/imagen, requiere facturación'], ['replicate', 'Replicate (FLUX) — de pago']]],
    ['comfyui_url', 'Dirección de ComfyUI', null, v => v.image_provider === 'comfyui'],
    ['comfyui_checkpoint', 'Modelo (checkpoint) — vacío = el primero', 'models:comfyui', v => v.image_provider === 'comfyui'],
    ['comfyui_steps', 'Pasos', null, v => v.image_provider === 'comfyui'],
    ['comfyui_cfg', 'CFG', null, v => v.image_provider === 'comfyui'],
    ['comfyui_sampler', 'Sampler', [['euler', 'euler'], ['euler_ancestral', 'euler_ancestral'], ['dpmpp_2m', 'dpmpp_2m'], ['dpmpp_sde', 'dpmpp_sde'], ['dpmpp_2m_sde', 'dpmpp_2m_sde'], ['lcm', 'lcm']], v => v.image_provider === 'comfyui'],
    ['comfyui_scheduler', 'Scheduler', [['normal', 'normal'], ['karras', 'karras'], ['sgm_uniform', 'sgm_uniform'], ['simple', 'simple'], ['exponential', 'exponential']], v => v.image_provider === 'comfyui'],
    ['comfyui_width', 'Ancho (16:9)', null, v => v.image_provider === 'comfyui'],
    ['comfyui_height', 'Alto (16:9)', null, v => v.image_provider === 'comfyui'],
    ['comfyui_negative', 'Prompt negativo', 'textarea', v => v.image_provider === 'comfyui'],
    ['comfyui_workflow', 'Flujo personalizado (opcional, JSON «Save (API Format)» con {{prompt}}, {{negative}}, {{seed}}, {{width}}, {{height}}, {{ref_image}})', 'textarea', v => v.image_provider === 'comfyui'],
    ['openai_image_model', 'Modelo de OpenAI', null, v => v.image_provider === 'openai'],
    ['openai_image_quality', 'Calidad OpenAI', [['low', 'Baja'], ['medium', 'Media'], ['high', 'Alta']], v => v.image_provider === 'openai'],
    ['gemini_image_model', 'Modelo Nano Banana', [['gemini-2.5-flash-image', 'Nano Banana (gemini-2.5-flash-image)'], ['gemini-3-pro-image-preview', 'Nano Banana Pro (gemini-3-pro-image-preview, más caro)']], v => v.image_provider === 'gemini'],
    ['replicate_model', 'Modelo Replicate (sin referencia)', null, v => v.image_provider === 'replicate'],
    ['replicate_ref_model', 'Modelo Replicate (con referencia)', null, v => v.image_provider === 'replicate'],
    ['image_concurrency', 'Imágenes en paralelo', [['1', '1'], ['2', '2'], ['3', '3'], ['4', '4'], ['6', '6']]],
  ]],
  ['Voz', [
    ['tts_provider', 'Proveedor por defecto', [['piper', 'Piper (local)' + FREE], ['kokoro', 'Kokoro (local)' + FREE], ['elevenlabs', 'ElevenLabs — plan gratis limitado / de pago'], ['openai', 'OpenAI TTS — de pago']]],
    ['kokoro_url', 'Dirección de Kokoro-FastAPI', null, v => v.tts_provider === 'kokoro'],
    ['elevenlabs_tts_model', 'Modelo de ElevenLabs', [['eleven_multilingual_v2', 'Multilingual v2'], ['eleven_turbo_v2_5', 'Turbo v2.5'], ['eleven_flash_v2_5', 'Flash v2.5'], ['eleven_v3', 'Eleven v3']], v => v.tts_provider === 'elevenlabs'],
    ['openai_tts_model', 'Modelo de OpenAI', [['gpt-4o-mini-tts', 'gpt-4o-mini-tts'], ['tts-1-hd', 'tts-1-hd'], ['tts-1', 'tts-1']], v => v.tts_provider === 'openai'],
    ['language', 'Idioma por defecto', [['es', 'Español'], ['en', 'English'], ['pt', 'Português'], ['fr', 'Français'], ['it', 'Italiano'], ['de', 'Deutsch']]],
  ]],
  ['Música', [
    ['music_provider', 'Música IA', [['local', 'Compositor local de Vimo' + FREE], ['elevenlabs', 'ElevenLabs Music — de pago']]],
    ['music_volume', 'Volumen de música por defecto (0–1)'],
    ['music_ducking', 'Bajar música cuando habla la voz', [['on', 'Sí'], ['off', 'No']]],
  ]],
  ['Video (FFmpeg, gratis y local)', [
    ['resolution', 'Resolución', [['1080p', '1080p'], ['720p', '720p']]],
    ['fps', 'Fotogramas por segundo', [['24', '24'], ['25', '25'], ['30', '30']]],
    ['transition', 'Transición entre escenas', [['fade', 'Fundido'], ['cut', 'Corte']]],
    ['camera_motion', 'Movimiento de cámara', [['on', 'Activado'], ['off', 'Desactivado']]],
    ['scene_padding', 'Pausa tras cada escena (s)'],
  ]],
];

function ModelInput({ provider, value, onChange }) {
  const [list, setList] = useState(null);
  useEffect(() => { api.get(`/providers/models?provider=${provider}`).then(setList).catch(() => setList([])); }, [provider]);
  const id = `dl-${provider}`;
  return (
    <>
      <input className="input" list={id} value={value} onChange={e => onChange(e.target.value)} placeholder={list?.length ? 'Elige o escribe…' : 'Sin conexión: escribe el nombre'} />
      <datalist id={id}>{(list || []).map(m => <option key={m} value={m} />)}</datalist>
      <span className="hint">{list == null ? 'Consultando…' : list.length ? `${list.length} disponibles en el servicio` : 'No se pudo obtener la lista (¿servicio apagado o sin clave?)'}</span>
    </>
  );
}

export function Ajustes() {
  const { data, setData } = useApi('/settings');
  const { data: health } = useApi('/health');
  const { data: info } = useApi('/providers/info');
  const [v, setV] = useState(null);
  const [busy, run] = useAction();
  if (!data) return <div className="page"><Spinner /></div>;
  const cur = v || data.values;
  const set = (key, val) => setV({ ...cur, [key]: val });
  return (
    <div className="page">
      <div className="page-head">
        <div><h1 className="page-title">Ajustes</h1><p className="page-sub">Proveedores, modelos y parámetros de montaje.</p></div>
        <div className="row">
          <button className="btn" disabled={!!busy} title="Análisis: Gemini · Imágenes: ComfyUI · Voz: Piper · Música: compositor local"
            onClick={() => run('free', async () => { setData(await api.post('/settings/free-preset')); setV(null); }, 'Configuración gratuita aplicada')}><Sparkles /> Usar configuración gratuita</button>
          <button className="btn gold" disabled={!v || !!busy} onClick={() => run('s', async () => { const r = await api.put('/settings', v); setData(r); setV(null); }, 'Ajustes guardados')}><Save /> Guardar ajustes</button>
        </div>
      </div>
      <div className="card section" style={{ borderColor: cur.free_only !== 'off' ? '#bfe3cc' : undefined }}>
        <h2 className="section-title"><Sparkles /> Modo gratuito
          <span className="right">{cur.free_only !== 'off' ? 'Activado' : 'Desactivado'}
            <button type="button" className={`toggle ${cur.free_only !== 'off' ? 'on' : ''}`} aria-label="Modo gratuito"
              onClick={() => run('fo', async () => { setData(await api.put('/settings', { free_only: cur.free_only !== 'off' ? 'off' : 'on' })); setV(null); })} /></span>
        </h2>
        <p className="hint" style={{ margin: 0 }}>{cur.free_only !== 'off'
          ? 'Vimo solo usa servicios gratuitos o locales. Los que piden saldo (Claude, OpenAI, Replicate y ElevenLabs Music) están ocultos y nunca se usan. Excepción: Nano Banana (Gemini Image) se puede elegir en Imágenes, indicando su coste por imagen.'
          : 'Los servicios de pago están visibles y pueden consumir saldo de tus cuentas.'}</p>
      </div>
      {FIELDS.map(([title, fields]) => (
        <div className="card section" key={title}>
          <h2 className="section-title">{title}</h2>
          {title === 'Imágenes' && cur.image_provider === 'comfyui' && info && (
            <div className="row" style={{ marginBottom: 12 }}>
              <span className="hint">Valores recomendados según tu modelo:</span>
              {Object.entries(info.comfy_presets).map(([id, pr]) => (
                <button key={id} className={`btn sm ${cur.comfyui_preset === id ? 'gold' : ''}`} disabled={!!busy}
                  onClick={() => run('p', async () => { setData(await api.post(`/settings/comfyui-preset/${id}`)); setV(null); })}>{pr.label}</button>
              ))}
            </div>
          )}
          <div className="grid3">
            {fields.filter(f => !f[3] || f[3](cur)).map(([key, label, opts]) => (
              <label className="field" key={key} style={opts === 'textarea' ? { gridColumn: '1 / -1' } : undefined}>{label}
                {Array.isArray(opts) ? <select className="select" value={cur[key]} onChange={e => set(key, e.target.value)}>{opts.filter(([a]) => cur.free_only === 'off' || !PAID[key]?.includes(a)).map(([a, b]) => <option key={a} value={a}>{b}</option>)}</select>
                  : opts === 'textarea' ? <textarea className="textarea" style={{ minHeight: 70, fontFamily: key === 'comfyui_workflow' ? 'ui-monospace, monospace' : undefined, fontSize: 12.5 }} value={cur[key]} onChange={e => set(key, e.target.value)} />
                    : typeof opts === 'string' && opts.startsWith('models:') ? <ModelInput provider={opts.slice(7)} value={cur[key]} onChange={val => set(key, val)} />
                      : <input className="input" value={cur[key]} onChange={e => set(key, e.target.value)} />}
              </label>
            ))}
          </div>
        </div>
      ))}
      <div className="card section">
        <h2 className="section-title"><Info /> Sistema</h2>
        <p className="hint" style={{ margin: 0 }}>FFmpeg: {health?.ffmpeg || '—'}<br />Carpeta de datos: <span className="kbd">{health?.data_dir}</span></p>
      </div>
    </div>
  );
}
