# ClipForge AI

Plataforma web (instalable en el teléfono como app) que convierte videos largos en clips cortos para
YouTube Shorts, TikTok, Instagram Reels y Facebook Reels: transcripción, detección de momentos con IA,
puntuación, reencuadre vertical, subtítulos y exportación real con FFmpeg.

> Inspirada en el flujo de trabajo de herramientas como Opus Clip, con marca, diseño y código propios.

## Estado

| Fase | Contenido | Estado |
|---|---|---|
| 1 | Base: arquitectura, diseño, dashboard, navegación, BD, usuarios, proyectos | ✅ Probada |
| 2 | Subida real (por partes, reanudable, cancelable), importación por enlace directo, FFprobe, almacenamiento | ✅ Probada |
| 3 | Audio, transcripción (OpenAI / Groq / Deepgram / Whisper local), detección de momentos con IA (Ollama gratis / Claude / OpenAI), puntuación 0–100, clips ordenados | ✅ Transcripción local probada · ⚠️ Detección probada con un servidor Ollama simulado: falta probarla con un modelo real |
| 4 | Corte FFmpeg, 9:16 · 16:9 · 1:1 · 4:5, seguimiento de rostro (YuNet), pantalla dividida, manual | ✅ Probada |
| 5 | Subtítulos grabados (5 estilos + personalización), editor con línea de tiempo, recorte, edición de palabras | ✅ Probada |
| 6 | Render con opciones (resolución, calidad, FPS, SRT), descarga individual y ZIP | ✅ Probada |
| 7 | Pruebas de extremo a extremo | ✅ 59 pruebas automáticas + flujo en navegador móvil |

## Modo 100 % gratis

- Transcripción: Whisper local (`TRANSCRIPTION_PROVIDER=local`).
- Detección de momentos: modelo local con Ollama (`LLM_PROVIDER=ollama`, `ollama pull qwen2.5:7b`).

Ninguna de las dos usa claves ni cobra por uso; usan la CPU/RAM de tu equipo. Ver `docs/CONFIGURACION.md`.

## Puesta en marcha

Requisitos: Node 22+, PostgreSQL 16, Redis 7, FFmpeg 6 (con libass), Python 3.10+.

```bash
npm install
pip install -r worker/py/requirements.txt   # transcripción local y detección de rostros
bash scripts/download-models.sh            # Whisper (base), VAD y detector de rostros
cp .env.example .env          # edita las claves (ver docs/CONFIGURACION.md)
docker compose up -d db redis # o: npm run services:start (Linux con servicios del sistema)
npm run db:migrate
npm run dev                   # http://localhost:3000
npm run worker                # en otra terminal: procesa los trabajos en segundo plano
```

Pruebas de integración: `bash scripts/make-test-videos.sh`, luego servidor y worker con
`IMPORT_ALLOW_PRIVATE_HOSTS=true` (sólo para pruebas) y `npm test`.

## Documentación

- [docs/ARQUITECTURA.md](docs/ARQUITECTURA.md) — tecnologías, decisiones y estructura de carpetas.
- [docs/CONFIGURACION.md](docs/CONFIGURACION.md) — APIs y servicios que necesitan clave.
- [docs/REFERENCIA.md](docs/REFERENCIA.md) — qué se pudo y qué no se pudo verificar de la referencia.
