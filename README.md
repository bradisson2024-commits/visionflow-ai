# YOUTUBE AUTOMATIZADO

Aplicación independiente con dos herramientas:

1. **RaulitoShow IA**: automatizador de Google Flow. Es un panel lateral de Chrome que trabaja junto a Flow.
2. **Editor RaulitoShow IA**: tus imágenes + tu voz = tu video listo para YouTube (MP4 real con FFmpeg).

Está creada desde cero. No usa, importa ni depende de IMPERIO PRO ni de ningún otro proyecto, y no tiene dependencias npm.

---

## Versión para tablet (sin instalar nada)

`tablet/editor-tablet.html` es el **Editor RaulitoShow IA** en una sola página que funciona en Chrome de tablet o móvil:

- Crea el MP4 en el propio dispositivo con WebCodecs (H.264) y [mp4-muxer](https://www.npmjs.com/package/mp4-muxer) 5.1.3.
- El audio va en AAC, o en Opus si el dispositivo no codifica AAC.
- Los archivos no salen del dispositivo y no se guardan entre sesiones.
- Prueba: `YA_MP4MUXER=<ruta a mp4-muxer.js> node tests/e2e-tablet.js`.

RaulitoShow IA no tiene versión para tablet: Chrome para Android no admite extensiones.

## Arquitectura y por qué

| Parte | Tecnología | Motivo |
|---|---|---|
| `extension/` (RaulitoShow IA) | Extensión de Chrome (Manifest V3) con **panel lateral** y un *content script* en `labs.google/fx/…/tools/flow` | Flow no ofrece una API pública. Lo único real y autorizado es trabajar **dentro de la sesión del propio usuario**, en su navegador, con los mismos controles que usaría una persona. Así no se crea una copia falsa de Flow ni se eluden inicios de sesión o CAPTCHA. |
| `app/` (pantalla principal + Editor + almacenamiento) | Servidor local Node.js (solo `http` nativo, escucha únicamente en `127.0.0.1:5317`) + HTML/CSS/JS sin frameworks | Se necesitan archivos reales en disco, rutas visibles ("dónde se guardó") y FFmpeg nativo para generar MP4 de verdad. Node ya está en cualquier equipo de desarrollo y no hace falta instalar paquetes. |
| Exportación | **FFmpeg / FFprobe del sistema** | Genera H.264 + AAC real, con progreso real (`-progress`) y validación del archivo final. |

Comunicación entre herramientas: la extensión envía cada resultado descargado de Flow a la app (`POST /api/flow/save`). La app lo guarda en `proyectos/<proyecto>/flow/`, y el Editor lo carga con **"Usar resultados de RaulitoShow IA"**. Si la app no está en marcha, la extensión guarda en `Descargas/YOUTUBE_AUTOMATIZADO/<proyecto>/`.

```
app/
  server.js            servidor local + API
  lib/storage.js       proyectos en disco (nunca sobrescribe: añade " (2)")
  lib/media.js         FFmpeg/FFprobe
  lib/exporter.js      motor de exportación MP4 (9 pasos)
  public/              pantalla principal, Editor, página de RaulitoShow IA
extension/
  manifest.json, config.js
  sidepanel.*          panel RaulitoShow IA
  content.js           motor que actúa dentro de la página de Flow
  background.js        guardado de resultados (app o Descargas)
tests/                 pruebas unitarias, de API y E2E en Chromium real
```

Almacenamiento propio en `~/YOUTUBE_AUTOMATIZADO/proyectos/<id>/`, con las carpetas `imagenes/`, `audio/`, `texto/`, `flow/` y `exportaciones/`, más `project.json`. La ubicación se cambia con `YA_DATA_DIR`.

---

## Instalación y uso

Requisitos: **un ordenador** (Windows, Mac o Linux) con Node.js ≥ 18, FFmpeg + FFprobe en el PATH y Google Chrome de escritorio. No funciona en tablet ni móvil: Chrome para Android no admite extensiones y la app necesita FFmpeg.

- Windows: doble clic en `INICIAR_WINDOWS.bat`.
- Mac / Linux: `./iniciar_mac_linux.sh`.
- O en una terminal: `npm start` y abrir http://127.0.0.1:5317

**RaulitoShow IA**

1. En Chrome abre `chrome://extensions`, activa el *Modo de desarrollador*, pulsa **Cargar descomprimida** y elige `extension/`.
2. Abre Google Flow, inicia sesión y entra en un proyecto de Flow.
3. Pulsa el icono de la extensión: se abre el panel **RaulitoShow IA**.
4. Configura las secciones:
   - personaje de referencia
   - formato y x1–x4
   - prompts (uno por línea o desde un `.txt`), prefijo de estilo y escena inicial
   - ritmo seguro
   - guardar como escena_001…
   - confirmación automática
5. Pulsa **INICIAR**.

**Editor**: abre `http://127.0.0.1:5317/editor`, carga imágenes, audio y (opcionalmente) el texto, reparte las escenas, revísalas y pulsa **CREAR VIDEO MP4**.

---

## Cómo funciona cada control

### RaulitoShow IA

- **Personaje de referencia**: el botón `+` añade o reemplaza la imagen (PNG/JPG/WEBP). Se guarda en el almacenamiento de la extensión y se conserva entre sesiones. Antes de cada prompt, si el cuadro de Flow no tiene ya una imagen adjunta, la extensión la adjunta mediante el selector de archivos de Flow. Si no lo encuentra, se pausa y pide adjuntarla a mano.
- **16:9 / 9:16 / 1:1 / 4:3**: al iniciar, selecciona esa opción en los ajustes de Flow.
- **x1–x4**: es el **número de resultados por prompt** que genera Flow. Lo confirma la ayuda de Flow ("Number of outputs you want"), y fuentes de terceros documentan los valores 1–4. La extensión lo selecciona en Flow y espera ese número de resultados.
  - Si no consigue seleccionar un ajuste, se **pausa** y pide hacerlo a mano. Al reanudar, respeta lo que hayas elegido.
- **Modelo: el que tengas elegido en Flow**: no hay selector de modelo. Se usa el que esté elegido en Flow.
- **Prompts**: cada línea no vacía es una escena y el contador se actualiza al escribir o al subir el `.txt`. El **prefijo de estilo** se antepone al enviar (`"<prefijo> <prompt>"`) sin modificar el texto original.
- **Empezar en la escena N**: solo se envían las escenas desde N, con su número real.
- **Ritmo seguro (0–14 s)**: pausa real entre el final de una escena y el envío de la siguiente, con cuenta atrás visible.
- **Guardar como escena_001, escena_002...**: descarga cada resultado como `escena_NNN.ext`. Con x2–x4 se añaden `escena_NNN_2`, `_3`… Nunca sobrescribe. Si está desactivado, los resultados se quedan solo en Flow.
- **Confirmar automáticamente al agente de Flow**: si tras enviar aparece un botón de confirmación nuevo ("Confirmar", "Continue", "Generate"…), lo pulsa. Si la casilla está desactivada, avisa y espera a que confirmes tú en Flow.
- **INICIAR / Pausa**: la pausa termina la escena que está en proceso (ya enviada a Flow) y se detiene antes de la siguiente, sin perder el progreso. ▶ reanuda.
- **Progreso**: escenas completadas, barra y lista de escenas con su estado (Pendiente, En proceso, Completada, Error, En pausa). El **tiempo restante** solo se calcula con la duración real de las escenas ya completadas más el ritmo seguro. Antes de la primera escena muestra "—".
- **Intervención humana**: si detecta CAPTCHA, que Flow pide iniciar sesión o que falta el cuadro de prompts, **se detiene** y explica qué hacer. Nunca intenta resolverlo.

### Editor RaulitoShow IA

- **Tus imágenes**: puedes arrastrar o seleccionar una carpeta (sustituye la lista) o elegir imágenes sueltas (se añaden).
  - Se ordenan por nombre en orden natural (escena_2 va antes que escena_10).
  - Las que no se pueden decodificar y los archivos que no son imágenes se descartan con aviso.
  - Se **copian** al proyecto. Los originales no se tocan.
- **Tu audio**: MP3, WAV o M4A. Muestra el nombre, la duración real (medida con FFprobe), el reproductor y el estado.
- **Texto de escenas**: se puede arrastrar `escenas_narracion.txt`, elegir un archivo o pegar el texto. La línea N corresponde a la imagen N.
  - Acepta marcas de tiempo reales en formato SRT, VTT o `[mm:ss]` al inicio de línea.
  - El texto de la escena se muestra bajo el visor.
- **Repartir con el audio**:
  - con marcas de tiempo (una por imagen): usa los tiempos reales.
  - con texto sin marcas: hace un reparto **APROXIMADO** proporcional a la longitud de cada línea, y lo indica.
  - sin texto: reparto igual. La suma coincide exactamente con la duración del audio.
- **Todas duran [N] s + Aplicar a todas**: cambia todas las duraciones y recalcula las tarjetas, la línea de tiempo y el total.
- **Visor**: reproduce y pausa, con línea de tiempo arrastrable, barra de progreso, tiempo actual y total. El audio va sincronizado y el visor muestra el mismo encuadre y zoom que tendrá el MP4.
- **Galería**: aparece como "Escenas — X imágenes — duración". Cada tarjeta muestra la miniatura, el número, el inicio y la duración. Al hacer clic se marca con borde rojo y el visor salta a esa escena.
- **Movimiento suave (zoom lento)**: es un zoom digital de 1.00× a 1.08× sobre la imagen fija. **No** es animación generada por IA.
- **Calidad**: Full HD 1080p (recomendado) o HD 720p. La orientación sigue a la primera imagen (16:9, 9:16, 1:1 o 4:3) y las imágenes se ajustan sin recortes, con bandas negras si hace falta.
- **CREAR VIDEO MP4**: el progreso real de FFmpeg se muestra en 9 pasos:
  1. Validar las imágenes
  2. Validar el audio
  3. Comprobar las duraciones (avisa si no coinciden con el audio)
  4. Preparar las escenas
  5. Aplicar los efectos
  6. Incorporar el audio (AAC)
  7. Generar el MP4 (H.264, faststart)
  8. Validar el archivo con FFprobe (códecs, resolución, duración)
  9. Mostrar la ruta

  Al terminar, el video se puede reproducir y descargar desde la página. Se guarda en `proyectos/<id>/exportaciones/video_<fecha>.mp4`.

---

## Pruebas reales (`npm test`, `npm run test:e2e`)

| Prueba | Qué comprueba | Resultado |
|---|---|---|
| `tests/unit.test.js` (11) | Lectura de texto (líneas, SRT, `[mm:ss]`), reparto igual, aproximado y con marcas, tiempos y resolución de salida | ✅ |
| `tests/api.test.js` (4) | Proyectos, que no se sobrescriban archivos, duraciones reales de MP3/WAV/M4A, rechazo de audio falso, **exportación MP4 real** (H.264 1920×1080 + AAC, 180 fotogramas, decodificación completa sin errores, orden comprobado por el color de los píxeles), exportación en 720p sin zoom con aviso de duración, errores claros, originales intactos (SHA-256), puente Flow→proyecto, CORS solo para la extensión y bloqueo de rutas `../` | ✅ |
| `tests/e2e-editor.js` (Chromium) | Pantalla principal, carga de carpeta y de imágenes sueltas, Aplicar a todas, audio, `.txt`, reparto aproximado y con marcas, tarjeta con borde rojo y visor, reproducir/pausar/línea de tiempo, CREAR VIDEO MP4 (9 pasos, MP4 reproducido en el navegador), persistencia, "Usar resultados de RaulitoShow IA" y vista móvil | ✅ |
| `tests/e2e-extension.js` (extensión real en Chromium) | Panel conectado, personaje, 9:16/x2, `.txt` y contador, prefijo, escena inicial, validaciones, ritmo seguro ≥ N s medido, archivos `escena_002…005` (+`_2`) guardados en el proyecto, confirmación al agente, pausa sin envíos y reanudación sin repetir escenas, CAPTCHA → pausa con intervención humana, error → escena en Error y la cola sigue, guardado en Descargas sin la app | ✅ |

**Sobre la prueba de la extensión:** Google Flow necesita una cuenta de Google y no es accesible desde el entorno de pruebas (`labs.google` está bloqueado en la red del entorno de pruebas). Por eso el motor se probó con `tests/fixtures/flow-fixture.html`, que es una **página de pruebas** con la estructura básica de un cuadro de prompts. **No es Flow**, no forma parte de la app y solo se activa en una copia temporal de la extensión durante la prueba.

---

## Limitaciones conocidas (sin ocultar)

1. **No se ha probado contra Google Flow real.** La detección de los elementos de Flow es heurística y no se ha comprobado con la interfaz actual de Flow:
   - cuadro de prompts: `#PINHOLE_TEXT_AREA_ELEMENT_ID` o el área editable más grande
   - botón de generar: etiqueta "Generar", "Generate", "Create", "Send" o `arrow_forward`
   - selector de archivos
   - opciones `16:9` / `x2`
   - nuevas imágenes o videos ≥ 256 px

   Flow cambia su interfaz con frecuencia. La primera ejecución con una cuenta real puede requerir ajustar selectores en `extension/content.js`. Cuando algo no se encuentra, la extensión **se pausa y lo dice**: no inventa resultados.
2. **Confirmación al agente**: se basa en detectar un botón nuevo con texto de confirmación. No se ha podido comprobar qué texto exacto usa hoy el modo Agente de Flow.
3. **Descarga de resultados**: se descarga la URL del archivo que muestra Flow, que puede ser una vista previa, no siempre la máxima resolución que ofrece su menú "Descargar". Los videos de Veo se guardan si aparecen como `<video>`.
4. **Recargar Flow a mitad de una escena** pone la ejecución en pausa. Al reanudar, esa escena se envía de nuevo y podría duplicarse si Flow ya la había generado (el panel lo advierte).
5. **Sincronización con la narración**: no hay transcripción automática de voz a texto. Las marcas reales hay que aportarlas (SRT, VTT o `[mm:ss]`). Sin ellas, el reparto por texto es aproximado y se indica así.
6. **El audio es obligatorio para exportar** ("tus imágenes + tu voz").
7. La función de pausa no detiene una generación que Flow ya ha empezado: espera a que termine.

## Estado por etapas

- **Etapa 1 (app independiente)**: ✅ hecha y probada.
- **Etapa 2 (RaulitoShow IA)**: ✅ panel y motor probados en Chromium. ⏳ Pendiente la verificación con Flow real y una cuenta de Google (bloqueada por limitaciones externas del entorno).
- **Etapa 3 (Editor)**: ✅ hecha y probada, incluida la exportación MP4 real.
- **Etapa 4 (conexión entre herramientas)**: ✅ el puente extensión → proyecto → Editor está probado.
- **Etapa 5 (pruebas)**: ✅ ver la tabla anterior.
- **Independencia de IMPERIO PRO**: ✅ ningún archivo, import ni referencia (`grep -ri imperio` solo encuentra este README).
