import { useState } from 'react';
import { signIn } from '../lib/api.js';

export default function Login({ onDone }) {
  const [mode, setMode] = useState('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setMsg(null);
    try {
      const r = await signIn(email, password, mode === 'register');
      if (r.needsConfirm) setMsg({ ok: true, text: 'Te enviamos un correo para confirmar la cuenta. Confírmala e inicia sesión.' });
      else onDone();
    } catch (err) { setMsg({ ok: false, text: err.message }); }
    setBusy(false);
  };
  return (
    <div className="login">
      <form className="card col" onSubmit={submit}>
        <div className="brand" style={{ justifyContent: 'center' }}><img src="/logo.svg" alt="" />Cenit Studio</div>
        <p className="muted" style={{ textAlign: 'center', marginTop: -6 }}>Investiga YouTube y crea vídeos con IA.</p>
        {msg && <div className={`alert ${msg.ok ? 'ok' : 'bad'}`}>{msg.text}</div>}
        <label className="f">Correo<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" /></label>
        <label className="f">Contraseña<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} /></label>
        <button className="btn primary lg" disabled={busy}>{busy ? 'Un momento…' : mode === 'login' ? 'Iniciar sesión' : 'Crear cuenta'}</button>
        <button type="button" className="btn ghost" onClick={() => setMode(mode === 'login' ? 'register' : 'login')}>{mode === 'login' ? '¿No tienes cuenta? Crear una' : 'Ya tengo cuenta'}</button>
      </form>
    </div>
  );
}
