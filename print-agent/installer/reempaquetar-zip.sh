#!/usr/bin/env bash
# Re-arma print-agent.zip conservando el .exe que ya está publicado.
#
# Para cambios que tocan SOLO el instalador (instalar.bat, iniciar-agente.bat,
# registrar-tarea.ps1, LEEME.txt) y no `agent.mjs`. Recompilar el exe en ese
# caso es riesgo sin beneficio: el build cross-platform desde macOS es el que
# mete el bytecode que el V8 de Windows rechaza (ver build/README.md), y acá no
# hay ni una línea de agente que haya cambiado.
#
# Uso:  ./reempaquetar-zip.sh <print-agent.zip-actual> [salida.zip]
set -euo pipefail

ZIP_IN="${1:?falta el print-agent.zip actual (bajalo del panel o del bucket)}"
OUT="${2:-print-agent.zip}"
HERE="$(cd "$(dirname "$0")" && pwd)"

[ -f "$ZIP_IN" ] || { echo "✗ no encuentro el zip: $ZIP_IN" >&2; exit 1; }
case "$OUT" in /*) ;; *) OUT="$PWD/$OUT" ;; esac

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

unzip -q -o "$ZIP_IN" print-agent.exe -d "$TMP" \
  || { echo "✗ el zip no contiene print-agent.exe" >&2; exit 1; }

"$HERE/armar-zip.sh" "$TMP/print-agent.exe" "$OUT"
