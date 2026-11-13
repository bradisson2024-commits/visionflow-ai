@echo off
title YOUTUBE AUTOMATIZADO
cd /d "%~dp0"
where node >nul 2>nul || (echo Falta Node.js. Descargalo de https://nodejs.org e instala la version LTS. & pause & exit /b 1)
where ffmpeg >nul 2>nul || (echo Falta FFmpeg. Instalalo con:  winget install Gyan.FFmpeg   y vuelve a abrir este archivo. & pause & exit /b 1)
start "" http://127.0.0.1:5317
node app\server.js
pause
