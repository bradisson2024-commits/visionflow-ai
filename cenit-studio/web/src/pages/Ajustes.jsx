import { useEffect, useState } from 'react';
import { api, useData, fileUrl } from '../lib/api.js';
import { Loading, Action, ErrorBox } from '../components/ui.jsx';

const SVC = [['youtube', 'YouTube Data API v3', 'YOUTUBE_API_KEY'], ['gemini', 'Google Gemini (texto, imágenes, voz y Veo)', 'GEMINI_API_KEY'], ['voces', 'Voces (Gemini, Microsoft Edge, ElevenLabs)', 'ELEVENLABS_API_KEY (opcional)'], ['ffmpeg', 'FFmpeg', 'FFMPEG_PATH']];

export default function Ajustes({ me, onChange }) {
  const { data: a, error, reload } = useData('/api/ajustes');
  const { data: styles, reload: reloadStyles } = useData('/api/estilos');
  const [tests, setTests] = useState({});
  const [pricing, setPricing] = useState(null);
  const [thr, setThr] = useState(null);
  const [rpm, setRpm] = useState(null);
  const [models, setModels] = useState(null);
  useEffect(() => { if (a) { setPricing(a.pricing); setThr(a.thresholds); setRpm(a.rpm); setModels(a.models); } }, [a]);
  if (error) return <ErrorBox error={error} />;
  if (!a || !pricing) return <Loading />;
  const admin = me?.user.isAdmin;
  return (
    <>
      <div className="page-head"><div><h1>Ajustes</h1><p className="sub">Servicios conectados, créditos, umbrales del Radar y estilos. Las claves se configuran en el servidor (.env) y nunca llegan al navegador.</p></div></div>
      <div className="card"><h2>Servicios</h2>
        <p className="dim">Autenticación: {a.auth === 'supabase' ? 'Supabase Auth' : 'cuentas locales (configura Supabase para producción)'} · Almacenamiento: {a.storage === 'supabase' ? 'Supabase Storage' : 'disco local del servidor'}</p>
        <table className="t"><tbody>{SVC.map(([k, name, env]) => (
          <tr key={k}><td><b>{name}</b><div className="dim">{env}</div></td>
            <td>{k === 'ffmpeg' ? <span className={`pill ${a.services.ffmpeg ? 'ok' : 'bad'}`}>{a.services.ffmpeg ? 'Instalado' : 'No encontrado'}</span> : k === 'voces' ? <span className="pill info">Edge sin clave{a.services.elevenlabs ? ' · ElevenLabs' : ''}</span> : <span className={`pill ${a.services[k] ? 'ok' : 'bad'}`}>{a.services[k] ? 'Clave configurada' : 'Falta la clave'}</span>}</td>
            <td><Action className="btn sm" busyText="Probando…" run={async () => { try { const r = await api(`/api/ajustes/probar/${k}`, { method: 'POST' }); setTests({ ...tests, [k]: r }); } catch (e) { setTests({ ...tests, [k]: { ok: false, detail: e.message } }); } }}>Probar conexión real</Action>
              {tests[k] && <div className="dim" style={{ color: tests[k].ok ? 'var(--ok)' : 'var(--bad)', marginTop: 4 }}>{tests[k].detail}</div>}</td></tr>
        ))}</tbody></table>
      </div>
      <div className="card"><h2>Créditos y tarifas</h2>
        <p className="dim">Coste real por unidad en USD de cada operación según tu proveedor. Revísalo con los precios vigentes. {admin ? '' : 'Sólo un administrador puede cambiarlo.'}</p>
        <label className="f" style={{ maxWidth: 280 }}>USD por crédito<input type="number" step="0.0001" value={pricing.usdPerCredit} disabled={!admin} onChange={(e) => setPricing({ ...pricing, usdPerCredit: Number(e.target.value) })} /></label>
        <table className="t" style={{ marginTop: 10 }}><thead><tr><th>Operación</th><th>USD por unidad</th><th>Créditos</th></tr></thead><tbody>{Object.entries(pricing.ops).map(([k, o]) => <tr key={k}><td>{o.label}<div className="dim">por {o.unit}</div></td><td><input type="number" step="0.0001" value={o.usd} disabled={!admin} style={{ width: 110 }} onChange={(e) => setPricing({ ...pricing, ops: { ...pricing.ops, [k]: { ...o, usd: Number(e.target.value) } } })} /></td><td>{Math.ceil(o.usd / pricing.usdPerCredit)}</td></tr>)}</tbody></table>
        {admin && <Action className="btn primary" run={async () => { await api('/api/ajustes', { method: 'PUT', body: { pricing } }); await reload(); onChange?.(); return 'Tarifas guardadas.'; }}>Guardar tarifas</Action>}
        {admin && <Recharge onChange={onChange} />}
      </div>
      <div className="card"><h2>Umbrales del Radar Viral</h2>
        <p className="dim">Cada categoría usa estos valores; los resultados explican qué cifras se compararon.</p>
        <div className="grid-sm">
          <label className="f">Antigüedad máx. para «viral» (días)<input type="number" value={thr.maxAgeViralDays} disabled={!admin} onChange={(e) => setThr({ ...thr, maxAgeViralDays: Number(e.target.value) })} /></label>
          {[['despegando', 'Despegando', [['maxAgeHours', 'Edad máx. (h)'], ['minViewsPerHour', 'Vistas/hora mín.'], ['minOutperformance', '× mediana canal']]], ['acelerado', 'Crecimiento acelerado', [['minAcceleration', 'Aceleración mín. (×)'], ['minViewsPerHour', 'Vistas/hora mín.']]], ['viral', 'Viral', [['minViews', 'Vistas mín.'], ['minOutperformance', '× mediana canal']]], ['extraordinario', 'Viral extraordinario', [['minViews', 'Vistas mín.'], ['minOutperformance', '× mediana canal']]], ['canalPequeno', 'Canal pequeño, vídeo gigante', [['maxSubscribers', 'Suscriptores máx.'], ['minViewsPerSub', 'Vistas/suscriptor mín.'], ['minViews', 'Vistas mín.']]], ['excepcional', 'Rendimiento excepcional', [['minOutperformance', '× mediana canal'], ['maxAgeDays', 'Edad máx. (días)']]], ['tendencia', 'Tendencia emergente', [['minVideos', 'Vídeos mín.'], ['minChannels', 'Canales mín.'], ['maxAgeDays', 'Edad máx. (días)']]]].map(([k, label, fields]) => (
            <div key={k} className="col" style={{ border: '1px solid var(--line)', borderRadius: 10, padding: 10 }}><b>{label}</b>{fields.map(([f, l]) => <label key={f} className="f">{l}<input type="number" step="any" value={thr[k][f]} disabled={!admin} onChange={(e) => setThr({ ...thr, [k]: { ...thr[k], [f]: Number(e.target.value) } })} /></label>)}</div>
          ))}
        </div>
        {admin && <Action className="btn primary" run={async () => { await api('/api/ajustes', { method: 'PUT', body: { thresholds: thr } }); return 'Umbrales guardados.'; }}>Guardar umbrales</Action>}
      </div>
      <div className="card"><h2>RPM para estimar ingresos</h2>
        <p className="dim">USD por 1.000 vistas (mínimo y máximo) por idioma. Sólo se usa para estimaciones, siempre señaladas como tales.</p>
        <div className="grid-sm">{Object.entries(rpm).map(([lang, [lo, hi]]) => <label key={lang} className="f">{lang}<div className="row"><input type="number" step="0.1" value={lo} disabled={!admin} style={{ width: 70 }} onChange={(e) => setRpm({ ...rpm, [lang]: [Number(e.target.value), hi] })} />–<input type="number" step="0.1" value={hi} disabled={!admin} style={{ width: 70 }} onChange={(e) => setRpm({ ...rpm, [lang]: [lo, Number(e.target.value)] })} /></div></label>)}</div>
        {admin && <Action className="btn primary" run={async () => { await api('/api/ajustes', { method: 'PUT', body: { rpm } }); return 'RPM guardado.'; }}>Guardar RPM</Action>}
      </div>
      <div className="card"><h2>Modelos de Gemini</h2>
        <div className="grid-sm">{Object.entries(models).map(([k, v]) => <label key={k} className="f">{k}<input value={v} disabled={!admin} onChange={(e) => setModels({ ...models, [k]: e.target.value })} /></label>)}</div>
        {admin && <Action className="btn primary" run={async () => { await api('/api/ajustes', { method: 'PUT', body: { models } }); return 'Modelos guardados.'; }}>Guardar modelos</Action>}
      </div>
      <div className="card"><h2>Imágenes de ejemplo de los estilos</h2>
        <p className="dim">Genera la imagen de ejemplo de cada estilo con tu proveedor (consume créditos de imagen).</p>
        <div className="grid">{styles?.map((s) => <div key={s.id} className="vcard"><div className="thumb">{s.sample_path ? <img src={fileUrl(s.sample_path)} alt="" /> : 'Sin ejemplo'}</div><div className="body"><b>{s.name}</b>{(admin || !s.builtin) && <Action className="btn sm" busyText="Generando…" run={async () => { await api(`/api/estilos/${s.id}/muestra`, { method: 'POST' }); await reloadStyles(); onChange?.(); return 'Ejemplo generado.'; }}>{s.sample_path ? 'Regenerar ejemplo' : 'Generar ejemplo'}</Action>}</div></div>)}</div>
      </div>
    </>
  );
}

function Recharge({ onChange }) {
  const [f, setF] = useState({ email: '', amount: 10000 });
  return (
    <div className="row" style={{ marginTop: 14 }}>
      <b>Recargar créditos</b>
      <input placeholder="correo del usuario (vacío = tú)" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
      <input type="number" value={f.amount} onChange={(e) => setF({ ...f, amount: Number(e.target.value) })} style={{ width: 120 }} />
      <Action className="btn" run={async () => { await api('/api/creditos/recargar', { method: 'POST', body: { email: f.email || undefined, amount: f.amount } }); onChange?.(); return 'Créditos añadidos.'; }}>Recargar</Action>
    </div>
  );
}
