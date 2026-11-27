import { useEffect, useState, useCallback } from 'react';
import { Clapperboard, Library, Users, Puzzle, UserCircle, Mic, Music, PlayCircle, KeyRound, BadgeCheck, Settings } from 'lucide-react';
import CrearVideo from './screens/CrearVideo.jsx';
import Proyecto from './screens/Proyecto.jsx';
import Biblioteca from './screens/Biblioteca.jsx';
import Personajes from './screens/Personajes.jsx';
import { Extension, Avatares, Voces, MusicaIA } from './screens/Media.jsx';
import { Demo, ClavesAPI, Licencia, Ajustes } from './screens/Sistema.jsx';

// Módulos del panel lateral, en el orden de la herramienta de referencia.
const NAV = [
  ['crear', 'Crear Video', Clapperboard],
  ['biblioteca', 'Biblioteca', Library],
  ['personajes', 'Personajes', Users],
  ['extension', 'Extensión', Puzzle],
  ['avatares', 'Avatares', UserCircle],
  ['voces', 'Voces', Mic],
  ['musica', 'Música IA', Music],
  ['demo', 'Demo', PlayCircle],
  ['claves', 'Claves API', KeyRound],
  ['licencia', 'Licencia', BadgeCheck],
  ['ajustes', 'Ajustes', Settings],
];

const parse = () => (window.location.hash.replace(/^#\/?/, '') || 'crear').split('/');

export default function App() {
  const [route, setRoute] = useState(parse);
  const [prefill, setPrefill] = useState(null);
  useEffect(() => {
    const on = () => setRoute(parse());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  const navigate = useCallback((path, data) => {
    setPrefill(data || null);
    window.location.hash = path;
    window.scrollTo(0, 0);
  }, []);
  const [page, arg] = route;
  const activeNav = page === 'proyecto' ? 'biblioteca' : page;

  let screen;
  switch (page) {
    case 'crear': screen = <CrearVideo key={arg || (prefill ? 'demo' : 'new')} projectId={arg} navigate={navigate} prefill={prefill} />; break;
    case 'proyecto': screen = <Proyecto key={arg} id={arg} navigate={navigate} />; break;
    case 'biblioteca': screen = <Biblioteca navigate={navigate} />; break;
    case 'personajes': screen = <Personajes />; break;
    case 'extension': screen = <Extension navigate={navigate} />; break;
    case 'avatares': screen = <Avatares />; break;
    case 'voces': screen = <Voces />; break;
    case 'musica': screen = <MusicaIA />; break;
    case 'demo': screen = <Demo navigate={navigate} />; break;
    case 'claves': screen = <ClavesAPI />; break;
    case 'licencia': screen = <Licencia />; break;
    case 'ajustes': screen = <Ajustes />; break;
    default: screen = <CrearVideo navigate={navigate} />;
  }

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-logo"><svg width="16" height="16" viewBox="0 0 24 24"><path d="M7 4l13 8-13 8z" fill="#f5b800" /></svg></div>
          <div className="brand-text"><div className="brand-name">Vimo</div><div className="brand-tag">Videos con IA en un clic.</div></div>
        </div>
        <nav className="nav">
          {NAV.map(([id, label, Icon], i) => (
            <div key={id}>
              {i === 7 && <div className="nav-sep" />}
              <button className={`nav-item ${activeNav === id ? 'active' : ''}`} onClick={() => navigate('/' + id)} title={label}><Icon /><span>{label}</span></button>
            </div>
          ))}
        </nav>
        <div className="sidebar-foot">v1.0</div>
      </aside>
      <main className="main">{screen}</main>
    </div>
  );
}
