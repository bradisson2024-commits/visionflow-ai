# ViralHunter AI

Encuentra canales de YouTube pequeños con vídeos virales (buscador estilo RodriPro) y replícalos en 4 etapas (ReplicaPro): **Canal → Estilo y voz → Branding → Vídeos**.

## Stack
- **Frontend:** React 19 + TypeScript + Vite + Tailwind CSS (diseño móvil vertical, fondo negro, botones naranja).
- **Backend seguro:** Node + Hono (`server/`). Todas las claves viven sólo en `.env` del servidor; el navegador nunca las recibe. Validación con zod, límite de peticiones, cabeceras seguras y token de acceso opcional (`APP_ACCESS_TOKEN`).
- **Base de datos:** PostgreSQL de Supabase (`supabase/migrations/0001_init.sql`): búsquedas, canales, resultados, proyectos, recursos generados, ajustes y consumo de cuota.
- **APIs reales, todas GRATIS:**
  | Función | Proveedor por defecto | Clave |
  |---|---|---|
  | Datos de canales y vídeos | YouTube Data API v3 | `YOUTUBE_API_KEY` (gratis) |
  | Base de datos | Supabase PostgreSQL (plan Free) | `DATABASE_URL` (gratis) |
  | IA con visión (análisis, branding, guiones) | Google Gemini (plan gratuito) | `GEMINI_API_KEY` (gratis, sin tarjeta) |
  | Voz de narración | Google Gemini TTS | la misma `GEMINI_API_KEY` |
  | Imágenes | Pollinations (FLUX) | ninguna |

  Sin `GEMINI_API_KEY` la IA funciona igualmente con Pollinations (sin clave), pero sólo con texto: no analiza miniaturas (no hay etiquetas Faceless) y no hay voz. Anthropic, OpenAI y ElevenLabs quedan como opciones de pago, nunca necesarias.

## Puesta en marcha
```bash
cd viralhunter-ai
npm install
cp .env.example .env      # rellena las claves (ver instrucciones dentro)
npm run db:migrate        # crea las tablas en Supabase/PostgreSQL
npm run dev               # API en :8787 + web en :5173
```
Producción: `npm run build && npm start` (sirve `dist/` y la API en el mismo puerto).

Si falta una clave, la app indica cuál es y cómo obtenerla (pantalla «Configuración de APIs» del menú).

## Imágenes gratis
`IMAGE_PROVIDER=pollinations` (por defecto) no necesita clave. Límites del plan gratuito: 1 imagen cada ~45 s por IP (la app espera y reintenta sola), resolución reducida (~768 px) y marca de agua «pollinations.ai». Con un token gratuito (`POLLINATIONS_TOKEN`, auth.pollinations.ai) se quitan la marca y el límite. Alternativa gratis: `IMAGE_PROVIDER=huggingface` + `HF_TOKEN`.

## Cómo funciona la búsqueda (cada paso es una operación real, transmitida por SSE)
1. **Nichos del día:** rotación determinista diaria de 3 nichos del catálogo (`server/services/niches.ts`).
2. **Virales de la semana y del mes:** `search.list` ordenado por vistas (7 y 30 días, en español y en inglés) + `videos.list`.
3. **Lista de nichos:** vídeos y mediana de vistas por nicho.
4. **Canales pequeños con muchas vistas:** `channels.list`; filtro ≤100.000 suscriptores, ≥10.000 vistas y ≥2x vistas/suscriptores.
5. **Formatos no replicados en español:** la IA describe el formato y propone una consulta en español; se hace una búsqueda real en YouTube y, si ≤2 vídeos en español superan 50.000 vistas en 6 meses → «Formato único en español».
6. **Análisis de vídeos:** últimas 30 subidas de cada candidato.
7. **Clasificación:** puntuación 0–100 con fórmula pública (`server/services/scoring.ts`).
8. **Guardado** en la base de datos. 9. **Listo.**

Etiquetas: «Viral hace 7 días» / «Viral este mes» (≥20.000 vistas y ≥3x suscriptores), «Nicho emergente» (≥40% de canales virales del nicho tienen < 1 año), «Faceless» / «Faceless con IA» (análisis IA de miniaturas, marcado como IA). Los ingresos son una **estimación** = vistas de los últimos 30 días × RPM supuesto por idioma/nicho, con las hipótesis visibles en cada tarjeta.

Cuota: una búsqueda reciente consume ~1.300 de las 10.000 unidades diarias de YouTube; el contador de la portada se calcula con el consumo real registrado.

## Pruebas
`npm test` (puntuación, etiquetas, ingresos, parseo de URLs, patrones) · `npm run typecheck`.
