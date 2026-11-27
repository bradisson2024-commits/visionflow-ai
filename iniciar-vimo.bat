@echo off
chcp 65001 >nul
title Vimo - Videos con IA en un clic
cd /d "%~dp0"

echo.
echo  ===== Vimo =====
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo  [X] No se encuentra Node.js.
  echo      Instalalo con:  winget install OpenJS.NodeJS.LTS
  echo      o desde https://nodejs.org  y vuelve a abrir este archivo.
  pause
  exit /b 1
)
for /f "tokens=1 delims=." %%v in ('node -p "process.versions.node"') do set NODE_MAJOR=%%v
if %NODE_MAJOR% LSS 22 (
  echo  [X] Tu Node.js es muy antiguo. Vimo necesita la version 22.13 o superior.
  echo      Actualizalo con:  winget install OpenJS.NodeJS.LTS
  pause
  exit /b 1
)

where ffmpeg >nul 2>nul
if errorlevel 1 (
  echo  [X] No se encuentra FFmpeg, necesario para renderizar el video.
  echo      Instalalo con:  winget install Gyan.FFmpeg
  echo      Despues CIERRA esta ventana y vuelve a abrir este archivo.
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo  Instalando dependencias del servidor...
  call npm install || goto :error
)
if not exist "web\node_modules" (
  echo  Instalando dependencias de la interfaz...
  call npm --prefix web install || goto :error
)
if not exist "web\dist\index.html" (
  echo  Compilando la interfaz...
  call npm run build || goto :error
)

echo.
echo  Vimo se esta iniciando en http://127.0.0.1:5180
echo  NO cierres esta ventana mientras uses Vimo.
echo.
start "" /b cmd /c "timeout /t 4 /nobreak >nul & start http://127.0.0.1:5180"
node --disable-warning=ExperimentalWarning server/src/index.js
pause
exit /b 0

:error
echo.
echo  [X] Algo fallo durante la instalacion. Revisa los mensajes de arriba.
pause
exit /b 1
