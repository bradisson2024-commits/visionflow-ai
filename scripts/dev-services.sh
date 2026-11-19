#!/usr/bin/env bash
# Arranca PostgreSQL y Redis locales (Linux con servicios del sistema) y aplica migraciones.
# En otros sistemas usa:  docker compose up -d db redis
set -euo pipefail
service postgresql start >/dev/null
service redis-server start >/dev/null || true
if ! su postgres -c "psql -tAc \"select 1 from pg_roles where rolname='clipforge'\"" | grep -q 1; then
  su postgres -c "psql -c \"CREATE USER clipforge WITH PASSWORD 'clipforge' CREATEDB;\""
  su postgres -c "createdb -O clipforge clipforge"
fi
npx drizzle-kit migrate
echo "PostgreSQL y Redis listos."
