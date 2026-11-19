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
| `local_whisper` | Python 3 + `pip install faster-whisper` + descarga del modelo (Hugging Face) | Sin coste por uso; usa CPU/GPU del servidor. |

## 2. IA de análisis de momentos (`LLM_PROVIDER`)

| Valor | Necesita |
|---|---|
| `anthropic` | `ANTHROPIC_API_KEY` (console.anthropic.com). `LLM_MODEL` opcional. |
| `openai` | `OPENAI_API_KEY`. `LLM_MODEL` opcional. |
| `openai_compatible` | `LLM_BASE_URL` + `LLM_MODEL` (+ `LLM_API_KEY` si el servidor lo pide). Sirve para Groq, OpenRouter u Ollama local. |

## 3. Almacenamiento (`STORAGE_DRIVER`)

- `local` (por defecto): archivos en `STORAGE_LOCAL_DIR`. No requiere nada.
- `s3`: `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, y `S3_ENDPOINT`/`S3_REGION` según el
  proveedor (para Supabase Storage usa el endpoint S3 del proyecto y sus claves S3).

## 4. Procesamiento

`FFMPEG_PATH`, `FFPROBE_PATH` (por defecto los del sistema), `WORKER_CONCURRENCY`, `MAX_UPLOAD_MB`.
Infraestructura: `DATABASE_URL` (PostgreSQL) y `REDIS_URL`.

## 5. Importación por enlace

- Se aceptan enlaces de **descarga directa** a archivos de video (servidor propio, S3/R2, Dropbox o Google
  Drive compartidos públicamente; los enlaces de “compartir” de Dropbox/Drive/OneDrive se convierten
  automáticamente).
- Los enlaces de YouTube, TikTok, Instagram, Facebook, X, Twitch y Vimeo se rechazan con una explicación:
  sus términos prohíben descargar con herramientas externas (regla 17 del encargo).
- Protección SSRF: el servidor no descarga desde direcciones privadas o locales. `IMPORT_ALLOW_PRIVATE_HOSTS=true`
  desactiva esa protección y **sólo debe usarse en pruebas**.
- La descarga la ejecuta el worker (`npm run worker`); sin worker, la importación queda “En cola”.
