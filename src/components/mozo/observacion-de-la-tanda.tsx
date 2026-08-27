"use client";

import { useState } from "react";
import { MessageSquarePlus, X } from "lucide-react";

import { OBSERVACION_MAX } from "@/lib/comandas/observacion";

/**
 * La observación de la tanda (spec 128): lo que el mozo escribe **una vez** al
 * enviar y sale igual en las comandas de todos los sectores de ese envío.
 *
 * Vive acá y no adentro de la columna de la mesa porque el mozo carga desde dos
 * lugares —el panel del salón (`MesaColumn`) y la pantalla del teléfono (paso
 * «resumen»)— y una observación que existe en uno solo es una que no se usa.
 *
 * **Plegado por default.** El camino feliz de la hora pico es un tap en
 * «Enviar» sin pasar por ningún campo; esto es la puerta para cuando hay algo
 * que decir, no un paso más.
 *
 * **Con texto cargado no se pliega**: se envía lo que se ve. Un campo que
 * esconde lo que escribiste hace diez minutos manda «la mesa tiene apuro» a
 * una tanda de postres.
 */
export function ObservacionDeLaTanda({
  value,
  onChange,
  className = "",
}: {
  value: string;
  onChange: (v: string) => void;
  className?: string;
}) {
  const [abiertaManual, setAbiertaManual] = useState(false);
  const abierta = abiertaManual || value.length > 0;

  if (!abierta) {
    return (
      <button
        type="button"
        onClick={() => setAbiertaManual(true)}
        className={`flex h-11 w-full items-center justify-center gap-2 rounded-xl text-sm font-semibold text-zinc-500 ring-1 ring-zinc-200 transition ring-inset active:scale-[0.99] ${className}`}
      >
        <MessageSquarePlus className="h-4 w-4" />
        Observación para cocina
      </button>
    );
  }

  return (
    <div
      className={`rounded-xl bg-amber-50 px-2.5 py-2 ring-1 ring-amber-200 ${className}`}
    >
      <div className="flex items-center justify-between gap-2">
        <label
          htmlFor="observacion-de-la-tanda"
          className="text-[11px] font-bold tracking-wide text-amber-900 uppercase"
        >
          Observación para cocina
        </label>
        <div className="flex items-center gap-1">
          <span className="text-[10px] font-semibold text-amber-700/70 tabular-nums">
            {value.length}/{OBSERVACION_MAX}
          </span>
          <button
            type="button"
            onClick={() => {
              onChange("");
              setAbiertaManual(false);
            }}
            aria-label="Quitar la observación"
            className="flex h-6 w-6 items-center justify-center rounded-full text-amber-700 active:bg-amber-100"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
      <textarea
        id="observacion-de-la-tanda"
        value={value}
        // El tope se aplica también acá y no sólo en el server: el contador
        // tiene que decir la verdad, y lo que se ve escrito es lo que sale
        // impreso.
        maxLength={OBSERVACION_MAX}
        onChange={(e) => onChange(e.target.value.slice(0, OBSERVACION_MAX))}
        rows={2}
        placeholder="va todo junto, la mesa tiene apuro…"
        className="mt-1 w-full resize-none rounded-lg bg-white px-2 py-1.5 text-sm text-zinc-900 ring-1 ring-amber-200 outline-none placeholder:text-zinc-400 focus:ring-2 focus:ring-amber-400"
      />
      <p className="mt-1 text-[10px] leading-snug text-amber-800/80">
        Sale arriba de los ítems en todas las comandas de este envío. Para un
        plato solo, usá la nota del ítem.
      </p>
    </div>
  );
}
