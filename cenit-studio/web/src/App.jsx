import { useEffect, useState } from 'react';
import { Routes, Route, NavLink, Navigate, useLocation } from 'react-router-dom';
import { loadAuthConfig, token, api, signOut, connectEvents, refreshFileToken, useLive, fmt } from './lib/api.js';
import Login from './pages/Login.jsx';
import CrearVideo from './pages/CrearVideo.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Proyectos from './pages/Proyectos.jsx';
import Editor from './pages/Editor.jsx';
import Voces from './pages/Voces.jsx';
import Musica from './pages/Musica.jsx';
import Ayuda from './pages/Ayuda.jsx';
import Ajustes from './pages/Ajustes.jsx';
import RadarViral from './pages/RadarViral.jsx';
import RadarCanales from './pages/RadarCanales.jsx';
import AnalisisCanal from './pages/AnalisisCanal.jsx';
import Semanal from './pages/Semanal.jsx';

const NAV = [['/crear', '＋', 'Crear vídeo'], ['/dashboard', '▦', 'Dashboard'], ['/proyectos', '▤', 'Proyectos'], ['/voces', '🎙', 'Voces'], ['/musica', '♪', 'Música'], ['/ayuda', '?', 'Ayuda'], ['/ajustes', '⚙', 'Ajustes']];
const RESEARCH = [['/radar-viral', '📈', 'Radar Viral'], ['/radar-canales', '📡', 'Radar de Canales'], ['/canales', '🔎', 'Análisis de canales'], ['/semanal', '🗓', 'Investigación semanal']];

function Credits({ me }) {
  if (!me) return null;
  return (
    <div className="credits">
      <div className="dim">Créditos disponibles</div>
      <b>{fmt(me.credits)}</b>
      <details>
        <summary>Consumo por operación</summary>
        <table><tbody>{Object.entries(me.pricing.ops).map(([k, o]) => <tr key={k}><td>{o.label}</td><td>{Math.ceil(o.usd / me.pricing.usdPerCredit)} / {o.unit}</td></tr>)}</tbody></table>
      </details>
    </div>
  );
}

export default function App() {
  const [ready, setReady] = useState(false);
  const [authed, setAuthed] = useState(false);
  const [me, setMe] = useState(null);
  const [open, setOpen] = useState(false);
  const loc = useLocation();

  const refreshMe = async () => { try { setMe(await api('/api/me')); } catch { /* sesión caducada */ } };
  useEffect(() => { (async () => { await loadAuthConfig(); const t = await token(); if (t) { setAuthed(true); await refreshFileToken(); await connectEvents(); await refreshMe(); } setReady(true); })(); }, []);
  useEffect(() => { const h = () => { setAuthed(false); setMe(null); }; window.addEventListener('cenit:logout', h); return () => window.removeEventListener('cenit:logout', h); }, []);
  useEffect(() => setOpen(false), [loc.pathname]);
  useLive((e) => { if (e.type === 'job' && ['hecho', 'error'].includes(e.job?.status)) refreshMe(); });

  if (!ready) return null;
  if (!authed) return <Login onDone={async () => { setAuthed(true); await refreshFileToken(); await connectEvents(); await refreshMe(); }} />;

  return (
    <div className="layout">
      <button className="btn hamb" onClick={() => setOpen(!open)} aria-label="Menú">☰</button>
      <aside className={`side ${open ? 'open' : ''}`}>
        <div className="brand"><img src="/logo.svg" alt="" />Cenit Studio</div>
        <nav className="nav">
          {NAV.map(([to, ico, label]) => <NavLink key={to} to={to}><span className="ico">{ico}</span>{label}</NavLink>)}
          <div className="nav-title">Investigación YouTube</div>
          {RESEARCH.map(([to, ico, label]) => <NavLink key={to} to={to}><span className="ico">{ico}</span>{label}</NavLink>)}
        </nav>
        <Credits me={me} />
        <div className="row between dim" style={{ padding: '6px 4px' }}><span>{me?.user.email}</span><button className="btn ghost sm" onClick={async () => { await signOut(); setAuthed(false); }}>Salir</button></div>
      </aside>
      <main>
        <Routes>
          <Route path="/" element={<Navigate to="/crear" replace />} />
          <Route path="/crear" element={<CrearVideo me={me} />} />
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/proyectos" element={<Proyectos />} />
          <Route path="/proyectos/:id" element={<Editor onCredits={refreshMe} />} />
          <Route path="/voces" element={<Voces />} />
          <Route path="/musica" element={<Musica />} />
          <Route path="/ayuda" element={<Ayuda />} />
          <Route path="/ajustes" element={<Ajustes me={me} onChange={refreshMe} />} />
          <Route path="/radar-viral" element={<RadarViral />} />
          <Route path="/radar-canales" element={<RadarCanales />} />
          <Route path="/canales" element={<AnalisisCanal />} />
          <Route path="/semanal" element={<Semanal />} />
          <Route path="*" element={<Navigate to="/crear" replace />} />
        </Routes>
      </main>
    </div>
  );
}
