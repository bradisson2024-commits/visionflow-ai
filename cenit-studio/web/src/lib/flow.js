// Conexión con Google Flow mediante la extensión de Chrome «Cenit · Flow» (carpeta extension-flow).
// La extensión escribe cada prompt (en inglés) en Flow con la sesión del usuario y sube cada imagen a su escena
// o personaje. Sin la extensión: se copian los prompts y se abre Flow para hacerlo a mano.
import { useEffect } from 'react';
import { api, token } from './api.js';

export const FLOW_URL = 'https://labs.google/fx/tools/flow';
export const flowInstalled = () => document.documentElement.dataset.cenitFlow === '1';

export async function sendToFlow(p, { sceneIds = [], charIds = [] }) {
  const { items } = await api(`/api/proyectos/${p.id}/flow`, { method: 'POST', body: { sceneIds, charIds } });
  if (flowInstalled()) {
    window.postMessage({ source: 'cenit', type: 'flow:run', base: location.origin, token: await token(), items }, location.origin);
    return `${items.length === 1 ? 'Enviado' : `${items.length} imágenes enviadas`} a Google Flow. Deja abiertas las dos pestañas: cada imagen aparecerá aquí al terminar.`;
  }
  const text = items.map((i) => (items.length > 1 ? `${i.label}:\n${i.prompt}` : i.prompt)).join('\n\n');
  let copied = true;
  try { await navigator.clipboard.writeText(text); } catch { copied = false; }
  window.open(FLOW_URL, '_blank', 'noopener');
  if (!copied) window.prompt('Copia el prompt y pégalo en Flow:', text);
  return 'Prompt en inglés copiado y Flow abierto: pégalo con Ctrl + V. Instala la extensión «Cenit · Flow» para que se haga solo.';
}

/** Escucha el avance que envía la extensión y recarga el proyecto cuando llega cada imagen. */
export function useFlowProgress(reload, toast) {
  useEffect(() => {
    const on = (e) => {
      if (e.source !== window || e.data?.source !== 'cenit-ext' || e.data.type !== 'flow:progress') return;
      const d = e.data;
      if (d.message) toast(d.message, d.status === 'error');
      if (d.status === 'lista') reload();
    };
    window.addEventListener('message', on);
    return () => window.removeEventListener('message', on);
  }, [reload, toast]);
}
