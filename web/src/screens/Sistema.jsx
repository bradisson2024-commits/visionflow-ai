import { useState } from 'react';
import { KeyRound, Check, X, ExternalLink, PlayCircle, AlertTriangle, Save, Info } from 'lucide-react';
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
  const { data: keys } = useApi('/keys');
  const has = id => keys?.find(k => k.id === id)?.configured;
  const need = [
    ['Análisis del guion', ['anthropic', 'openai', 'gemini'], 'Anthropic, OpenAI o Gemini'],
    ['Imágenes', ['openai', 'gemini', 'replicate'], 'OpenAI, Gemini o Replicate'],
    ['Voz IA', ['elevenlabs', 'openai'], 'ElevenLabs u OpenAI'],
    ['Música IA (opcional)', ['elevenlabs'], 'ElevenLabs'],
  ];
  return (
    <div className="page prose">
      <div className="page-head"><div><h1 className="page-title">Demo</h1><p className="page-sub">Cómo funciona Vimo, paso a paso, con un guion de ejemplo.</p></div></div>
      <div className="card section">
        <h2 className="section-title"><KeyRound /> Servicios conectados</h2>
        {!keys ? <Spinner /> : need.map(([label, ids, names]) => (
          <div key={label} className="row" style={{ padding: '4px 0' }}>
            {ids.some(has) ? <Check color="var(--ok)" size={16} /> : <X color="var(--danger)" size={16} />}
            <b style={{ minWidth: 170 }}>{label}</b><span className="hint">{names}</span>
          </div>
        ))}
        {keys && !need.slice(0, 3).every(([, ids]) => ids.some(has)) && <div className="alert warn" style={{ marginTop: 10 }}><AlertTriangle /><div>Faltan claves para generar un video completo. <button className="btn sm" onClick={() => navigate('/claves')}>Configurar claves API</button></div></div>}
      </div>
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
  const [vals, setVals] = useState({});
  const [tests, setTests] = useState({});
  const [busy, run] = useAction();
  return (
    <div className="page">
      <div className="page-head"><div><h1 className="page-title">Claves API</h1><p className="page-sub">Conecta los servicios de IA que usará Vimo. Las claves se guardan solo en tu servidor (base de datos local) y nunca se muestran completas.</p></div></div>
      {!keys ? <Spinner /> : (
        <div className="stack">
          {keys.map(k => (
            <div className="card section" key={k.id} style={{ marginBottom: 0 }}>
              <div className="row">
                <b style={{ fontSize: 15 }}>{k.label}</b>
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
const FIELDS = [
  ['Modelos de lenguaje (análisis del guion)', [
    ['llm_provider', 'Proveedor', [['anthropic', 'Anthropic (Claude)'], ['openai', 'OpenAI'], ['gemini', 'Google Gemini']]],
    ['anthropic_model', 'Modelo de Claude'], ['openai_llm_model', 'Modelo de OpenAI'], ['gemini_llm_model', 'Modelo de Gemini'],
  ]],
  ['Imágenes', [
    ['image_provider', 'Proveedor', [['openai', 'OpenAI (gpt-image-1)'], ['gemini', 'Google Gemini Image'], ['replicate', 'Replicate (FLUX)']]],
    ['openai_image_model', 'Modelo de OpenAI'], ['openai_image_quality', 'Calidad OpenAI', [['low', 'Baja'], ['medium', 'Media'], ['high', 'Alta']]],
    ['gemini_image_model', 'Modelo de Gemini'], ['replicate_model', 'Modelo Replicate (sin referencia)'], ['replicate_ref_model', 'Modelo Replicate (con referencia)'],
    ['image_concurrency', 'Imágenes en paralelo', [['1', '1'], ['2', '2'], ['3', '3'], ['4', '4'], ['6', '6']]],
  ]],
  ['Voz', [
    ['tts_provider', 'Proveedor por defecto', [['elevenlabs', 'ElevenLabs'], ['openai', 'OpenAI TTS']]],
    ['elevenlabs_tts_model', 'Modelo de ElevenLabs', [['eleven_multilingual_v2', 'Multilingual v2'], ['eleven_turbo_v2_5', 'Turbo v2.5'], ['eleven_flash_v2_5', 'Flash v2.5'], ['eleven_v3', 'Eleven v3']]],
    ['openai_tts_model', 'Modelo de OpenAI', [['gpt-4o-mini-tts', 'gpt-4o-mini-tts'], ['tts-1-hd', 'tts-1-hd'], ['tts-1', 'tts-1']]],
    ['language', 'Idioma por defecto', [['es', 'Español'], ['en', 'English'], ['pt', 'Português'], ['fr', 'Français'], ['it', 'Italiano'], ['de', 'Deutsch']]],
  ]],
  ['Video', [
    ['resolution', 'Resolución', [['1080p', '1080p'], ['720p', '720p']]],
    ['fps', 'Fotogramas por segundo', [['24', '24'], ['25', '25'], ['30', '30']]],
    ['transition', 'Transición entre escenas', [['fade', 'Fundido'], ['cut', 'Corte']]],
    ['camera_motion', 'Movimiento de cámara', [['on', 'Activado'], ['off', 'Desactivado']]],
    ['scene_padding', 'Pausa tras cada escena (s)'],
  ]],
  ['Audio', [
    ['music_volume', 'Volumen de música por defecto (0–1)'],
    ['music_ducking', 'Bajar música cuando habla la voz', [['on', 'Sí'], ['off', 'No']]],
  ]],
];

export function Ajustes() {
  const { data, setData } = useApi('/settings');
  const { data: health } = useApi('/health');
  const [v, setV] = useState(null);
  const [busy, run] = useAction();
  if (!data) return <div className="page"><Spinner /></div>;
  const cur = v || data.values;
  return (
    <div className="page">
      <div className="page-head">
        <div><h1 className="page-title">Ajustes</h1><p className="page-sub">Proveedores, modelos y parámetros de montaje.</p></div>
        <button className="btn gold" disabled={!v || !!busy} onClick={() => run('s', async () => { const r = await api.put('/settings', v); setData(r); setV(null); }, 'Ajustes guardados')}><Save /> Guardar ajustes</button>
      </div>
      {FIELDS.map(([title, fields]) => (
        <div className="card section" key={title}>
          <h2 className="section-title">{title}</h2>
          <div className="grid3">
            {fields.map(([key, label, opts]) => (
              <label className="field" key={key}>{label}
                {opts ? <select className="select" value={cur[key]} onChange={e => setV({ ...cur, [key]: e.target.value })}>{opts.map(([a, b]) => <option key={a} value={a}>{b}</option>)}</select>
                  : <input className="input" value={cur[key]} onChange={e => setV({ ...cur, [key]: e.target.value })} />}
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
