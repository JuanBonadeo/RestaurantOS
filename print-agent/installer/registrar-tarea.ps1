# Registra la tarea programada del print-agent (issue #152).
#
# Vive aparte del .bat a proposito: armar este comando inline en cmd exige
# escapar comillas dentro de comillas dentro de `powershell -Command`, y es
# justo el tipo de bug que aparece recien en la PC del cliente, donde
# debuggear cuesta un TeamViewer.
#
# Por que cada opcion:
#   AtStartup + SYSTEM   -> arranca al ENCENDER la PC, sin que nadie inicie
#                           sesion (un corte de luz de noche no deja al local
#                           sin impresion a la mañana). Al correr en sesion 0
#                           ademas no tiene ventana: no molesta y nadie la
#                           puede cerrar con la X.
#   RestartOnFailure     -> el loop de iniciar-agente.bat cubre "se cayo el
#                           exe"; esto cubre que muera el .bat entero.
#   ExecutionTimeLimit 0 -> sin esto Windows mata la tarea a las 72 h. Un local
#                           que no reinicia en una semana se queda sin imprimir
#                           y nadie entiende por que.
#   IgnoreNew            -> nunca dos agentes a la vez: duplicaria los tickets.

param(
  [Parameter(Mandatory = $true)][string] $Dest,
  [Parameter(Mandatory = $true)][string] $Tarea
)

$ErrorActionPreference = 'Stop'

try {
  $accion = New-ScheduledTaskAction `
    -Execute (Join-Path $Dest 'iniciar-agente.bat') `
    -WorkingDirectory $Dest

  $disparador = New-ScheduledTaskTrigger -AtStartup

  $principal = New-ScheduledTaskPrincipal `
    -UserId 'SYSTEM' `
    -LogonType ServiceAccount `
    -RunLevel Highest

  $opciones = New-ScheduledTaskSettingsSet `
    -MultipleInstances IgnoreNew `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable `
    -ExecutionTimeLimit ([TimeSpan]::Zero) `
    -RestartInterval (New-TimeSpan -Minutes 1) `
    -RestartCount 999

  Register-ScheduledTask `
    -TaskName $Tarea `
    -Action $accion `
    -Trigger $disparador `
    -Principal $principal `
    -Settings $opciones `
    -Force | Out-Null

  Write-Host "Tarea '$Tarea' registrada."
  exit 0
}
catch {
  Write-Host "ERROR registrando la tarea: $($_.Exception.Message)"
  exit 1
}
