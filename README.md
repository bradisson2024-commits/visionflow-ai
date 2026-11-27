# Vimo — Videos con IA en un clic.

Aplicación web para crear videos narrados para YouTube a partir de un guion:
análisis del guion → escenas → storyboard → personajes consistentes → imágenes →
voz IA → música IA → montaje → **MP4 real** renderizado con FFmpeg.

## Requisitos

- Node.js ≥ 22.13 (usa el módulo nativo `node:sqlite`)
- FFmpeg y FFprobe en el `PATH` (o variables `FFMPEG_PATH` / `FFPROBE_PATH`)
- Claves API de los servicios de IA (ver abajo)

## Instalación en Windows (lo más fácil)

1. Abre **PowerShell** e instala los requisitos (una sola vez):
   ```powershell
   winget install OpenJS.NodeJS.LTS
   winget install Gyan.FFmpeg
   winget install Git.Git
   ```
   Cierra PowerShell y ábrelo de nuevo para que reconozca los programas.
2. Descarga el proyecto:
   ```powershell
   cd $HOME\Documents
   git clone -b ccr-5398ef42-txl1e4 https://github.com/bradisson2024-commits/visionflow-ai.git
   ```
3. Abre la carpeta `Documents\visionflow-ai` y haz doble clic en **`iniciar-vimo.bat`**.
   La primera vez instala y compila (unos minutos); luego abre http://127.0.0.1:5180.
   **No cierres esa ventana negra** mientras uses Vimo: es el servidor.

## Instalación y arranque (cualquier sistema)

```bash
npm run install:all   # dependencias del servidor y de la interfaz
npm run build         # compila la interfaz (web/dist)
npm start             # http://127.0.0.1:5180
```

Desarrollo: `npm run dev` (servidor) + `npm run dev:web` (Vite en :5173 con proxy).
Variables opcionales: `PORT`, `HOST`, `VIMO_DATA_DIR` (por defecto `./data`).

## Usar Vimo gratis (coste $0)

En **Ajustes → «Usar configuración gratuita»** se eligen solo proveedores gratuitos. En **Claves API** el panel
«Servicios que usará Vimo» comprueba de verdad cada servicio y dice qué falta. Antes de cada generación se
hace la misma comprobación: si algo no responde, el proceso no empieza y se indica qué activar.

| Parte | Proveedor gratuito | Límites | Cómo activarlo |
|---|---|---|---|
| Guion, títulos, escenas y prompts | **Ollama** (local) | Sin límites; velocidad según tu equipo | Instalar `ollama.com/download` → `ollama pull qwen2.5:7b` (o `qwen2.5:3b` en equipos modestos) |
| | **Gemini** (nube) | Cuota gratuita con límites por minuto/día | Clave gratis en AI Studio |
| | **Groq** (nube) | Cuota gratuita con límites por minuto/día | Clave gratis en console.groq.com |
| Imágenes | **ComfyUI** (local) | Sin límites; **lento sin GPU NVIDIA** (minutos por imagen en CPU) | ComfyUI portable + un modelo `.safetensors` en `models/checkpoints` (p. ej. DreamShaper 8 para SD 1.5 o DreamShaper XL Lightning para SDXL) |
| Voz | **Piper** (local) | Sin límites, funciona en CPU | Botón «Instalar Piper» y descargar una voz en «Voces» |
| | **Kokoro** (local) | Sin límites | `docker run -d -p 8880:8880 ghcr.io/remsky/kokoro-fastapi-cpu:latest` |
| Música | **Compositor local de Vimo** | Sin límites; música instrumental sencilla, original y sin derechos de terceros | Nada que instalar |
| Montaje y render | **FFmpeg** | Sin límites | Ya requerido por Vimo |

Para ComfyUI, la consistencia de personajes se consigue con la misma ficha visual en todas sus escenas y una
semilla estable por proyecto. Con un flujo personalizado que use `{{ref_image}}` (por ejemplo IPAdapter) Vimo
sube además la imagen de referencia del personaje.

**Verificado en pruebas (`npm run test:free`):** instalación y síntesis real con Piper (voz en español),
composición real de música local, render real con FFmpeg y todo el flujo de la interfaz. **No verificado con
modelos reales** (no hay red hacia Hugging Face/Ollama ni GPU en el entorno de pruebas): Ollama, ComfyUI,
Kokoro, Gemini y Groq se probaron contra su protocolo de API (ComfyUI con validación del grafo enviado).

## Claves API

Se introducen en **Claves API** dentro de la app (se guardan en la base de datos local,
nunca se devuelven completas) o como variables de entorno. Con **Probar conexión** se hace una llamada real.

| Servicio | Variable | Para qué | Mínimo necesario |
|---|---|---|---|
| Anthropic (Claude) | `ANTHROPIC_API_KEY` | Analizar el guion, dividir en escenas, escribir guiones (modelo por defecto `claude-opus-5-5`) | Una de Anthropic / OpenAI / Gemini |
| OpenAI | `OPENAI_API_KEY` | Imágenes `gpt-image-1` (con imágenes de referencia de personaje), voz TTS, análisis opcional | Una de OpenAI / Gemini / Replicate para imágenes |
| Google Gemini | `GEMINI_API_KEY` | Imágenes Gemini Image (con referencias), análisis opcional | |
| Replicate | `REPLICATE_API_TOKEN` | Imágenes FLUX 1.1 Pro; FLUX Kontext Pro cuando hay referencia de personaje | |
| ElevenLabs | `ELEVENLABS_API_KEY` | Voces de tu cuenta (con muestras) y **Música IA** | ElevenLabs u OpenAI para la voz |

Configuración mínima recomendada: **Anthropic + OpenAI + ElevenLabs**. Los proveedores y modelos se eligen en **Ajustes**.

## Arquitectura

```
web/ (React + Vite)                 server/src/ (Node + Express)
  App.jsx  panel lateral (11 módulos)  index.js        API REST, SSE /api/events, /media
  screens/ Crear Video, Proyecto,      db.js           SQLite: proyectos, escenas, personajes,
           Biblioteca, Personajes,                     referencias, avatares, música, trabajos, ajustes
           Extensión, Avatares, Voces, jobs.js         cola de tareas largas con progreso REAL persistido
           Música IA, Demo, Claves,    styles.js       catálogo de 38 estilos
           Licencia, Ajustes           providers/      llm.js · image.js · audio.js (TTS y música) · http.js (reintentos)
  components/ Catalog, StylePreview,   pipeline/       analyze.js · produce.js (orquestación) · render.js (FFmpeg)
              VoiceList, ui
```

**Por qué esta tecnología:** Node permite una sola pila (JS) para backend e interfaz; SQLite guarda todo
de forma real y sin servidor externo (adecuado para una herramienta de escritorio con claves propias, sin multiusuario,
por eso no hay sistema de autenticación); FFmpeg es el estándar para producir H.264/AAC; SSE transmite el progreso sin dependencias.

### Cómo se genera un video

1. **Analizar** – el guion se divide localmente en frases numeradas; el modelo decide cómo agruparlas en escenas
   (rangos de frases). Así la narración de cada escena es *exactamente* el texto del guion, sin pérdidas ni reescrituras.
2. **Escenas** – cada una con número, narración, descripción visual, personajes, acción, lugar, emoción, encuadre,
   movimiento de cámara, iluminación, prompt de imagen y duración estimada.
3. **Storyboard** – opción «Revisar storyboard»: el proceso se detiene para revisar/editar antes de generar imágenes.
4. **Personajes** – se detectan y guardan en «Personajes» con una ficha visual fija; se genera una imagen de referencia
   por personaje y estilo, que se adjunta (junto con la ficha) a cada escena donde aparece.
5. **Imágenes** – una por escena, en paralelo, con el bloque de estilo idéntico en todas. Si alguna falla no se rellena con
   otra: el trabajo se detiene con el error y se puede reanudar.
6. **Voz** – narración escena por escena (con contexto anterior/siguiente en ElevenLabs); cada escena dura lo que su voz.
7. **Música** – ElevenLabs Music a la medida del video o pista propia; volumen bajo la voz por *sidechain ducking*.
8. **Montaje** – cada imagen se convierte en un clip con movimiento de cámara suave y fundido, en el orden de la narración.
9. **Render** – mezcla final a MP4 (H.264 + AAC, `faststart`), 1080p/720p, 16:9, 9:16 o 1:1.
10. **Resultado** – reproducción en la app, descarga del MP4, archivos del proyecto y miniatura en Biblioteca.

Las etapas son idempotentes: al reanudar o volver a renderizar solo se genera lo que falta o lo que cambió.

## Fidelidad a la referencia: lo verificado y lo que no

No se pudieron ver los videos de referencia; la app se construyó a partir de la especificación escrita.

- **Nombre, lema, panel lateral (11 módulos y orden), formulario Crear Video (Nombre, Narración con voz IA, Guion con contador
  de palabras, Catálogo con tarjetas y selección dorada)**: tal como la especificación.
- **Catálogo de 38 estilos**: 15 nombres verificados (Fantasía Mágica, Terror, Infografía, 2D Stickman, 2D Personaje,
  Stickman Cinemático, 3D Relajado, 2D Boceto/Exploración, 3D Minimal, Pixel Retro, Noir Detective, Papercraft,
  Cyberpunk Neon, Documental Oscuro, Cosmos). Las **23 ranuras restantes no tienen nombre inventado**: aparecen como
  «Pendiente de verificación» y se completan con «Definir estilo». «Pixel Reto» de la especificación se interpretó como
  **Pixel Retro** (verificar). Las descripciones y prompts de cada estilo son de este proyecto.
- **Miniaturas**: ilustraciones SVG propias hasta que se genere la vista previa real con IA (botón ✦ en cada tarjeta).
  No se usa ningún recurso de la herramienta original.
- **Extensión**: su función original **no es verificable**; se implementó como *extender un video existente* (continuar el
  guion con nuevas escenas y re-renderizar). Ajustar si la referencia muestra otra cosa.
- **Avatares, Demo, Licencia**: implementados con funciones razonables (avatar presentador superpuesto en el video,
  recorrido guiado con guion de ejemplo, licencia MIT y avisos de terceros); su aspecto exacto en el original no es verificable.

## Pruebas

```bash
npm run build && npm run test:e2e
```

La prueba de extremo a extremo maneja la **interfaz real** con Playwright: introduce las claves, escribe título y guion,
elige 2D Stickman, voz y Música IA, genera el video, comprueba escenas, imágenes distintas, consistencia de personaje,
narración por escena, música, descarga el MP4 (verificado con ffprobe: H.264 1920×1080 + AAC, duración = suma de
escenas), lo reproduce, lo reabre desde Biblioteca y prueba Extensión.

**Importante:** en el entorno de desarrollo no había claves reales, así que la prueba sustituye los proveedores de IA por
`test/mock-providers.mjs`, que imita sus APIs (las «imágenes» son tarjetas con el texto de la escena y el «audio» es un
tono). Esto verifica todo el código propio (orquestación, consistencia, sincronía, render, guardado) pero **no** la calidad
de las imágenes ni de la voz, ni las llamadas reales a OpenAI / Gemini / Replicate / ElevenLabs / Anthropic.
Antes de usarla en producción, haz una generación corta con tus claves.
