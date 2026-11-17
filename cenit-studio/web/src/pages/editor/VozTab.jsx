import { api, fileUrl } from '../../lib/api.js';
import { Action, Status } from '../../components/ui.jsx';
import VoicePicker from '../../components/VoicePicker.jsx';

export default function VozTab({ p, reload, patch }) {
  const uploaded = p.voice?.engine === 'audio_subido';
  const ready = p.scenes.filter((s) => s.audio_status === 'lista').length;
  return (
    <>
      {uploaded ? <div className="alert info">Este proyecto usa la narración que subiste. «Generar audio» la reparte por escenas según sus tiempos reales.</div> : (
        <div className="card">
          <h2>Catálogo de voces</h2>
          {p.voice?.voiceId ? <p>Voz seleccionada: <b>{p.voice.name || p.voice.voiceId}</b> ({p.voice.provider}) · {Number(p.voice.speed || 1).toFixed(2)}×</p> : <p className="muted">Elige una voz para la narración.</p>}
          <VoicePicker value={p.voice} onPick={(v) => patch({ voice: v })} onSettings={(s) => p.voice?.voiceId && patch({ voice: { ...p.voice, ...s } })} />
        </div>
      )}
      <div className="card">
        <div className="row between">
          <h2 style={{ margin: 0 }}>Narración por escenas</h2>
          <div className="row"><span className="dim">{ready}/{p.scenes.length} listas</span>
            <Action className="btn primary" disabled={!p.scenes.length || (!uploaded && !p.voice?.voiceId)} busyText="En cola…" run={async () => { await api(`/api/proyectos/${p.id}/voz`, { method: 'POST', body: {} }); await reload(); return 'Generando la voz…'; }}>Generar audio</Action>
          </div>
        </div>
        <p className="dim">Cada escena dura lo que dura su voz: imagen y narración quedan sincronizadas al montar.</p>
        <table className="t"><thead><tr><th>#</th><th>Narración</th><th>Audio</th><th>Estado</th><th /></tr></thead><tbody>
          {p.scenes.map((s) => (
            <tr key={s.id}>
              <td>{s.idx}</td><td style={{ maxWidth: 420 }}>{s.narration}{s.audio_error && <div className="dim" style={{ color: 'var(--bad)' }}>{s.audio_error}</div>}</td>
              <td>{s.audio_path ? <audio controls preload="none" src={fileUrl(s.audio_path)} style={{ height: 34 }} /> : '—'}{s.audio_sec ? <div className="dim">{s.audio_sec.toFixed(1)} s</div> : null}</td>
              <td><Status s={s.audio_status} /></td>
              <td>{!uploaded && <Action className="btn sm" disabled={!p.voice?.voiceId} run={async () => { await api(`/api/proyectos/${p.id}/voz`, { method: 'POST', body: { sceneIds: [s.id] } }); await reload(); }}>Regenerar fragmento</Action>}</td>
            </tr>
          ))}
        </tbody></table>
      </div>
    </>
  );
}
