@echo off
rem Mantiene el print-agent corriendo: si el .exe se cierra, lo vuelve a levantar.
rem Se para en su propia carpeta para que encuentre el config.json de al lado.
rem
rem Esto corre SIN VENTANA (la tarea programada lo lanza como SYSTEM, en sesion 0),
rem asi que la unica forma de saber que paso es el log de aca abajo. Sin log, un
rem agente invisible que falla es indebuggeable.
cd /d "%~dp0"

set "LOG=%~dp0agente.log"

rem Rotacion pobre pero suficiente: si el log paso los ~5 MB, se descarta. Esto
rem corre meses sin que nadie lo mire; sin esto se come el disco.
for %%A in ("%LOG%") do if %%~zA GTR 5000000 del "%LOG%" >nul 2>&1

:loop
echo. >> "%LOG%"
echo ===== arrancando %DATE% %TIME% ===== >> "%LOG%"
print-agent.exe >> "%LOG%" 2>&1
echo ===== el agente termino (codigo %ERRORLEVEL%), reintento en 5s ===== >> "%LOG%"

rem `timeout` necesita una consola interactiva y revienta con "Input redirection
rem is not supported" cuando corre como SYSTEM. `ping` a loopback no depende de
rem la consola: 6 pings = ~5 segundos.
ping -n 6 127.0.0.1 >nul 2>&1
goto loop
