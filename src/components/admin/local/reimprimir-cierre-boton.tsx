"use client";

import { useState, useTransition } from "react";
import { Printer } from "lucide-react";
import { toast } from "sonner";

import { reimprimirCierre } from "@/lib/caja/cierre-print-actions";
import { cn } from "@/lib/utils";

/**
 * Reimprimir el papel de un cierre (spec 139 · D8).
 *
 * No es optimista **a propósito**: manda papel a una impresora del local, y un
 * "listo" que después no salió es peor que medio segundo de espera. Misma
 * frontera que la plata (spec 21).
 */
export function ReimprimirCierreBoton({
  slug,
  corteId,
  /** Un cierre anterior a la spec no tiene snapshot: no hay papel que emitir. */
  disponible,
}: {
  slug: string;
  corteId: string;
  disponible: boolean;
}) {
  const [enviando, startTransition] = useTransition();
  const [listo, setListo] = useState(false);

  if (!disponible) {
    return (
      <span
        className="inline-flex cursor-default items-center gap-1.5 rounded-full bg-zinc-100 px-4 py-2 text-xs font-semibold text-zinc-400"
        title="Este cierre es anterior al ticket en papel, así que no tiene un resumen congelado para imprimir."
      >
        <Printer className="size-3.5" />
        Sin papel
      </span>
    );
  }

  return (
    <button
      type="button"
      disabled={enviando}
      onClick={() =>
        startTransition(async () => {
          const res = await reimprimirCierre(corteId, slug);
          if (res.ok) {
            setListo(true);
            toast.success("Cierre mandado a la comandera.");
          } else {
            toast.error(res.error);
          }
        })
      }
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full bg-zinc-100 px-4 py-2 text-xs font-semibold text-zinc-700 transition hover:bg-zinc-200",
        enviando && "opacity-60",
      )}
    >
      <Printer className="size-3.5" />
      {enviando ? "Mandando…" : listo ? "Reimprimir de nuevo" : "Reimprimir"}
    </button>
  );
}
