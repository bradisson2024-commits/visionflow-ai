const FAQ = [
  ['¿Cómo creo un vídeo?', 'Pulsa «Crear vídeo», elige una de las cuatro modalidades (Guion, Idea, URL o Audio), el formato y el estilo visual. En el editor: genera o pega el guion, pulsa «Dividir guion en escenas», confirma el reparto, genera las imágenes, la voz, ajusta subtítulos y música, y exporta en la pestaña Edición.'],
  ['¿Cómo mantengo igual a un personaje en todas las escenas?', 'En «Casting y Referencias» confirma al personaje, revisa su descripción y vestimenta y genera o sube una imagen de referencia. Esa imagen se envía al generador en cada escena donde aparece.'],
  ['¿Por qué una imagen no coincide con la narración?', 'Abre «Prompt Img» en esa escena, corrige lo que debe verse y pulsa «Guardar y regenerar esta imagen»: sólo se regenera esa escena.'],
  ['¿Qué diferencia hay entre animar con Veo y el movimiento de cámara?', 'Veo (IA, consume créditos) anima personajes, objetos, cámara y entorno a partir de la imagen. El movimiento de cámara (gratis) sólo acerca la cámara sobre la imagen fija; no mueve a los personajes.'],
  ['¿Cómo se calculan los créditos?', '1 crédito equivale por defecto a 0,001 USD de coste del proveedor. Cada operación se cobra según la tarifa configurada en Ajustes (revisa los precios vigentes de tus proveedores). Si una operación falla, se reembolsa.'],
  ['¿Qué significa cada categoría del Radar Viral?', 'Despegando: vídeo de pocas horas con muchas vistas por hora y por encima de lo habitual de su canal. Crecimiento acelerado: su velocidad medida entre capturas aumenta. Viral / Viral extraordinario: muchas vistas en los últimos 30 días y muy por encima de la mediana del canal. Canal pequeño con vídeo gigante: muchas más vistas que suscriptores. Rendimiento excepcional: muy por encima de la mediana del canal. Tendencia emergente: el mismo tema rinde en varios canales a la vez. Los umbrales se configuran en Ajustes y cada resultado explica sus cifras.'],
  ['¿Por qué la velocidad dice «sin dos capturas»?', 'YouTube no publica la evolución de las vistas. Cenit guarda una captura cada vez que consulta un vídeo; con dos o más (pulsa «Nueva captura» pasado un tiempo) mide la velocidad real en vistas por hora.'],
  ['¿Cenit sabe si un canal está monetizado?', 'Sólo con evidencia. YouTube no publica el estado del Programa de Socios de otros canales y ver anuncios no demuestra que el creador cobre. A = confirmada con una fuente que registras tú; B = señales públicas (enlace de membresías, promociones pagadas declaradas); C = potencial según requisitos y estimaciones con hipótesis visibles.'],
  ['¿Los ingresos estimados son reales?', 'No: son una estimación (vistas recientes × un RPM supuesto por idioma, configurable). Los ingresos reales sólo los conoce el creador.'],
  ['¿Se copian los vídeos de referencia?', 'No. «Desde URL» y «Crear vídeo inspirado» analizan la estructura, el gancho y el ritmo para proponer una idea propia; el guion, las imágenes, la voz y la música son nuevos.'],
  ['¿Qué necesito configurar?', 'En el servidor: YOUTUBE_API_KEY (Google Cloud), GEMINI_API_KEY (Google AI Studio; la generación de imágenes y Veo pueden requerir facturación), y opcionalmente ELEVENLABS_API_KEY. Las voces de Microsoft Edge funcionan sin clave. Consulta el estado en Ajustes.'],
];

export default function Ayuda() {
  return (
    <>
      <div className="page-head"><div><h1>Ayuda</h1><p className="sub">Cómo funciona Cenit Studio.</p></div></div>
      {FAQ.map(([q, a]) => <details key={q} className="card"><summary style={{ cursor: 'pointer', fontWeight: 700 }}>{q}</summary><p className="muted" style={{ marginBottom: 0 }}>{a}</p></details>)}
    </>
  );
}
