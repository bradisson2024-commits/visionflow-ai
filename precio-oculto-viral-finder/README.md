# EL PRECIO OCULTO VIRAL FINDER

Herramienta web propia, construida desde cero, para el canal **EL PRECIO OCULTO**:

1. busca en YouTube los videos que están funcionando;
2. detecta cuáles son una oportunidad;
3. analiza el que elijas;
4. produce una versión **original y mejorada**: guion investigado con fuentes, ilustraciones Stickman estáticas con la mascota del detective, voz real, música y montaje MP4 verificado.

Es un proyecto independiente: no usa código, diseño ni base de datos de ningún otro proyecto del repositorio.

## Requisitos

- **Node.js 22.13 o superior** (incluye la base de datos SQLite que usa la app).
- **FFmpeg** con FFprobe en el PATH.
  - Windows: `winget install Gyan.FFmpeg`
  - macOS: `brew install ffmpeg`
  - Linux: `sudo apt install ffmpeg`
- **Google Chrome**, sólo si generas las imágenes con Google Flow.

## Instalar y ejecutar

```bash
cd precio-oculto-viral-finder
npm install
npm start
```

Abre **http://localhost:5730**. Los datos (base de datos, proyectos, música) se guardan en `data/`. Para usar otra carpeta, define `EPO_DATA_DIR`.

## Qué configurar (pantalla «Configuración»)

| Servicio | Para qué | Cómo conseguirlo | Coste |
|---|---|---|---|
| **YouTube Data API v3** (`YOUTUBE_API_KEY`) | Buscador, vistas, suscriptores, duración, fechas | console.cloud.google.com → nuevo proyecto → «APIs y servicios» → Biblioteca → *YouTube Data API v3* → Habilitar → Credenciales → Crear clave de API | Gratis, 10.000 unidades/día (una búsqueda ≈ 200) |
| **Google Gemini** (`GEMINI_API_KEY`) | Transcripción del video, análisis, investigación con Google Search, propuesta, guion, storyboard, revisión de imágenes, imágenes y voz | aistudio.google.com/apikey → *Create API key* | Texto y voz con nivel gratuito; el modelo de imagen puede requerir facturación activa |
| **Google Flow** (alternativa para imágenes) | Genera las imágenes con tu cuenta de Flow | Extensión de la carpeta `extension/` (ver abajo) | Según tu plan de Flow |
| **ElevenLabs** (opcional) | Voz alternativa | elevenlabs.io → clave de API y voz | De pago |
| **Microsoft Edge TTS** | Voz gratuita sin clave (`es-MX-JorgeNeural` y otras) | Nada que configurar | Gratis, servicio sin garantía |

Cada servicio tiene un botón **«Probar conexión real»** que hace una llamada de verdad y muestra el resultado; la voz se puede escuchar. Primera vez: en **Configuración → Mascota oficial** pulsa **«Guardar referencia»**. Esto rasteriza el dibujo oficial del detective, y esa imagen se envía a Gemini y a Flow con cada escena para que el personaje no cambie.

## Módulos

| # | Módulo | Dónde |
|---|---|---|
| 1 | Página principal | `web/js/views/inicio.js` |
| 2 | Panel de control (cuota real, servicios, proyectos, trabajos) | `views/panel.js`, `GET /api/panel` |
| 3 | Buscador de virales (YouTube Data API v3) | `server/services/youtube.js`, `server/modules/search.js` |
| 4 | Detección de oportunidades (fórmula pública 0–100) | `server/modules/opportunities.js` |
| 5 | Analizador del video (transcripción con Gemini o aportada; cada punto con cita comprobada) | `server/modules/analyzer.js` |
| 6 | Versión mejorada (investigación con Google Search + Wikipedia, ángulo, ganchos, estructura) | `server/modules/improver.js` |
| 7 | Guion de 8–10 min con fuentes `[n]`; cifras sin respaldo corregidas o eliminadas; bloqueo si copia frases del original | `server/modules/scriptwriter.js`, `textkit.js` |
| 8 | Imágenes Stickman estáticas (Gemini o Google Flow) con la mascota fija | `server/modules/images.js`, `mascot.js`, `extension/` |
| 9 | Voz real (Gemini TTS, ElevenLabs o Edge) | `server/services/voices.js` |
| 10 | Editor automático: una imagen por fragmento, sincronizada con su audio | `server/modules/timeline.js`, pestaña «Editor de escenas» |
| 11 | Exportador MP4 (FFmpeg) + verificación sobre el archivo real | `server/modules/exporter.js`, `verify.js` |
| 12 | Biblioteca de proyectos | `views/proyectos.js` |
| 13 | Historial de búsquedas | `views/historial.js` |
| 14 | Configuración de API y servicios | `views/configuracion.js`, `server/core/settings.js` |

**Arquitectura:**
- Node 22 sin frameworks (`server/app.js`) y base de datos SQLite propia (`server/db/schema.sql`).
- Cola de trabajos guardada en la base de datos (`server/core/jobs.js`): los trabajos interrumpidos se reanudan al reiniciar.
- Eventos en vivo por SSE.
- Interfaz de una sola página en `web/`.

## Flujo de un video

1. **Buscar** un tema. Cada resultado muestra su puntuación de oportunidad, el desglose de por qué la tiene y el botón **REPLICAR Y MEJORAR**. También se puede pegar un enlace directamente.
2. Se crea el proyecto y empieza la producción. La pestaña **Producción** muestra cada etapa y el registro en vivo:
   1. **Análisis del original**. Si Gemini no puede acceder a la narración, la app lo dice, marca los campos como «sin acceso» y permite pegar una transcripción autorizada.
   2. **Versión mejorada e investigación**. Si hay menos de 2 fuentes verificables, el proceso se detiene: no se escribe un guion sin fuentes.
   3. **Guion**. Toda oración con cifras debe citar una fuente existente; si no se puede respaldar, se corrige o se elimina, y se muestra la lista.
   4. **Escenas y storyboard**. Se comprueba que la suma de fragmentos reproduce el guion exacto.
   5. **Imágenes**. Con Gemini, automático. Con Flow, el proyecto queda en «Necesita tu acción» hasta que lleguen las imágenes.
   6. **Revisión**. Gemini mira cada imagen junto a su narración. Si no coincide, con Gemini se rehace sola (hasta 2 veces) y con Flow vuelve a la cola. Las imágenes casi idénticas se detectan con una huella perceptual.
   7. **Voz**. Un audio por escena; la imagen dura exactamente lo que dura su audio.
   8. **Montaje**:
      - cada imagen está fija y completa durante toda su narración;
      - los fundidos (0,3 s) ocurren sólo en las pausas;
      - la música baja bajo la voz (sidechain) y hay efectos en las revelaciones;
      - salida H.264 + AAC 1080p.
   9. **Verificación** sobre el MP4 real:
      - imágenes y audios completos, escenas aprobadas y orden correcto;
      - el MP4 se decodifica entero sin errores y tiene la duración prevista;
      - no hay pantallas negras (`blackdetect`);
      - un fotograma a mitad de cada narración se compara con su imagen;
      - las imágenes no se animan, hay voz en cada tramo y la voz queda al menos 12 dB por encima de la música.
3. **Descargar MP4** sólo se activa si la verificación pasa. La pestaña **Resultado** entrega el video, el guion con fuentes, el guion por escenas, la narración (MP3/WAV), la miniatura, el título y la descripción con fuentes. Las imágenes y audios por escena quedan en `data/proyectos/<proyecto>/`.

En el **Editor de escenas** puedes editar la narración de una escena (se rehace sólo su voz), rehacer una imagen indicando qué debe mostrar, o aprobarla a mano. Después pulsa «Producir video» y sólo se repite lo necesario.

## Imágenes con Google Flow

Flow no tiene API pública. La extensión **EPO · Conector Flow** trabaja dentro de tu sesión de Chrome:

1. Ve a `chrome://extensions`, activa el *Modo de desarrollador*, pulsa **Cargar descomprimida** y elige `precio-oculto-viral-finder/extension/`.
2. En el proyecto (pestaña Editor) elige **Google Flow**, o ponlo como motor predeterminado en Configuración. Pulsa «Producir video»: se detendrá esperando las imágenes.
3. Abre Google Flow (flow.google.com), entra en un proyecto y pulsa el icono de la extensión. Elige tu proyecto y pulsa **ENVIAR A FLOW**. Por cada escena pendiente, la extensión:
   - escribe el prompt;
   - adjunta la mascota oficial como referencia en la primera;
   - pulsa generar y espera la imagen nueva;
   - la envía a la app, que la guarda en su escena.
4. Vuelve a la app y pulsa «Producir video».

Si Flow pide iniciar sesión, muestra un CAPTCHA o dice que llegaste al límite de uso, la extensión se detiene y te lo indica; nunca intenta saltarse esas comprobaciones. Si Flow cambia su página y la extensión no encuentra el cuadro de prompt o el botón, también lo indica.

En ese caso puedes usar la alternativa manual: **Descargar prompts (TXT)** en el editor, generar en Flow a mano y luego **Importar imágenes** con nombres `escena_NNN`.

## Pruebas

```bash
npm test                 # módulos + flujo completo
npm run test:extension   # extensión real en Chromium (necesita Playwright)
```

- **Flujo completo** (`tests/flujo-completo.test.js`): recorre buscar → oportunidad → replicar → … → MP4 verificado → descarga, con Gemini y con Flow. YouTube, Gemini y Wikipedia se sustituyen por un **doble de pruebas** (`tests/fake-services.js`) que devuelve respuestas con su formato real. La base de datos, la cola, FFmpeg, el render y la verificación son reales.
- **Extensión** (`tests/extension.e2e.mjs`): carga la extensión de verdad y la hace trabajar contra `tests/flow-fixture.html`, una página de pruebas que no es Flow. Comprueba los prompts exactos, la referencia adjunta, la devolución de cada imagen a su escena y la detención ante un CAPTCHA.

Lo que estas pruebas **no** cubren, porque requieren tus cuentas: las respuestas reales de YouTube, Gemini y ElevenLabs, y la página real de Google Flow. Para eso están los botones «Probar conexión real» de Configuración.
