# El Precio Oculto · Viral Finder — Módulo 13

**Replicador inteligente de videos virales y generador de videos terminados.**

Encuentras un video que funciona, pulsas **«REPLICAR Y MEJORAR»** y la herramienta produce un video **original** para EL PRECIO OCULTO: guion nuevo investigado con fuentes, ilustraciones Stickman estáticas (una por fragmento de narración), voz real en español latino, música y montaje con FFmpeg, y una verificación final antes de dejarte descargar el MP4.

No copia el video original: estudia su tema, su estructura y lo que despierta curiosidad, y escribe un guion propio. La herramienta mide cuánto texto literal comparte con el original y bloquea el guion si se parece demasiado.

## Puesta en marcha

Requisitos: **Node 20+** y **FFmpeg** (con `ffprobe`) en el PATH.

```bash
cd el-precio-oculto
npm install
cp .env.example .env      # añade tus claves (todas opcionales salvo YouTube para el buscador)
npm start                 # abre http://localhost:8790
```

En Windows: instala FFmpeg (`winget install Gyan.FFmpeg`), abre una terminal nueva y ejecuta lo mismo con `copy .env.example .env`.

La pestaña **Configuración** muestra qué servicio está conectado y qué falta, con el motivo.

## Servicios (todos reales; si falta uno, se indica)

| Función | Servicio | Clave | Sin la clave |
|---|---|---|---|
| Buscador y datos del video (vistas, fecha, duración) | YouTube Data API v3 | `YOUTUBE_API_KEY` (gratis) | No hay buscador; pegando un enlace sólo se obtienen título, canal y miniatura (oEmbed), y se indica qué falta |
| Transcripción del original | Gemini procesa el video público | `GEMINI_API_KEY` (gratis) | Debes pegar o subir una transcripción autorizada (.txt/.srt/.vtt); si no, el análisis narrativo se marca «sin acceso» |
| Análisis, guion, plan visual | Gemini / Claude / Pollinations | opcional | Pollinations (gratis, sin clave; 1 respuesta cada 45 s) |
| Investigación con fuentes | Wikipedia (es/en) + Google Search vía Gemini (o búsqueda web de Claude) | opcional | Sólo Wikipedia |
| Imágenes Stickman | **Google Flow** (por defecto), con tu cuenta y la extensión de `extension-flow/`. Alternativas: Gemini Imagen o Pollinations | — (usa tu sesión de Flow) | Sin la extensión: descarga el TXT de prompts y luego importa las imágenes `escena_NNN`. Pollinations anónimo sólo ofrece el modelo «sana», que en pruebas no produjo Stickman |
| Revisión automática narración↔imagen | Gemini o Claude con visión | `GEMINI_API_KEY` | Revisión **manual**: apruebas cada imagen viendo la narración al lado |
| Voz | Microsoft Edge neural TTS (`es-MX-JorgeNeural`, gratis) · ElevenLabs · Gemini TTS | opcional | Edge TTS (servicio gratuito no oficial; si deja de responder, se muestra el error) |
| Montaje y verificación | FFmpeg local | — | Imprescindible |
| Música | Tus pistas en `assets/music/` | — | Se compone una pista ambiental original con FFmpeg y se avisa en el informe |

## Imágenes con Google Flow

Flow no tiene API pública. Las imágenes se generan dentro de tu sesión de Chrome con la extensión **RaulitoShow IA** (versión adaptada en `extension-flow/`). La extensión escribe cada prompt en Flow, espera el resultado y lo envía a la app, que lo coloca en su escena.

1. Chrome → `chrome://extensions` → activa el *Modo de desarrollador* → **Cargar descomprimida** → elige `el-precio-oculto/extension-flow/`. Si ya tenías la versión de YOUTUBE AUTOMATIZADO, ésta es otra extensión aparte: apunta a esta app (puerto 8790).
2. Arranca la app (`npm start`) y pulsa **GENERAR VIDEO COMPLETO**. Cuando llega a «Imágenes», la app se detiene con el aviso «Esperando imágenes de Google Flow».
3. Abre Google Flow, entra en un proyecto y abre el panel de la extensión. En **0. Proyecto de El Precio Oculto**, elige el proyecto y pulsa **CARGAR ESCENAS DEL PROYECTO** → **INICIAR**:
   - la primera vez genera la **hoja de personajes** (`escena_000`);
   - vuelve a pulsar CARGAR: se adjunta la hoja como personaje de referencia y se cargan las escenas pendientes con su número real, más la miniatura (`escena_900`).
4. Cada imagen vuelve sola a `imagenes/escena_NNN.png` (normalizada a 1920×1080). Al terminar, pulsa **GENERAR VIDEO COMPLETO** en la app.

Para corregir escenas:

- Si la revisión de coherencia marca una imagen o pulsas **«Pedir otra a Flow»**, esa escena vuelve a la cola. La corrección propuesta se añade a su prompt, y al pulsar CARGAR otra vez sólo se envían las pendientes.
- Sin extensión (por ejemplo, con el marcador de tablet): usa **Descargar prompts para Flow (TXT)**, donde la línea N es la escena N. Después importa las descargas `escena_NNN.png` desde la página del proyecto.
- Las variantes x2–x4 (`escena_NNN_2`…) se guardan en `flow/` sin sustituir la principal.

Prueba de extremo a extremo: `npm run test:e2e` carga la extensión real en Chromium. Como Google Flow necesita cuenta, el motor trabaja contra una página de pruebas que imita su cuadro de prompts (`tests/fixtures/flow-fixture.html`, no es Flow). La prueba comprueba la hoja de personajes, las escenas con su número real, la referencia adjunta, la miniatura y la regeneración de una sola escena.

## Flujo del Módulo 13

1. **Datos del video**: título, descripción, canal, fecha, vistas, duración, miniatura. Los campos que no se pueden obtener aparecen como «no disponible».
2. **Análisis del original**: tema, gancho, problema, promesa, estructura, desarrollo, momentos de curiosidad, datos usados, conclusión y miniatura. Cada punto lleva una **cita literal de la transcripción**, y la herramienta comprueba que la cita existe. Sin transcripción, esos campos se marcan «sin acceso»: la herramienta no finge haber visto el video.
3. **Investigación**: fuentes reales numeradas (F1, F2…). Si hay menos de 2 fuentes, el proceso se detiene para no inventar datos.
4. **Guion nuevo** (8–10 min, unas 1.200–1.500 palabras): gancho, introducción directa, revelaciones progresivas, gran revelación y conclusión. Cada oración con una cifra debe citar una fuente que exista. Las que no tienen respaldo se corrigen o se eliminan, y se listan en el proyecto.
5. **Escenas**: el guion se divide en fragmentos de 10–30 palabras. Se comprueba que la suma de fragmentos reproduce el guion exacto. Cada fragmento recibe su propia descripción visual, basada sólo en lo que dice ese fragmento.
6. **Imágenes Stickman** (con Google Flow por defecto): hoja de personajes fija (El Investigador: sombrero amarillo y bufanda roja, más los secundarios). El estilo es siempre el mismo: 2D a mano, contornos negros, fondo crema, rojo y amarillo, sin texto ni 3D. Cada escena usa una semilla fija.
7. **Coherencia**: una IA con visión mira cada imagen junto a su narración y le da una nota. Si no la representa, la imagen se regenera sola (hasta 2 veces) con la corrección. Las imágenes casi idénticas se detectan con huella perceptual y se regeneran. Lo que no se resuelve queda marcado para corregir a mano.
8. **Voz**: un audio por escena, con lo que la duración de cada imagen sale exactamente de su propio audio. Si la relación palabras/segundo es imposible, el audio se trata como cortado y se reintenta.
9. **Montaje FFmpeg**: cada imagen permanece fija y completa durante toda su narración. El fundido (0,35 s) ocurre sólo en la pausa entre frases. La música baja automáticamente bajo la voz (sidechain) y los efectos suenan en las transiciones. Salida 1920×1080, 30 fps, H.264 + AAC, `faststart`.
10. **Verificación**, sobre los archivos reales: imágenes y audios completos, coherencia aprobada, línea de tiempo correcta, MP4 decodificado entero sin errores, duración prevista, `blackdetect` sin negros, **un fotograma a mitad de cada narración comparado con su imagen** (detecta imágenes fuera de orden), voz audible en cada tramo, margen voz–música ≥ 12 dB y ausencia de animación. El proyecto sólo pasa a **Terminado**, y **DESCARGAR MP4** sólo se activa, si todo esto se cumple.

## Resultado

En `projects/<id>/`:

- `salida/video.mp4`, `salida/guion.md` (con fuentes), `salida/guion_por_escenas.md`, `salida/narracion.mp3`/`.wav`, `salida/miniatura.png`, `salida/titulo.txt`, `salida/descripcion.txt` (con fuentes), `salida/fuentes.md`, `salida/linea_de_tiempo.json`
- `imagenes/escena_NNN.png` + `imagenes/personajes.png`
- `audio/escena_NNN.wav`
- `escenas/escena_NNN.json`: narración, imagen, prompt, duración y resultado de la revisión de cada escena
- Botón «Descargar proyecto completo (ZIP)»

## Corregir escenas

En la ficha del proyecto puedes, escena por escena:

- editar la narración (se regenera sólo esa voz);
- regenerar la imagen describiendo qué debe verse;
- aprobar una imagen o marcarla para corregir.

Después pulsa **GENERAR VIDEO COMPLETO** y se repite sólo lo necesario.

## Pruebas

```bash
npm test
```

Las pruebas cubren la división en escenas, la verificación de datos, la línea de tiempo y un montaje real con FFmpeg. Ese montaje usa imágenes y tonos generados como datos de prueba y comprueba que la verificación lo aprueba. También comprueba que la verificación **falla** si las imágenes se montan desordenadas, si la música tapa la voz o si hay escenas sin aprobar.

## Avisos

- Las ilustraciones representan las marcas de forma genérica (sin logotipos exactos).
- Edge TTS y Pollinations sin token son servicios gratuitos con límites. Cuando fallan, el paso queda en «error» con el mensaje del servicio y puedes repetirlo.
