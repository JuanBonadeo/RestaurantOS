@echo off
setlocal

rem ── Auto-elevacion ────────────────────────────────────────────────────────
rem Registrar una tarea que corre como SYSTEM pide admin. Si nos ejecutaron sin
rem privilegios, nos relanzamos elevados y salimos.
net session >nul 2>&1
if errorlevel 1 (
  echo Pidiendo permisos de administrador...
  powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs -WorkingDirectory '%~dp0.'"
  exit /b
)

rem PROGRAMDATA y no LOCALAPPDATA: la tarea corre como SYSTEM, que no tiene el
rem perfil del usuario que instalo.
set "DEST=%PROGRAMDATA%\RestaurantOS-PrintAgent"
set "TAREA=RestaurantOS PrintAgent"

echo ==============================================
echo   Instalador del print-agent - RestaurantOS
echo ==============================================
echo.

if not exist "%~dp0print-agent.exe" (
  echo ERROR: no encuentro print-agent.exe junto a este instalador.
  echo Descomprimi el ZIP completo y corre instalar.bat desde ahi.
  pause
  exit /b 1
)

if not exist "%~dp0config.json" (
  echo ATENCION: no encuentro config.json en esta carpeta.
  echo.
  echo   1^) Descarga el instalador desde el panel ^(boton "Descargar instalador"^).
  echo   2^) Deja el config.json descargado junto a este instalar.bat.
  echo   3^) Volve a ejecutar instalar.bat.
  echo.
  pause
  exit /b 1
)

echo Frenando una instalacion anterior, si la hay...
schtasks /end    /tn "%TAREA%" >nul 2>&1
schtasks /delete /tn "%TAREA%" /f >nul 2>&1
taskkill /f /im print-agent.exe >nul 2>&1

echo Copiando archivos a:
echo   %DEST%
if not exist "%DEST%" mkdir "%DEST%"
copy /Y "%~dp0print-agent.exe"     "%DEST%\" >nul
copy /Y "%~dp0iniciar-agente.bat"  "%DEST%\" >nul
copy /Y "%~dp0config.json"         "%DEST%\" >nul

rem ── Tarea programada ──────────────────────────────────────────────────────
rem   AtStartup + SYSTEM  -> arranca aunque nadie inicie sesion, y al correr en
rem                          sesion 0 no muestra ventana (no molesta, y nadie la
rem                          puede cerrar con la X).
rem   RestartOnFailure    -> si el proceso muere entero, el Task Scheduler lo
rem                          vuelve a lanzar (el loop del .bat cubre el crash del
rem                          exe; esto cubre que muera el .bat).
rem   ExecutionTimeLimit 0-> sin esto Windows mata la tarea a las 72 h y el local
rem                          se queda sin impresion sin que nadie entienda por que.
rem   IgnoreNew           -> nunca dos agentes a la vez (duplicaria los tickets).
echo Registrando arranque automatico (al encender la PC, en segundo plano)...
copy /Y "%~dp0registrar-tarea.ps1" "%DEST%\" >nul
powershell -NoProfile -ExecutionPolicy Bypass -File "%DEST%\registrar-tarea.ps1" -Dest "%DEST%" -Tarea "%TAREA%"

if errorlevel 1 (
  echo.
  echo ERROR: no se pudo registrar la tarea programada.
  echo Anota lo que dice arriba y avisanos.
  pause
  exit /b 1
)

echo Arrancando el agente...
schtasks /run /tn "%TAREA%" >nul

echo.
echo LISTO.
echo.
echo   El agente arranca solo al ENCENDER la PC, sin que nadie inicie sesion,
echo   corre en segundo plano (sin ventana) y se levanta solo si se cae.
echo.
echo   Log:         %DEST%\agente.log
echo   Ver estado:  schtasks /query /tn "%TAREA%"
echo   Frenar:      schtasks /end   /tn "%TAREA%"
echo   Reinstalar:  volve a correr este instalar.bat
echo.
echo   Si venias de una version vieja, podes borrar la carpeta
echo   %LOCALAPPDATA%\RestaurantOS-PrintAgent
echo.
pause
