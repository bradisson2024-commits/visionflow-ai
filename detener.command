#!/usr/bin/env bash
# Detiene ClipForge. Tus proyectos y clips se conservan.
cd "$(dirname "$0")" || exit 1
ENVFILE=clipforge.env; [ -f "$ENVFILE" ] || ENVFILE=clipforge.env.example
docker compose --env-file "$ENVFILE" stop && echo "ClipForge detenido. Tus proyectos se conservan."
