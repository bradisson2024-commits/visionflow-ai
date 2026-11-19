# ClipForge AI

Plataforma web (instalable en el teléfono como app) que convierte videos largos en clips cortos para
YouTube Shorts, TikTok, Instagram Reels y Facebook Reels: transcripción, detección de momentos con IA,
puntuación, reencuadre vertical, subtítulos y exportación real con FFmpeg.

> Inspirada en el flujo de trabajo de herramientas como Opus Clip, con marca, diseño y código propios.

## Estado

| Fase | Contenido | Estado |
|---|---|---|
| 1 | Base: arquitectura, diseño, dashboard, navegación, BD, usuarios, proyectos | ✅ Hecha y probada |
| 2 | Subida real de videos, validación, almacenamiento, vista previa | ⏳ Pendiente |
| 3 | Audio, transcripción, análisis con IA, detección y puntuación de momentos | ⏳ Pendiente (requiere claves API) |
| 4 | Motor de clips: corte FFmpeg, formatos, reencuadre | ⏳ Pendiente |
| 5 | Subtítulos sincronizados, estilos, editor | ⏳ Pendiente |
| 6 | Renderizado final, descarga, exportación múltiple | ⏳ Pendiente |
| 7 | Pruebas de extremo a extremo con videos reales | ⏳ Pendiente |

## Puesta en marcha

Requisitos: Node 22+, PostgreSQL 16, Redis 7, FFmpeg 6.

```bash
npm install
cp .env.example .env          # edita las claves (ver docs/CONFIGURACION.md)
docker compose up -d db redis # o: npm run services:start (Linux con servicios del sistema)
npm run db:migrate
npm run dev                   # http://localhost:3000
```

Pruebas de integración (con el servidor en marcha): `npm test`.

## Documentación

- [docs/ARQUITECTURA.md](docs/ARQUITECTURA.md) — tecnologías, decisiones y estructura de carpetas.
- [docs/CONFIGURACION.md](docs/CONFIGURACION.md) — APIs y servicios que necesitan clave.
- [docs/REFERENCIA.md](docs/REFERENCIA.md) — qué se pudo y qué no se pudo verificar de la referencia.
