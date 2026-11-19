@echo off
rem Apaga Cenit Studio (el servidor en segundo plano).
echo detener > "%~dp0detener.flag"
for /f "tokens=5" %%p in ('netstat -ano ^| findstr /r /c:":8080 .*LISTENING"') do taskkill /PID %%p /F >nul 2>&1
echo Cenit Studio se ha apagado.
timeout /t 3 >nul
