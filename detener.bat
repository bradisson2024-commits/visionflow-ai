@echo off
cd /d "%~dp0"
set ENVFILE=clipforge.env
if not exist "%ENVFILE%" set ENVFILE=clipforge.env.example
docker compose --env-file "%ENVFILE%" stop
echo ClipForge detenido. Tus proyectos se conservan.
pause
