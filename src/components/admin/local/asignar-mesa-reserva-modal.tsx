"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import { toast } from "sonner";

import { FloorPlanViewer, type TableExtra } from "@/components/mozo/floor-plan-viewer";
import { updateReservationDetails } from "@/lib/reservations/booking-actions";
import type { FloorPlanWithTables } from "@/lib/admin/floor-plan/queries";
import type { FloorTable } from "@/lib/reservations/types";

/**
 * Elegir la mesa de una reserva **tocándola en el plano** (spec 059). Es más
 * intuitivo que un `<select>`: el encargado ve la distribución real, qué está
 * ocupado y qué ya tiene reserva (badge "R") antes de decidir.
 *
 * Reusa el `FloorPlanViewer` del salón y los `extras` que la vista ya calcula,
 * así el plano del modal se ve igual que el de atrás.
 */
export function AsignarMesaReservaModal({
  slug,
  reservation,
  floorPlans,
  extras = {},
  onClose,
}: {
  slug: string;
  reservation: {
    id: string;
    customer_name: string;
    party_size: number;
    table_id: string | null;
  };
  floorPlans: FloorPlanWithTables[];
  extras?: Record<string, TableExtra>;
  onClose: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  // Arranca en el salón de la mesa actual (si tiene), si no en el primero.
  const [planIdx, setPlanIdx] = useState(() => {
    if (!reservation.table_id) return 0;
    const i = floorPlans.findIndex((fp) =>
      fp.tables.some((t) => t.id === reservation.table_id),
    );
    return i >= 0 ? i : 0;
  });

  const current = floorPlans[planIdx];

  function onPick(table: FloorTable) {
    if (table.id === reservation.table_id) {
      onClose();
      return;
    }
    if (table.seats < reservation.party_size) {
      toast.error(
        `Mesa ${table.label} tiene ${table.seats} lugares para ${reservation.party_size} personas.`,
      );
      return;
    }
    startTransition(async () => {
      const result = await updateReservationDetails({
        business_slug: slug,
        reservation_id: reservation.id,
        table_id: table.id,
        party_size: reservation.party_size,
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(`Mesa ${table.label} asignada.`);
      router.refresh();
      onClose();
    });
  }

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="flex h-[80vh] w-full max-w-3xl flex-col rounded-3xl bg-white p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="font-heading text-lg font-bold leading-tight">
              {reservation.table_id ? "Reasignar mesa" : "Asignar mesa"}
            </h3>
            <p className="text-sm text-zinc-500">
              {reservation.customer_name} · {reservation.party_size}p — tocá la mesa en el
              plano.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar"
            className="-mr-1 -mt-1 rounded-full p-2 text-zinc-500 transition active:scale-95 active:bg-zinc-100"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {floorPlans.length > 1 ? (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {floorPlans.map((fp, i) => (
              <button
                key={fp.plan.id}
                type="button"
                onClick={() => setPlanIdx(i)}
                className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${
                  i === planIdx
                    ? "bg-zinc-900 text-white"
                    : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200"
                }`}
              >
                {fp.plan.name}
              </button>
            ))}
          </div>
        ) : null}

        <div className="mt-3 min-h-0 flex-1">
          {current ? (
            <FloorPlanViewer
              plan={current.plan}
              tables={current.tables}
              extras={extras}
              onTableClick={pending ? undefined : onPick}
            />
          ) : (
            <p className="text-sm text-zinc-500">Este negocio no tiene planos cargados.</p>
          )}
        </div>

        <p className="pt-2 text-center text-xs text-zinc-400">
          {pending
            ? "Asignando…"
            : "La mesa queda reservada para este servicio. El badge R marca las ya reservadas."}
        </p>
      </div>
    </div>
  );
}
