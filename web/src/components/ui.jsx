import { createContext, useContext, useState, useCallback } from 'react';
import { X, Loader2, CheckCircle2, AlertTriangle, Clock, Ban, Film, PencilLine } from 'lucide-react';

const ToastCtx = createContext(() => {});
export function ToastProvider({ children }) {
  const [items, setItems] = useState([]);
  const push = useCallback((msg, kind = 'ok') => {
    const id = Math.random();
    setItems(x => [...x, { id, msg, kind }]);
    setTimeout(() => setItems(x => x.filter(i => i.id !== id)), kind === 'err' ? 7000 : 3500);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts">{items.map(t => <div key={t.id} className={`toast ${t.kind}`}>{t.msg}</div>)}</div>
    </ToastCtx.Provider>
  );
}
export const useToast = () => useContext(ToastCtx);

/** Ejecuta una acción asíncrona mostrando el error en un aviso. */
export function useAction() {
  const toast = useToast();
  const [busy, setBusy] = useState(null);
  const run = useCallback(async (key, fn, okMsg) => {
    setBusy(key);
    try { const r = await fn(); if (okMsg) toast(okMsg); return r; }
    catch (e) { toast(e.message, 'err'); return undefined; }
    finally { setBusy(null); }
  }, [toast]);
  return [busy, run];
}

export function Modal({ title, onClose, children, width }) {
  return (
    <div className="overlay" onMouseDown={e => e.target === e.currentTarget && onClose()}>
      <div className="card modal" style={width ? { width } : undefined}>
        <div className="modal-head"><h3>{title}</h3><button className="icon-btn" onClick={onClose} aria-label="Cerrar"><X /></button></div>
        {children}
      </div>
    </div>
  );
}

export const Toggle = ({ on, onChange, label }) => (
  <button type="button" className={`toggle ${on ? 'on' : ''}`} onClick={() => onChange(!on)} aria-pressed={on} aria-label={label} />
);

export function Seg({ value, options, onChange }) {
  return (
    <div className="seg">
      {options.map(o => <button type="button" key={o.value} className={value === o.value ? 'on' : ''} onClick={() => onChange(o.value)}>{o.label}</button>)}
    </div>
  );
}

export const Spinner = ({ size = 16 }) => <Loader2 className="spin" style={{ width: size, height: size }} />;

const STATUS = {
  draft: { label: 'Borrador', cls: '', icon: PencilLine },
  processing: { label: 'Generando', cls: 'run', icon: Loader2 },
  storyboard: { label: 'Storyboard', cls: 'gold', icon: Film },
  done: { label: 'Terminado', cls: 'ok', icon: CheckCircle2 },
  outdated: { label: 'Cambios sin renderizar', cls: 'gold', icon: Clock },
  failed: { label: 'Error', cls: 'err', icon: AlertTriangle },
  canceled: { label: 'Cancelado', cls: '', icon: Ban },
};
export function StatusChip({ status, job }) {
  const s = job ? STATUS.processing : STATUS[status] || STATUS.draft;
  const Icon = s.icon;
  return <span className={`chip ${s.cls}`}><Icon className={job ? 'spin' : ''} />{s.label}</span>;
}

export function Empty({ icon: Icon, children }) {
  return <div className="empty">{Icon && <Icon />}<div>{children}</div></div>;
}
