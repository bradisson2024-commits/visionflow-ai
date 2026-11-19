@echo off
rem Mantiene Cenit Studio encendido en segundo plano: si el servidor se cierra por un error, vuelve a arrancarlo.
cd /d "%~dp0.."
if exist "%~dp0detener.flag" del "%~dp0detener.flag"
netstat -ano | findstr /r /c:":8080 .*LISTENING" >nul && exit /b 0
:bucle
echo [%date% %time%] Arrancando Cenit Studio >> "%~dp0cenit.log"
node server\main.js >> "%~dp0cenit.log" 2>&1
if exist "%~dp0detener.flag" (del "%~dp0detener.flag" & exit /b 0)
timeout /t 3 /nobreak >nul
goto bucle
