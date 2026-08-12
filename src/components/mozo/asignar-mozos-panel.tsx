"use client";

import { useMemo, useState } from "react";
import { Check, Eraser, UserMinus, X } from "lucide-react";

import { initialsFromName, mozoColor } from "@/lib/mozo/colors";
import type { MozoMember } from "@/lib/mozo/queries";
import { cn } from "@/lib/utils";

/**
 * Panel "Distribuir mozos" — vive en el sidebar derecho del salón (mismo
 * slot que TableDetail / ActiveTablesList) y opera como paleta de pintura:
 * el encargado elige un mozo, después tapea las mesas en el plano grande
 * (que está en modo `paintMode`) y cada tap asigna ese mozo a la mesa.
 *
 * El panel no toca el server por sí mismo — solo informa qué mozo está
 * activo. El parent (SalonDesktop) hace la llamada a `assignMozoToTable`
 * cuando el plano dispara un click.
 *
 * La asignación es **fija**: persiste hasta que se cambia manualmente.
 * Cobrar / anular una mesa NO la desasigna (decisión 2026-05-08).
 */

export function AsignarMozosPanel({
  mozos,
  activeMozoId,
  onActiveMozoChange,
  countByMozo,
  totalSinAsignar,
  onDone,
  onClearAll,
}: {
  mozos: MozoMember[];
  /** Mozo seleccionado para "pintar" mesas. null = próximo tap desasigna. */
  activeMozoId: string | null;
  onActiveMozoChange: (id: string | null) => void;
  countByMozo: Record<string, number>;
  totalSinAsignar: number;
  onDone: () => void;
  /** Desasigna todas las mesas de una (reset de arranque de turno). */
  onClearAll: () => void;
}) {
  const targetMozos = useMemo(
    () => mozos.filter((m) => m.role === "mozo"),
    [mozos],
  );

  // Limpiar borra el trabajo de distribuir entero: confirmación en dos pasos,
  // igual que los borrados del catálogo.
  const [confirmClear, setConfirmClear] = useState(false);
  const totalAsignadas = useMemo(
    () => Object.values(countByMozo).reduce((acc, n) => acc + n, 0),
    [countByMozo],
  );

  return (
    <>
      {/* Header — mismo lenguaje que TableDetail. */}
      <header className="border-border/60 flex items-center justify-between gap-3 border-b px-4 py-3">
        <div className="min-w-0">
          <p className="text-[0.6rem] font-semibold tracking-[0.18em] text-zinc-500 uppercase">
            Modo pintura
          </p>
          <h3 className="text-foreground text-lg font-semibold tracking-tight">
            Distribuir mozos
          </h3>
        </div>
        <button
          type="button"
          onClick={onDone}
          className="hover:bg-muted -mr-1 inline-flex size-8 items-center justify-center rounded-md transition-colors"
          aria-label="Cerrar"
        >
          <X className="size-4" />
        </button>
      </header>

      {/* Lista de mozos — palette */}
      <div className="flex-1 space-y-3 overflow-y-auto p-4">
        <div className="flex items-center justify-between">
          <p className="text-[0.6rem] font-semibold tracking-[0.14em] text-zinc-500 uppercase">
            Mozos
          </p>
          {totalSinAsignar > 0 && (
            <span className="inline-flex items-center gap-1 rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-semibold text-zinc-700 tabular-nums">
              {totalSinAsignar} sin asignar
            </span>
          )}
        </div>

        {targetMozos.length === 0 ? (
          <p className="rounded-xl bg-zinc-50 p-3 text-xs text-zinc-500 ring-1 ring-zinc-200">
            No hay mozos cargados. Agregá empleados con rol &quot;mozo&quot;
            desde <span className="font-semibold">/admin/empleados</span>.
          </p>
        ) : (
          /* Dos columnas con el panel ancho (spec 111): con el equipo real
             estas filas bajas dejaban 700px vacíos y obligaban a scrollear
             justo la lista que hay que tapear. */
          <div className="grid grid-cols-1 gap-1.5 @xl:grid-cols-2">
            {targetMozos.map((m) => {
              const isActive = activeMozoId === m.user_id;
              const color = mozoColor(m.user_id);
              return (
                <button
                  key={m.user_id}
                  type="button"
                  onClick={() => onActiveMozoChange(m.user_id)}
                  className={cn(
                    "flex flex-shrink-0 items-center gap-2.5 rounded-xl px-3 py-2 text-left transition active:scale-[0.99]",
                    isActive
                      ? "bg-zinc-900 text-white shadow"
                      : "bg-zinc-50 text-zinc-700 hover:bg-zinc-100",
                  )}
                >
                  <span
                    className="flex size-9 flex-shrink-0 items-center justify-center rounded-full text-xs font-bold text-white ring-2 ring-white"
                    style={{ background: color }}
                  >
                    {initialsFromName(m.full_name ?? "?")}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p
                      className={cn(
                        "truncate text-sm font-semibold",
                        isActive ? "text-white" : "text-zinc-900",
                      )}
                    >
                      {m.full_name ?? "—"}
                    </p>
                    <p
                      className={cn(
                        "text-[0.65rem] tabular-nums",
                        isActive ? "text-zinc-300" : "text-zinc-500",
                      )}
                    >
                      {countByMozo[m.user_id] ?? 0} mesas
                    </p>
                  </div>
                  {isActive && (
                    <Check className="size-4 flex-shrink-0 text-white" />
                  )}
                </button>
              );
            })}

            {/* Desasignar */}
            <button
              type="button"
              onClick={() => onActiveMozoChange(null)}
              className={cn(
                // Fila completa: no es un mozo más, es la acción de la paleta.
                "flex flex-shrink-0 items-center gap-2.5 rounded-xl px-3 py-2 text-left transition active:scale-[0.99] @xl:col-span-2",
                activeMozoId === null
                  ? "bg-rose-100 text-rose-900 ring-1 ring-rose-300"
                  : "bg-zinc-50 text-zinc-600 hover:bg-zinc-100",
              )}
            >
              <span className="flex size-9 flex-shrink-0 items-center justify-center rounded-full bg-zinc-200 text-zinc-500 ring-2 ring-white">
                <UserMinus className="size-4" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">Desasignar</p>
                <p className="text-[0.65rem] text-zinc-500 tabular-nums">
                  {totalSinAsignar} mesas
                </p>
              </div>
            </button>
          </div>
        )}

        <p className="mt-2 rounded-xl bg-zinc-50 p-3 text-[0.7rem] leading-relaxed text-zinc-600 ring-1 ring-zinc-200 @xl:max-w-prose">
          Tocá un mozo y después las mesas que le tocan en el plano. Tap en una
          mesa ya asignada al mozo activo la desasigna. La asignación queda{" "}
          <span className="font-semibold">fija</span> hasta que la cambies.
        </p>
      </div>

      {/* Footer — CTA primario igual que TableDetail. */}
      <div className="border-border/60 space-y-2 border-t p-3">
        {confirmClear ? (
          <div className="flex items-center gap-2 rounded-2xl bg-rose-50 p-2 ring-1 ring-rose-200">
            <p className="min-w-0 flex-1 px-1 text-xs font-medium text-rose-900">
              ¿Desasignar las {totalAsignadas} mesas?
            </p>
            <button
              type="button"
              onClick={() => setConfirmClear(false)}
              className="rounded-xl px-3 py-2 text-xs font-semibold text-zinc-600 transition hover:bg-white"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={() => {
                setConfirmClear(false);
                onClearAll();
              }}
              className="rounded-xl bg-rose-600 px-3 py-2 text-xs font-semibold text-white transition hover:bg-rose-700 active:scale-[0.98]"
            >
              Limpiar
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setConfirmClear(true)}
            disabled={totalAsignadas === 0}
            className="flex h-11 w-full items-center justify-center gap-2 rounded-2xl bg-zinc-100 text-sm font-semibold text-zinc-700 transition hover:bg-zinc-200 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-40"
          >
            <Eraser className="h-4 w-4" />
            Limpiar distribución
          </button>
        )}

        <button
          type="button"
          onClick={onDone}
          className="flex h-14 w-full items-center justify-center gap-2 rounded-2xl text-base font-semibold shadow-sm transition active:scale-[0.98]"
          style={{
            background: "var(--brand, #18181B)",
            color: "var(--brand-foreground, white)",
          }}
        >
          <Check className="h-5 w-5" />
          Listo
        </button>
      </div>
    </>
  );
}
