import VoicePicker from '../components/VoicePicker.jsx';

export default function Voces() {
  return (
    <>
      <div className="page-head"><div><h1>Voces</h1><p className="sub">Catálogo real de tus proveedores conectados. Escucha una vista previa antes de elegirla en un proyecto (pestaña Voz).</p></div></div>
      <div className="card"><VoicePicker onSettings={() => {}} /></div>
    </>
  );
}
