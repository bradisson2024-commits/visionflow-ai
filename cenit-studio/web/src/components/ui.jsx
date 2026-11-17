import { createContext, useContext, useState, useCallback } from 'react';

const ToastCtx = createContext(() => {});
export function ToastProvider({ children }) {
  const [t, setT] = useState(null);
  const show = useCallback((msg, bad = false) => { setT({ msg, bad }); clearTimeout(window.__toast); window.__toast = setTimeout(() => setT(null), bad ? 8000 : 4000); }, []);
  return <ToastCtx.Provider value={show}>{children}{t && <div className={`toast ${t.bad ? 'bad' : ''}`} role="status">{t.msg}</div>}</ToastCtx.Provider>;
}
export const useToast = () => useContext(ToastCtx);

/** Botón que ejecuta una acción asíncrona, se desactiva mientras trabaja y muestra el error. */
export function Action({ run, children, className = 'btn', busyText, disabled, title }) {
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  return (
    <button className={className} disabled={busy || disabled} title={title}
      onClick={async () => { setBusy(true); try { const msg = await run(); if (typeof msg === 'string') toast(msg); } catch (e) { toast(e.message, true); } finally { setBusy(false); } }}>
      {busy ? busyText || 'Procesando…' : children}
    </button>
  );
}

export function Modal({ title, onClose, children, wide }) {
  return (
    <div className="modal-bg" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-label={title}>
        <div className="row between" style={{ marginBottom: 12 }}><h2 style={{ margin: 0 }}>{title}</h2><button className="btn ghost sm" onClick={onClose}>✕</button></div>
        {children}
      </div>
    </div>
  );
}

const STATE = { pendiente: ['Pendiente', ''], en_cola: ['En cola', 'run'], generando: ['Generando', 'run'], en_curso: ['En curso', 'run'], lista: ['Lista', 'ok'], hecho: ['Hecho', 'ok'], error: ['Error', 'bad'], cancelado: ['Cancelado', ''] };
export const Status = ({ s }) => <span className={`pill ${STATE[s]?.[1] || ''}`}>{STATE[s]?.[0] || s}</span>;

export function Empty({ children }) { return <div className="empty">{children}</div>; }
export function Loading() { return <p className="muted">Cargando…</p>; }
export function ErrorBox({ error }) { return error ? <div className="alert bad">{error}</div> : null; }
