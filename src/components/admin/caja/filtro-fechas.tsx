"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";

import {
  GRANULARIDADES,
  anclaDeHoy,
  desplazar,
  esPresente,
  etiquetaDe,
  type Ancla,
  type Granularidad,
} from "@/lib/caja/rango-fechas";
import { cn } from "@/lib/utils";

/**
 * El filtro de fechas de Caja (spec 153 · D4).
 *
 * Reemplaza los dos `<input type="date">` de «Desde»/«Hasta»: primero la
 * granularidad, después se navega de a uno. El 90 % de las veces se quiere
 * «ayer» o «el mes pasado», y con dos calendarios eso son cuatro toques.
 *
 * El estado vive en la URL (`?gran=&fecha=`) y no en el componente: así el
 * server arma el rango, la vuelta atrás del navegador funciona, y el link se
 * puede pegar en un mensaje.
 */
export function FiltroFechas({
  basePath,
  gran,
  ancla,
  timezone,
  /** Parámetros de la URL que hay que conservar al cambiar de fecha. */
  extra,
}: {
  basePath: string;
  gran: Granularidad;
  ancla: Ancla;
  timezone: string;
  extra?: Record<string, string | undefined>;
}) {
  const router = useRouter();
  const [pendiente, startTransition] = useTransition();

  function ir(siguiente: { gran?: Granularidad; ancla?: Ancla }) {
    const g = siguiente.gran ?? gran;
    // Cambiar de granularidad reancla en el período corriente: pasar de «lun
    // 31/8» a Mes debería dar «Este mes», no «Agosto» — el usuario está
    // cambiando de lente, no viajando en el tiempo.
    const a = siguiente.ancla ?? (siguiente.gran ? anclaDeHoy(g, timezone) : ancla);
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(extra ?? {})) if (v) params.set(k, v);
    params.set("gran", g);
    params.set("fecha", a);
    startTransition(() => router.push(`${basePath}?${params.toString()}`));
  }

  const enElPresente = esPresente(gran, ancla, timezone);

  return (
    <div className={cn("flex flex-wrap items-center gap-3", pendiente && "opacity-70")}>
      <div className="flex gap-1 rounded-2xl bg-white p-1.5 ring-1 ring-zinc-200/70">
        {GRANULARIDADES.map((g) => (
          <button
            key={g.id}
            type="button"
            onClick={() => ir({ gran: g.id })}
            aria-pressed={g.id === gran}
            className={cn(
              "rounded-xl px-4 py-1.5 text-sm font-semibold transition active:scale-[0.97]",
              g.id === gran
                ? "bg-zinc-900 text-white shadow-sm"
                : "text-zinc-700 hover:bg-zinc-100",
            )}
          >
            {g.label}
          </button>
        ))}
      </div>

      <div className="flex items-center gap-1 rounded-2xl bg-white p-1.5 ring-1 ring-zinc-200/70">
        <button
          type="button"
          onClick={() => ir({ ancla: desplazar(gran, ancla, -1) })}
          className="grid size-8 place-items-center rounded-full text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-900 active:scale-95"
          aria-label="Período anterior"
        >
          <ChevronLeft className="size-4" />
        </button>
        <span className="min-w-[9rem] text-center text-[0.9375rem] font-semibold text-zinc-900">
          {etiquetaDe(gran, ancla, timezone)}
        </span>
        <button
          type="button"
          // No hay cierres mañana: en el presente la flecha se apaga en vez de
          // dejar navegar a un rango que siempre va a estar vacío.
          disabled={enElPresente}
          onClick={() => ir({ ancla: desplazar(gran, ancla, 1) })}
          className={cn(
            "grid size-8 place-items-center rounded-full transition",
            enElPresente
              ? "cursor-default text-zinc-300"
              : "text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 active:scale-95",
          )}
          aria-label="Período siguiente"
        >
          <ChevronRight className="size-4" />
        </button>
      </div>
    </div>
  );
}
