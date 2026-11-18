# Cenit Studio

Plataforma web para investigar YouTube y crear vídeos con IA:

- **Investigación:** Radar Viral, Radar de Canales con estado de monetización según la evidencia, análisis de canales e investigación semanal automática.
- **Generador de vídeos:** cuatro modalidades de creación, 14 estilos visuales, guion, escenas, casting con referencias, imágenes, animación, voz, subtítulos, música, edición y exportación MP4.

Proyecto nuevo e independiente: no usa código, marca ni recursos de otras plataformas ni de otros proyectos del repositorio.

## Arquitectura

| Capa | Tecnología |
|---|---|
| Interfaz | React 19 + Vite (`web/`), diseño propio azul marino, adaptable a móvil |
| API | Node 22 + Fastify (`server/app.js`) |
| Base de datos | PostgreSQL / Supabase (`supabase/migrations/0001_cenit.sql`) |
| Autenticación | Supabase Auth (el servidor verifica el JWT con el JWKS del proyecto) o cuentas locales para pruebas |
| Almacenamiento | Supabase Storage (bucket privado) o disco local |
| Trabajos en segundo plano | Cola en PostgreSQL (`FOR UPDATE SKIP LOCKED`) y planificador semanal (`server/core/jobs.js`, `server/modules/weekly.js`); se puede separar con `npm run worker` |
| IA | Gemini: texto, análisis de vídeos públicos de YouTube, transcripción de audio, Imagen con referencias, TTS y animación Veo |
| Voz | Gemini TTS · Microsoft Edge (gratis) · ElevenLabs (opcional) |
| YouTube | YouTube Data API v3: `search.list`, `videos.list`, `channels.list`, `playlistItems.list` |
| Vídeo | FFmpeg: transiciones, subtítulos ASS (libass), mezcla con ducking, comprobación del MP4 |

## Puesta en marcha

Requisitos: Node 22.13 o superior, FFmpeg y una base de datos PostgreSQL (Supabase o local).

```bash
cd cenit-studio
npm install
npm --prefix web install
cp .env.example .env        # rellena las claves (ver la tabla siguiente)
npm run build               # compila la interfaz
npm run migrate             # crea las tablas, los 14 estilos y la biblioteca de música
npm start                   # http://localhost:8080
```

Para desarrollar la interfaz con recarga en caliente: `npm run dev` y `npm --prefix web run dev`.

### Qué configurar

| Variable | Dónde se obtiene | Para qué |
|---|---|---|
| `DATABASE_URL` | Supabase → Project Settings → Database (Session pooler) | Base de datos |
| `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Project Settings → API | Inicio de sesión y almacenamiento de archivos. Crea un bucket **privado** llamado `cenit` |
| `YOUTUBE_API_KEY` | Google Cloud → APIs y servicios → YouTube Data API v3 → Credenciales | Radar Viral, Radar de Canales, análisis de canales. Cuota gratuita: 10.000 unidades/día |
| `GEMINI_API_KEY` | aistudio.google.com/apikey | Guiones, análisis, imágenes, voz y Veo. Imágenes y Veo pueden requerir facturación |
| `ELEVENLABS_API_KEY` | elevenlabs.io (opcional) | Voces adicionales |

Sin Supabase, deja vacíos `SUPABASE_*` y pon un `LOCAL_JWT_SECRET` largo: se usarán cuentas locales.

En **Ajustes** hay un botón «Probar conexión real» para cada servicio. Ahí se configuran también:
- las tarifas de créditos por operación;
- los umbrales del Radar;
- el RPM para las estimaciones de ingresos;
- los modelos de Gemini;
- la imagen de ejemplo de cada estilo.

## Funciones

**Crear vídeo**
- Paso 1, modo: Desde Guion, Desde Idea, Desde URL (YouTube o página web: se analiza la estructura, nunca se descarga ni se copia) o Desde Audio (se transcribe con tiempos y se usa como narración).
- Paso 2: formato (9:16, 16:9 o 1:1) y estilo visual.
- Hay 14 estilos. Cada uno es un perfil real que se añade a cada prompt: base, paleta, iluminación, cámara, personajes y elementos a evitar. Se pueden crear estilos nuevos.

**Editor**
- **Contenido:**
  - Plantillas rápidas (Top 5, Dato curioso, True Crime, Tutorial, Conspiración, Storytelling, Documental, Historia bíblica, Misterio, Ciencia). Cada una impone una estructura narrativa y una planificación visual.
  - Generar guion con IA, Mejorar idea y editor del guion con contador de caracteres y palabras.
  - Ritmo de cortes: rápido 4 s, normal 5 s o lento configurable, con estimación de escenas y créditos.
  - División en escenas por ideas visuales: se comprueba que el texto se conserva íntegro y en orden.
  - **Casting y Referencias:** detección automática del reparto; nombre, descripción, vestimenta, rasgos y papel; generar, subir o ampliar la referencia. La referencia se envía al generador en cada escena donde aparece el personaje.
  - Escenas con **Prompt Img**, **Prompt anim**, generación individual, «Generar todas», progreso por escena y reintento sin perder las demás.
- **Voz:** catálogo con filtros de género, idioma y acento; vista previa real; velocidad; tono (voces Edge); generación y regeneración por fragmento. Cada escena dura lo que dura su voz.
- **Subtítulos:** automáticos sincronizados con la voz y edición manual. Se puede cambiar tipografía, tamaño, posición, colores, contorno, caja, animaciones (fundido, pop, karaoke, giro) y estilos predefinidos.
- **Música:** biblioteca propia (pistas originales libres de derechos), subida de audio con su licencia, volumen, fundidos, tramo de escenas, ducking bajo la voz y efectos por escena.
- **Edición:** vista previa, orden de escenas, duración, transiciones (corte, fundido, deslizar, zoom, disolver, barrido, círculo), brillo, contraste, saturación, acercamiento lento, volumen de voz, pausas y exportación a 720p, 1080p o 1440p. El MP4 se comprueba antes de ofrecerse: flujos, duración y decodificación completa.

**Animación** (Prompt anim)
- **Veo:** anima personajes, objetos, cámara y entorno a partir de la imagen. Cobra créditos por segundo. En 1:1 se recorta, porque Veo no genera cuadrado.
- **Movimiento de cámara:** gratis con FFmpeg, pero no mueve a los personajes.

**Radar Viral**
- Filtros: nicho, subnicho, palabra clave, idiomas (hasta 4, el español primero), país, periodo (24 h, 3 días, 7 días, 30 días), duración, Shorts o vídeos largos, vistas mínimas, suscriptores, canales pequeños y canales nuevos.
- Cada vídeo se compara con la mediana de las subidas recientes de su canal.
- La velocidad se mide con **capturas sucesivas** que guarda la app («Nueva captura»). Mientras sólo haya una, se indica que la velocidad es la media desde la publicación.
- Categorías con umbrales configurables y explicados: Despegando, Crecimiento acelerado, Viral, Viral extraordinario, Canal pequeño con vídeo gigante, Rendimiento excepcional y Tendencia emergente.
- Un vídeo con más días que el límite configurado nunca se etiqueta como viral.
- «¿Hueco en español?» comprueba si el formato tiene poca competencia en español.
- **Crear vídeo inspirado en esta oportunidad** ejecuta los 15 pasos: análisis del vídeo, idea original, guion propio, escenas, imágenes, voz y MP4.

**Radar de Canales**
- Filtros de suscriptores (menos de 1.000 / 5.000 / 10.000 / 50.000 / 100.000), antigüedad, fecha de creación, nicho, idioma, país y crecimiento reciente.
- La fecha de creación es la que publica YouTube; si no está, no se afirma que el canal sea nuevo.
- La monetización se separa en tres grupos:
  - **A · confirmada:** sólo con evidencia directa que registras con su fuente.
  - **B · señales públicas:** enlace de membresías del canal, promociones pagadas declaradas.
  - **C · potencial:** requisitos de YouTube estimados con hipótesis visibles.
- YouTube no publica el estado del Programa de Socios, y los anuncios no prueban que el creador cobre.

**Análisis de canales**
- Suscriptores, visualizaciones, ingresos mensuales (**estimación**, con su fórmula), duración media y frecuencia.
- Rendimiento: mediana, largos frente a Shorts, interacción, mejores y peores.
- Galería ordenable y monetización según la evidencia.

**Investigación semanal**
- Nichos, idiomas, país, día y hora.
- Ejecuta los radares, guarda informes, compara con el historial (`weekly_seen`) para no repetir novedades y detecta nichos emergentes.
- Si no hay novedades verificadas, lo dice.

**Créditos**
- Libro de movimientos, indicador en la barra lateral con el coste de cada operación y reembolso automático si una operación falla.
- Por defecto, 1 crédito = 0,001 USD de coste del proveedor; las tarifas se ajustan en Ajustes.

## Pruebas

```bash
npm test                    # backend: PostgreSQL real, FFmpeg real, cola real
node tests/ui.e2e.mjs       # interfaz en Chromium (necesita Playwright)
```

Ambas pruebas crean su propia base de datos (`cenit_test` / `cenit_e2e`) con el usuario `postgres`. YouTube y Gemini se sustituyen por **dobles de pruebas** (`tests/fakes.js`) con el formato real de sus respuestas.

Lo que las pruebas **no** cubren, porque requiere tus cuentas:
- las respuestas reales de YouTube, Gemini, Veo y ElevenLabs;
- Supabase Auth y Storage reales.

Para comprobarlos usa «Probar conexión real» en Ajustes.

## Imágenes con Google Flow (gratis con tu cuenta de Google)

Si tu clave de Gemini no tiene facturación, Google no genera imágenes por API. Hazlas en Google Flow:

1. **Prompt en inglés** (en cada escena o personaje, o «Prompts en inglés (sin imagen)» / «Prompts del reparto» para todos): muestra y copia el prompt traducido al inglés, con el estilo y el reparto incluidos.
2. **Flow**: abre `flow.google.com`. Pega el prompt, genera la imagen y descárgala.
3. **Subir imagen**: la imagen se ajusta al formato del vídeo y queda en su escena o personaje.
