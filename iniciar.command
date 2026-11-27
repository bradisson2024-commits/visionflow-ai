#!/usr/bin/env bash
# ClipForge AI — iniciar (Mac / Linux). Doble clic en Mac, o: bash iniciar.command
cd "$(dirname "$0")" || exit 1
echo "=============================================="
echo "  ClipForge AI"
echo "=============================================="
if ! command -v docker >/dev/null 2>&1; then
  echo "No se encontró Docker. Instala Docker Desktop desde https://www.docker.com/products/docker-desktop/ y vuelve a intentarlo."
  read -r -p "Pulsa Enter para cerrar…" _; exit 1
fi
if ! docker info >/dev/null 2>&1; then
  echo "Docker está instalado pero no está abierto. Abre Docker Desktop, espera a que diga «running» y vuelve a intentarlo."
  read -r -p "Pulsa Enter para cerrar…" _; exit 1
fi
ENVFILE=clipforge.env; [ -f "$ENVFILE" ] || ENVFILE=clipforge.env.example
# Sin clipforge.env propio: con menos de 7 GB de RAM se usa el modelo de IA ligero.
if [ ! -f clipforge.env ]; then
  if [ -n "${CF_TEST_RAM_GB:-}" ]; then RAMGB=$CF_TEST_RAM_GB
  elif command -v sysctl >/dev/null 2>&1 && sysctl -n hw.memsize >/dev/null 2>&1; then RAMGB=$(( $(sysctl -n hw.memsize) / 1073741824 ))
  else RAMGB=$(( $(awk '/MemTotal/ {print $2}' /proc/meminfo 2>/dev/null || echo 0) / 1048576 )); fi
  if [ "${RAMGB:-0}" -gt 0 ] && [ "$RAMGB" -lt 7 ]; then
    echo "Equipo con ${RAMGB} GB de RAM: se usará el modelo de IA ligero qwen2.5:1.5b"
    export CF_LLM_MODEL=qwen2.5:1.5b CF_OLLAMA_NUM_CTX=4096 CF_LLM_WINDOW_WORDS=1200
  fi
fi
echo "Preparando ClipForge (la primera vez tarda 10–20 minutos: descarga programas y el modelo de IA)…"
if ! docker compose --env-file "$ENVFILE" up -d --build; then
  echo "No se pudo arrancar. Copia el mensaje de arriba para pedir ayuda."
  read -r -p "Pulsa Enter para cerrar…" _; exit 1
fi
printf "Esperando a que la app esté lista"
for _ in $(seq 1 120); do
  if curl -fs http://localhost:3000/api/health >/dev/null 2>&1; then break; fi
  printf "."; sleep 3
done
echo
IP=$( (ipconfig getifaddr en0 || ipconfig getifaddr en1 || hostname -I | awk '{print $1}') 2>/dev/null | head -1)
echo "✅ ClipForge está en marcha:  http://localhost:3000"
[ -n "$IP" ] && echo "📱 Desde el teléfono (mismo Wi-Fi):  http://$IP:3000"
echo "   El modelo de IA puede seguir descargándose unos minutos la primera vez (Ajustes → Estado del sistema)."
echo "   Para detenerlo: detener.command"
(open http://localhost:3000 || xdg-open http://localhost:3000) >/dev/null 2>&1 &
