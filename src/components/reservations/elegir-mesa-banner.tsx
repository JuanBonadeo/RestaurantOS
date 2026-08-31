"use client";

import { MapPin } from "lucide-react";

/**
 * La barra de «el plano está esperando un tap» (spec 059, compartida en la 138).
 *
 * Vivía dentro de `salon-desktop`. El plano del día necesita exactamente la
 * misma señal —y tiene que verse igual, porque para el encargado es el mismo
 * gesto—, así que salió a un componente que usan los dos.
 */
export function ElegirMesaBanner({
  texto,
  onCancelar,
}: {
  texto: string;
  onCancelar: () => void;
}) {
  return (
    <div className="flex items-center gap-2 rounded-xl bg-indigo-600 px-3 py-2 text-white shadow-sm">
      <MapPin className="h-4 w-4 shrink-0 animate-pulse" />
      <span className="min-w-0 flex-1 text-sm font-semibold">{texto}</span>
      <button
        type="button"
        onClick={onCancelar}
        className="shrink-0 rounded-lg bg-white/15 px-2.5 py-1 text-xs font-bold transition hover:bg-white/25"
      >
        Cancelar
      </button>
    </div>
  );
}
