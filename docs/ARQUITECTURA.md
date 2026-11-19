# Arquitectura

```
 Teléfono / tablet / PC (PWA instalable)
        │  HTTPS (REST + cookies httpOnly)
        ▼
 Next.js 16 (App Router)  ── páginas React + API REST (/api/*)
        │            │
        │            └── encola trabajos ──► Redis (BullMQ)
        ▼                                     │
   PostgreSQL ◄──── estado de trabajos ─── Worker Node.js (proceso aparte)
   (Drizzle ORM)                              │  FFmpeg / FFprobe
        ▲                                     │  proveedor de transcripción (configurable)
        │                                     │  proveedor de IA (configurable)
        └───────── Almacenamiento: disco local o S3 compatible ◄┘
```

## Tecnologías

| Capa | Elección | Motivo |
|---|---|---|
| Frontend | Next.js 16 + React 19 + TypeScript | Propuesta del cliente; SSR para comprobar sesión antes de pintar. |
| Diseño | Tailwind CSS 4, fuentes Inter / Space Grotesk empaquetadas | Sin dependencia de CDNs externos. |
| App móvil | **PWA instalable** (manifest, iconos, `standalone`) | Ver "Cambios respecto a la propuesta". |
| API | Route Handlers de Next.js (REST JSON) | La misma API servirá a una app nativa si se hace después. |
| Base de datos | PostgreSQL 16 + **Drizzle ORM** | Drizzle es JS puro (sin binarios descargados en tiempo de instalación), tipado y con migraciones SQL versionadas en `drizzle/`. |
| Autenticación | Propia: bcrypt (12 rondas) + sesiones opacas en cookie httpOnly; en BD sólo el SHA-256 del token | Simple, auditable, sin servicios externos. Límite de intentos de login. |
| Cola | **BullMQ + Redis**, worker en proceso separado | El análisis y el renderizado no bloquean la web; reintentos y progreso. |
| Video | FFmpeg / FFprobe | Corte, reencuadre, subtítulos quemados, codificación. |
| Transcripción | Interfaz con proveedores: OpenAI Whisper, Groq, Deepgram, faster-whisper local | Sin obligar a un proveedor; local = sin coste por uso. |
| IA de análisis | Interfaz con proveedores: Anthropic Claude, OpenAI, cualquier API compatible OpenAI (Groq, OpenRouter, Ollama) | Igual. |
| Almacenamiento | Disco local o S3 compatible (AWS S3, R2, MinIO, Supabase Storage) | Igual. |

## Cambios respecto a la propuesta

1. **"Quiero que sea una app para celular" → PWA primero.** El procesamiento de video (FFmpeg, IA) tiene
   que ocurrir en el servidor de todos modos, así que la app del teléfono es un cliente. Una PWA se instala
   desde el navegador ("Añadir a pantalla de inicio"), abre a pantalla completa, permite elegir videos de la
   galería y no requiere publicar en tiendas. Si después se quiere estar en Play Store / App Store, se puede
   envolver con Capacitor reutilizando la misma API REST (requiere Android Studio / Xcode en tu equipo).
2. **Drizzle en lugar de Prisma** (si se pensaba en Prisma): evita descargar el motor binario de Prisma y
   genera SQL legible.
3. **Supabase no es obligatorio**: el almacenamiento usa la API S3, que Supabase Storage también ofrece.

## Estructura de carpetas

```
src/
  app/
    (auth)/login, register        pantallas públicas
    (app)/dashboard               inicio
    (app)/projects, projects/[id] proyectos y detalle
    (app)/new                     crear proyecto
    (app)/settings                cuenta y estado de servicios
    api/                          API REST (auth, projects, health, services)
    manifest.ts                   manifiesto PWA
  components/                     UI (shell, proyectos, ajustes, primitivas)
  lib/                            utilidades compartidas cliente/servidor (formato, validación)
  server/
    db/schema.ts                  esquema completo (usuarios → proyectos → videos → trabajos → transcripciones → clips)
    auth/                         contraseñas, sesiones, límite de intentos
    services/                     lógica de negocio (proyectos; luego subida, análisis, render)
    providers/                    proveedores configurables (transcripción, IA, almacenamiento)
    env.ts, health.ts, http.ts
worker/                           proceso de trabajos en segundo plano (Fase 3+)
drizzle/                          migraciones SQL
tests/                            pruebas de integración contra la API real
scripts/                          servicios locales, generación de iconos
docs/
```

## Modelo de datos

`users` · `sessions` · `projects` (estado: draft → uploading → uploaded → queued → processing → ready | error)
· `videos` (metadatos de FFprobe, progreso de subida) · `jobs` (tipo, estado, **etapa visible**: en cola,
analizando audio, transcribiendo, detectando momentos, generando clips, renderizando, completado, error;
progreso, error, intentos) · `transcripts` (segmentos y palabras con tiempos) · `clips` (tiempos,
título, motivo, puntuación 0–100 con desglose en 9 criterios, ediciones, estilo de subtítulos, archivos
generados).
