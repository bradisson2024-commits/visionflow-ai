import { api, esc } from '../app.js';

export async function inicio(view) {
  const d = await api('/api/panel');
  const missing = [];
  if (!d.services.youtube) missing.push('la clave de YouTube (para buscar)');
  if (!d.services.gemini) missing.push('la clave de Gemini (análisis, guion, imágenes y revisión)');
  if (!d.services.mascot) missing.push('la imagen de referencia de la mascota');
  view.innerHTML = `
  <section class="hero">
    <div>
      <h1>EL PRECIO OCULTO · Viral Finder</h1>
      <p>Encuentra en YouTube los videos que están explotando, detecta cuáles son una oportunidad para tu canal y conviértelos en un video <b>original</b> de El Precio Oculto: investigado con fuentes, ilustrado con Stickman estáticos, narrado y montado en MP4.</p>
      <form id="quick" class="row" style="margin-top:14px">
        <input class="grow" name="q" placeholder="¿Qué negocio oculto quieres investigar? Ej.: por qué el cine es tan caro" required>
        <button class="gold big">Buscar virales</button>
      </form>
    </div>
    <img src="/img/detective.svg" alt="El Detective del Precio Oculto">
  </section>
  ${missing.length ? `<div class="alert a-warn">Para que todo funcione falta: ${missing.map(esc).join(', ')}. <a href="#/configuracion">Ir a Configuración</a>.</div>` : ''}
  <div class="card">
    <h2>Cómo funciona</h2>
    <div class="steps">
      <div><b>Busca</b> un tema: la app consulta YouTube en tiempo real.</div>
      <div><b>Elige</b> una oportunidad: cada video trae su puntuación y el porqué.</div>
      <div><b>Replica y mejora</b>: análisis del original, investigación con fuentes y propuesta propia.</div>
      <div><b>Guion</b> de 8–10 min con cada cifra respaldada por una fuente.</div>
      <div><b>Escenas</b>: una imagen Stickman por fragmento de narración, con la mascota fija.</div>
      <div><b>Voz y montaje</b>: narración real, música y MP4 sincronizado.</div>
      <div><b>Verificación</b>: el MP4 sólo se entrega si pasa todas las comprobaciones.</div>
    </div>
  </div>`;
  view.querySelector('#quick').addEventListener('submit', (e) => {
    e.preventDefault();
    sessionStorage.setItem('epo.q', new FormData(e.target).get('q'));
    location.hash = '#/buscar';
  });
}
