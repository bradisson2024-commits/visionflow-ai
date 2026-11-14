# visionflow-ai — 3 canales de YouTube sin cara

Sistema en Python que gestiona **CURIOSIDAD TOTAL** (curiosidades), **ECOS DEL PASADO** (historia)
y **CASO ABIERTO** (misterio):

1. **Investiga** los vídeos que más funcionan en cada nicho (YouTube Data API v3, datos reales).
2. **Escribe guiones originales** con la estructura Gancho → Contexto → Giro → Final (API de Claude),
   usando esos vídeos como referencia y rechazando frases copiadas.
3. **Produce** cada vídeo: voz IA, imágenes con movimiento, subtítulos quemados + SRT, montaje con ffmpeg (vertical 1080×1920).
4. **Sube y programa** un vídeo al día por canal (privado + `publishAt`), comprobando que cada token pertenece al canal correcto.

Nada se marca como hecho si no ocurrió: cada hueco del calendario (`data/calendar.json`) solo avanza
de estado (`planned → scripted → voiced → rendered → scheduled`) cuando existe el archivo resultante
o YouTube ha devuelto un ID de vídeo.

## Instalación

```bash
sudo apt install ffmpeg espeak-ng      # espeak-ng es opcional (voz de respaldo sin internet)
pip install -r requirements.txt
cp .env.example .env                   # y rellena las claves
python -m faceless doctor              # muestra qué falta por conectar
```

## Qué tienes que conectar

| Para | Qué | Dónde se consigue |
|---|---|---|
| Paso 1 investigación | `YOUTUBE_API_KEY` | Google Cloud Console → habilitar *YouTube Data API v3* → Credenciales → Clave de API |
| Paso 2 guiones | `ANTHROPIC_API_KEY` | console.anthropic.com → API Keys (con saldo) |
| Paso 3 imágenes | `PEXELS_API_KEY` (gratis) | pexels.com/api. Sin ella: tus fotos en `data/<canal>/library/` o tarjetas generadas |
| Paso 3 voz | nada (edge-tts, gratis, requiere internet) · opcional `ELEVENLABS_API_KEY` + `elevenlabs_voice_id` por canal | elevenlabs.io |
| Paso 4 subida | `credentials/client_secret.json` | Google Cloud Console → Credenciales → ID de cliente OAuth → *Aplicación de escritorio*. Añade tu cuenta como usuario de prueba en la pantalla de consentimiento |
| Paso 4 canales | Los 3 canales creados en YouTube (cuentas de marca) | Se crean a mano en youtube.com — la API no permite crear canales |

Después, una vez por canal (abre el navegador; elige el canal correcto):

```bash
python -m faceless auth --channel curiosidad_total   # imprime el ID del canal
```
Copia cada ID en `youtube_channel_id` de `config/channels.json`.

### Avisos importantes de YouTube
- **Proyectos de API sin auditar**: YouTube bloquea como *privados* los vídeos subidos por proyectos
  creados después del 28‑07‑2020 que no han pasado la auditoría de cumplimiento. Hasta aprobarla, la
  programación (`publishAt`) no hará públicos los vídeos. Solicítala en el formulario *YouTube API Services – Audit and Quota Extension*.
- **Cuota**: 10.000 unidades/día por defecto. Investigación ≈ 400 unidades/canal; cada subida 1.600.
  3 subidas diarias + investigación de los 3 nichos ≈ 6.000 unidades.
- **Política de monetización**: YouTube penaliza el contenido masivo y repetitivo. Revisa cada guion
  (`facts_to_verify`) antes de publicarlo y varía temas y formatos.

## Uso

```bash
python -m faceless plan-week --start 2026-11-16      # 21 huecos: 1/día/canal (13:00, 17:00, 21:00)
python -m faceless research --channel all            # informes en data/<canal>/research/*.md
python -m faceless script  --date 2026-11-16         # guiones con IA para ese día
python -m faceless produce --date 2026-11-16         # voz + imágenes + subtítulos + vídeo
python -m faceless upload  --date 2026-11-16         # sube y programa
python -m faceless run     --date 2026-11-16         # todo lo anterior seguido
python -m faceless calendar --markdown data/calendario.md
python -m faceless import-script --slot 2026-11-16_caso_abierto --file mi_guion.json  # guion propio
```

Automatizar (cron diario a las 08:00, prepara los vídeos del día siguiente):
```
0 8 * * * cd /ruta/visionflow-ai && python -m faceless run --date $(date -d tomorrow +\%F) >> data/cron.log 2>&1
```

Horarios, zona horaria, voces, paletas, búsquedas de investigación y longitud de guion: `config/channels.json`.
Ejemplos de guion en `examples/`.

## Pruebas

```bash
python -m pytest -q
```
`test_render.py` produce un vídeo real (espeak-ng + ffmpeg). Los tests de investigación, guiones y
subida usan respuestas **simuladas** con el formato de las APIs: prueban la lógica, no sustituyen una
ejecución real con tus credenciales.
