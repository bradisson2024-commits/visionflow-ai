# Instalar ClipForge en tu computador

Sólo necesitas **un programa: Docker Desktop** (gratis). Todo lo demás (la app, la base de datos, la
transcripción, el detector de rostros y la IA gratuita) se instala solo.

## Requisitos

- Windows 10/11 o Mac (Intel o Apple Silicon).
- **8 GB de RAM** como mínimo (16 GB recomendado) y **unos 20 GB libres** en el disco.
- Internet la primera vez (se descargan unos 10 GB entre programas y el modelo de IA).

## 1. Instala Docker Desktop

1. Entra en **https://www.docker.com/products/docker-desktop/** y descarga la versión para tu sistema.
2. Instálalo y ábrelo. Espera a que abajo a la izquierda diga **«Engine running»**.
   - En Windows, si te pide instalar o actualizar **WSL**, acepta y reinicia.
3. Recomendado: en Docker Desktop → **Settings → Resources**, dale al menos **8 GB de memoria**.

## 2. Descarga ClipForge

1. En GitHub, abre el repositorio y elige la rama `ccr-a0d27618-odc3qu`.
2. Pulsa **Code → Download ZIP** y descomprímelo (por ejemplo, en Documentos).

## 3. Inicia ClipForge

- **Windows:** doble clic en **`iniciar.bat`**.
  Si Windows muestra «Windows protegió su PC», pulsa *Más información → Ejecutar de todas formas*.
- **Mac:** clic derecho en **`iniciar.command`** → **Abrir** → **Abrir** (sólo la primera vez, por seguridad
  de macOS). Si no se abre, en la Terminal: `bash ` (con espacio), arrastra el archivo a la ventana y pulsa Enter.

**La primera vez tarda 10–20 minutos** (descarga e instala todo). Las siguientes, menos de un minuto.
Al terminar se abre el navegador en **http://localhost:3000**.

> El modelo de IA (≈ 5 GB) sigue descargándose unos minutos después de que se abra la app. En
> **Ajustes → Estado del sistema** verás «IA local (Ollama)» en verde cuando esté listo.

## 4. Úsala

1. Crea tu cuenta (es local, en tu computador).
2. En el inicio, pega el enlace de YouTube, marca la casilla de derechos y pulsa **Obtener clips virales**.
3. Espera: verás las etapas (descargando → transcribiendo → detectando momentos → generando clips).
   Un video de 30 minutos puede tardar entre 10 y 30 minutos según tu computador.
4. Revisa los clips (ordenados por puntuación), genera los que te gusten y descárgalos.

## Desde el teléfono

Con el teléfono en el **mismo Wi-Fi**, abre la dirección que muestra la ventana de `iniciar`
(algo como `http://192.168.1.25:3000`). En el navegador del teléfono, **«Añadir a pantalla de inicio»** para
tenerla como app. Si no carga, permite el acceso cuando el firewall de Windows lo pregunte.

## Detener y volver a abrir

- Detener: doble clic en `detener.bat` (Windows) o `detener.command` (Mac). Tus proyectos se conservan.
- Volver a abrir: otra vez `iniciar`.

## Ajustes opcionales

Copia `clipforge.env.example` como **`clipforge.env`** y edítalo con el Bloc de notas / TextEdit:
- Con 16 GB de RAM o más: `CF_LLM_MODEL=qwen2.5:14b` (mejor selección de momentos).
- Para usar Claude (de pago) en vez de la IA gratuita: `CF_LLM_PROVIDER=anthropic` y `CF_ANTHROPIC_API_KEY=…`.

Después vuelve a ejecutar `iniciar`.

## Equipos con 4 GB de RAM

**Automático:** si no existe `clipforge.env`, `iniciar` detecta la RAM y con menos de 7 GB usa el modelo
ligero `qwen2.5:1.5b` (≈ 1 GB). No hay que hacer nada.

La IA local por defecto (qwen2.5:7b) necesita unos 8 GB de RAM. Con 4 GB todo lo demás funciona
(importar, transcribir, recortar, subtitular, descargar), pero para elegir los momentos virales hay dos
opciones. Se configuran en `clipforge.env` (copia de `clipforge.env.example`) y luego se vuelve a abrir `iniciar`:

1. **IA en la nube compatible con OpenAI** (Groq, Google Gemini…). Algunos proveedores tienen plan gratuito
   con límites. Crea una clave en su web y rellena `CF_LLM_PROVIDER=openai_compatible`, `CF_LLM_BASE_URL`,
   `CF_LLM_MODEL` y `CF_LLM_API_KEY` (hay ejemplos en el archivo). Recomendado: elige mucho mejor los momentos.
2. **Modelo local pequeño** (`CF_LLM_MODEL=qwen2.5:1.5b`, `CF_OLLAMA_NUM_CTX=4096`, `CF_LLM_WINDOW_WORDS=1200`).
   Gratis y sin internet, pero acierta menos.

## Si YouTube dice «confirma que no eres un bot»

Exporta las cookies de tu navegador con tu sesión de YouTube abierta (extensión «Get cookies.txt LOCALLY»),
guarda el archivo como **`config/cookies.txt`** dentro de la carpeta de ClipForge y vuelve a intentarlo.

## Problemas frecuentes

| Mensaje | Solución |
|---|---|
| «No se encontró Docker» | Instala Docker Desktop (paso 1). |
| «Docker está instalado pero no está abierto» | Abre Docker Desktop y espera a «Engine running». |
| La IA «todavía se está descargando» | Espera unos minutos; si no avanza, vuelve a abrir `iniciar`. |
| Va muy lento | Es normal en computadores sin tarjeta gráfica; usa clips «cortos» y menos clips, o un proveedor de pago. |
