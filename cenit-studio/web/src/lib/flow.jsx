// Google Flow: el botón «Flow» sólo abre Flow; «Prompt en inglés» entrega el prompt (estilo y reparto incluidos,
// traducido al inglés) para pegarlo en Flow. La imagen resultante se sube con «Subir imagen».
import { useState } from 'react';
import { api } from './api.js';
import { Action, Modal, useToast } from '../components/ui.jsx';

export const FLOW_URL = 'https://flow.google.com/';
export const openFlow = () => window.open(FLOW_URL, '_blank', 'noopener');

export function FlowButton({ className = 'btn sm flow', children = 'Flow' }) {
  return <button type="button" className={className} title="Abre Google Flow en una pestaña nueva" onClick={openFlow}>{children}</button>;
}

async function copy(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch { return false; }
}

/** Botón que muestra el prompt en inglés (uno o varios) con su botón «Copiar». Con uno solo, además lo copia directamente. */
export function PromptButton({ p, sceneIds = [], charIds = [], className = 'btn sm', children = 'Prompt en inglés', disabled }) {
  const [items, setItems] = useState(null);
  const toast = useToast();
  return (
    <>
      <Action className={className} disabled={disabled} busyText="Preparando…" title="Muestra el prompt en inglés para pegarlo en Google Flow" run={async () => {
        const r = await api(`/api/proyectos/${p.id}/flow`, { method: 'POST', body: { sceneIds, charIds } });
        setItems(r.items);
        if (r.items.length === 1 && await copy(r.items[0].prompt)) return 'Prompt en inglés copiado: pégalo en Google Flow con Ctrl + V.';
      }}>{children}</Action>
      {items && (
        <Modal wide title={items.length === 1 ? `Prompt en inglés · ${items[0].label}` : `Prompts en inglés (${items.length})`} onClose={() => setItems(null)}>
          <p className="dim">Copia el prompt, pégalo en Google Flow (Ctrl + V), genera la imagen, descárgala y súbela con «Subir imagen» en {items.length === 1 ? (items[0].kind === 'personaje' ? 'el personaje' : 'la escena') : 'cada escena o personaje'}.</p>
          <div className="row" style={{ marginBottom: 10 }}><FlowButton className="btn primary flow">Abrir Google Flow</FlowButton></div>
          <div className="col" style={{ gap: 12, maxHeight: '60vh', overflow: 'auto' }}>
            {items.map((it) => (
              <div key={it.id} className="col" style={{ gap: 6 }}>
                <div className="row between"><b>{it.label}</b><button type="button" className="btn sm" onClick={async () => toast(await copy(it.prompt) ? `${it.label}: prompt copiado.` : 'No se pudo copiar: selecciona el texto y pulsa Ctrl + C.', false)}>Copiar</button></div>
                <textarea readOnly rows={items.length === 1 ? 8 : 4} value={it.prompt} onFocus={(e) => e.target.select()} />
                {!it.translated && <span className="dim">No se pudo traducir ahora mismo (límite de Gemini): se muestra el texto original.</span>}
              </div>
            ))}
          </div>
        </Modal>
      )}
    </>
  );
}
