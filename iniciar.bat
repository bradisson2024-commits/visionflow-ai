@echo off
chcp 65001 >nul
title ClipForge AI
cd /d "%~dp0"
echo ==============================================
echo   ClipForge AI
echo ==============================================
where docker >nul 2>nul
if errorlevel 1 (
  echo No se encontro Docker. Instala Docker Desktop desde https://www.docker.com/products/docker-desktop/ y vuelve a intentarlo.
  pause & exit /b 1
)
docker info >nul 2>nul
if errorlevel 1 (
  echo Docker esta instalado pero no esta abierto. Abre Docker Desktop, espera a que diga "running" y vuelve a intentarlo.
  pause & exit /b 1
)
set ENVFILE=clipforge.env
if not exist "%ENVFILE%" set ENVFILE=clipforge.env.example
rem Sin clipforge.env propio: con menos de 7 GB de RAM se usa el modelo de IA ligero.
if exist "clipforge.env" goto ram_done
set RAMGB=
for /f "usebackq tokens=*" %%m in (`powershell -NoProfile -Command "[math]::Round((Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory/1GB)"`) do set RAMGB=%%m
if not defined RAMGB goto ram_done
if %RAMGB% GEQ 7 goto ram_done
echo Equipo con %RAMGB% GB de RAM: se usara el modelo de IA ligero qwen2.5:1.5b
set CF_LLM_MODEL=qwen2.5:1.5b
set CF_OLLAMA_NUM_CTX=4096
set CF_LLM_WINDOW_WORDS=1200
:ram_done
echo Preparando ClipForge (la primera vez tarda 10-20 minutos: descarga programas y el modelo de IA)...
docker compose --env-file "%ENVFILE%" up -d --build
if errorlevel 1 (
  echo No se pudo arrancar. Copia el mensaje de arriba para pedir ayuda.
  pause & exit /b 1
)
echo Esperando a que la app este lista...
powershell -NoProfile -Command "for($i=0;$i -lt 120;$i++){try{Invoke-WebRequest -UseBasicParsing http://localhost:3000/api/health -TimeoutSec 3 | Out-Null; break}catch{Start-Sleep 3}}"
echo.
echo ClipForge esta en marcha:  http://localhost:3000
for /f "usebackq tokens=*" %%a in (`powershell -NoProfile -Command "(Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.InterfaceAlias -notmatch 'Loopback|vEthernet|WSL' -and $_.IPAddress -notlike '169.*' } | Select-Object -First 1).IPAddress"`) do set IP=%%a
if defined IP echo Desde el telefono (mismo Wi-Fi):  http://%IP%:3000
echo El modelo de IA puede seguir descargandose unos minutos la primera vez (Ajustes - Estado del sistema).
echo Para detenerlo: detener.bat
start "" http://localhost:3000
pause
