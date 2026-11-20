# Configuración de APIs y servicios

Todas las claves van en el archivo `.env` **del servidor** (copia de `.env.example`). Ninguna llega al
navegador. La pantalla **Ajustes** muestra en vivo qué está configurado y qué falta.

Mientras un servicio no esté configurado, la función que depende de él **no funcionará** y mostrará un
error explícito; no se simulan resultados.

## 1. Transcripción (`TRANSCRIPTION_PROVIDER`)

| Valor | Necesita | Notas |
|---|---|---|
| `openai` | `OPENAI_API_KEY` (platform.openai.com → API keys) | Whisper con marcas de tiempo por palabra. Pago por minuto de audio. |
| `groq` | `GROQ_API_KEY` (console.groq.com) | whisper-large-v3, rápido y barato. |
| `deepgram` | `DEEPGRAM_API_KEY` (console.deepgram.com) | Nova, con marcas de tiempo por palabra. |
| `local` (por defecto) | `pip install -r worker/py/requirements.txt` + `bash scripts/download-models.sh [tiny\|base\|small\|medium]` | Whisper con sherpa-onnx en el servidor, sin coste por uso. Los tiempos por palabra son **estimados** dentro de cada frase detectada por voz (los modelos ONNX publicados no exponen tiempos por palabra); para subtítulos con sincronía exacta usa un proveedor en la nube. El modelo `small` es más preciso que `base`. |

## 2. IA de análisis de momentos (`LLM_PROVIDER`)

### Opción gratuita: Ollama (recomendada si no quieres pagar)

1. Instala Ollama desde **ollama.com** (Windows, Mac o Linux) y ábrelo.
2. Descarga el modelo una sola vez: `ollama pull qwen2.5:7b` (≈ 4,7 GB; necesita unos 8 GB de RAM).
   Con 16 GB de RAM o más, `ollama pull qwen2.5:14b` da mejores resultados (`LLM_MODEL=qwen2.5:14b`).
3. En `.env`: `LLM_PROVIDER=ollama` (es el valor por defecto de `.env.example`).
4. En **Ajustes → Estado del sistema** aparece «IA local (Ollama): Lista».

Funciona sin internet y sin coste por uso. Es más lento que la nube (en CPU, varios minutos por video) y
un modelo pequeño elige peor los momentos que los modelos grandes de pago. Las transcripciones largas se
analizan por partes (`LLM_WINDOW_WORDS`, 2500 palabras por defecto) para que quepan en el modelo.

### Opciones de pago (en la nube)

| Valor | Necesita |
|---|---|
| `ollama` | Nada de pago: Ollama abierto en `OLLAMA_URL` con el modelo `LLM_MODEL` descargado. |
| `anthropic` (recomendado) | `ANTHROPIC_API_KEY` (console.anthropic.com). Modelo por defecto `claude-opus-5-5` (cambiable con `LLM_MODEL`), razonamiento `LLM_EFFORT=high`, salida JSON validada por esquema y respaldo automático si el modelo rechaza la petición. |
| `openai` | `OPENAI_API_KEY` + `LLM_MODEL` (nombre del modelo de OpenAI que quieras usar). |
| `openai_compatible` | `LLM_BASE_URL` + `LLM_MODEL` (+ `LLM_API_KEY` si el servidor lo pide). Sirve para Groq, OpenRouter u Ollama local. |

## 3. Almacenamiento (`STORAGE_DRIVER`)

- `local` (por defecto): archivos en `STORAGE_LOCAL_DIR`. No requiere nada.
- `s3`: `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, y `S3_ENDPOINT`/`S3_REGION` según el
  proveedor (para Supabase Storage usa el endpoint S3 del proyecto y sus claves S3).

## 4. Procesamiento

`FFMPEG_PATH`, `FFPROBE_PATH` (por defecto los del sistema), `WORKER_CONCURRENCY`, `MAX_UPLOAD_MB`.
Infraestructura: `DATABASE_URL` (PostgreSQL) y `REDIS_URL`.

## 5. Importación por enlace (YouTube y otras plataformas)

- **Pegar un enlace → clips virales**: en el inicio, pega el enlace y pulsa «Obtener clips virales». Se crea el
  proyecto (con el título del video), se descarga, se analiza automáticamente y los clips aparecen ordenados
  por puntuación.
- **YouTube, TikTok, Instagram, Facebook, X, Twitch, Vimeo** se descargan con **yt-dlp**
  (`pip install -r worker/py/requirements.txt`). El usuario debe confirmar que tiene derecho a usar el video.
  ⚠️ Descargar de estas plataformas puede ir contra sus términos de uso; es decisión del operador.
  Para desactivarlo: `PLATFORM_IMPORT_ENABLED=false`.
- **YouTube bloquea a menudo las descargas desde servidores en la nube** («confirma que no eres un bot»).
  Desde el computador de casa suele funcionar. Si no, exporta las cookies de tu navegador (formato Netscape,
  con una extensión tipo «Get cookies.txt») y configura `YTDLP_COOKIES_FILE=/ruta/cookies.txt`.
  Mantén yt-dlp actualizado (`pip install -U yt-dlp`): YouTube cambia a menudo.
- Calidad descargada: hasta 1080p MP4. Duración máxima: `MAX_IMPORT_MINUTES` (240 por defecto).
- **Enlaces directos** (Dropbox, Google Drive, OneDrive compartidos públicamente, o un .mp4 en un servidor)
  se descargan sin yt-dlp; los enlaces de compartir se convierten en descarga directa automáticamente.
- Protección SSRF: los enlaces directos no pueden apuntar a direcciones privadas o locales.
  `IMPORT_ALLOW_PRIVATE_HOSTS=true` la desactiva y **sólo debe usarse en pruebas**.
- La descarga la ejecuta el worker (`npm run worker`); sin worker, la importación queda «En cola».

## 6. Reencuadre inteligente

Usa OpenCV (YuNet) en el worker: `pip install -r worker/py/requirements.txt` y el modelo
`models/face_detection_yunet_2023mar.onnx` (lo descarga `scripts/download-models.sh`). Si falta, el clip se
genera con recorte centrado y el aviso queda registrado en el clip (no se oculta).

## 7. Sin clave de IA, ¿qué funciona?

Todo menos la detección automática de momentos: subir/importar, transcribir (local), crear clips manuales,
editarlos, reencuadrar, subtitular, renderizar y descargar. El botón «Analizar video» queda desactivado con
el motivo, y aparece «Sólo transcribir».
