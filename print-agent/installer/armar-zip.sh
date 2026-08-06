#!/usr/bin/env bash
# Arma print-agent.zip = relay print-agent.exe + instalador (bats/ps1/LEEME en CRLF).
# El .exe se compila aparte (pkg, node22-win-x64) y NO vive en el repo.
#
# Uso:  ./armar-zip.sh <ruta-al-print-agent.exe> [salida.zip]
set -euo pipefail

EXE="${1:?falta la ruta al print-agent.exe}"
OUT="${2:-print-agent.zip}"
HERE="$(cd "$(dirname "$0")" && pwd)"

[ -f "$EXE" ] || { echo "✗ no encuentro el .exe: $EXE" >&2; exit 1; }

# Ruta absoluta de salida (para no depender del cwd tras el cd).
case "$OUT" in /*) ;; *) OUT="$PWD/$OUT" ;; esac

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

cp "$EXE" "$TMP/print-agent.exe"
# Windows espera CRLF en los .bat; el repo los guarda en LF.
for f in instalar.bat iniciar-agente.bat registrar-tarea.ps1 LEEME.txt; do
  sed 's/$/\r/' "$HERE/$f" > "$TMP/$f"
done

rm -f "$OUT"
( cd "$TMP" && zip -q -X "$OUT" print-agent.exe instalar.bat iniciar-agente.bat registrar-tarea.ps1 LEEME.txt )
echo "✓ $OUT ($(du -h "$OUT" | cut -f1))"
