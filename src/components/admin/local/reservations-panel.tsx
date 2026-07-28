"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { CalendarPlus, Clock, UserCheck, UserX, X } from "lucide-react";
import { toast } from "sonner";

import { sentarReserva } from "@/lib/reservations/booking-actions";
import {
  updateReservationDetails,
  updateReservationStatus,
} from "@/lib/reservations/booking-actions";

import type { SalonReservationRef } from "./salon-desktop";

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("es-AR", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

export function ReservationsPanel({
  reservations,
  slug,
  tableLabelById,
  tables = [],
  onNewReservation,
}: {
  reservations: SalonReservationRef[];
  slug: string;
  tableLabelById: Record<string, string>;
  /** Mesas activas del salón — para asignar/cambiar la mesa de una reserva
   *  desde acá (spec 059: las flexibles pueden venir sin mesa). */
  tables?: Array<{ id: string; label: string; seats: number }>;
  onNewReservation?: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const confirmed = reservations.filter((r) => r.status === "confirmed");

  if (confirmed.length === 0 && !onNewReservation) return null;

  const handleSentar = (reservationId: string) => {
    startTransition(async () => {
      const result = await sentarReserva({
        business_slug: slug,
        reservation_id: reservationId,
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Mesa abierta con reserva.");
      router.refresh();
    });
  };

  const handleNoShow = (reservationId: string) => {
    startTransition(async () => {
      const result = await updateReservationStatus({
        business_slug: slug,
        id: reservationId,
        status: "no_show",
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Marcada como no vino.");
      router.refresh();
    });
  };

  /** Asignar (o cambiar) la mesa de una reserva confirmada. El server valida
   *  capacidad, cross-tenant y solape; la fuente de verdad es el constraint. */
  const handleAsignarMesa = (
    reservationId: string,
    tableId: string,
    partySize: number,
  ) => {
    startTransition(async () => {
      const result = await updateReservationDetails({
        business_slug: slug,
        reservation_id: reservationId,
        table_id: tableId,
        party_size: partySize,
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Mesa asignada.");
      router.refresh();
    });
  };

  const handleCancel = (reservationId: string) => {
    startTransition(async () => {
      const result = await updateReservationStatus({
        business_slug: slug,
        id: reservationId,
        status: "cancelled",
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Reserva cancelada.");
      router.refresh();
    });
  };

  return (
    <div className="border-border/60 border-b">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-2.5">
        <Clock className="h-4 w-4 text-zinc-400" />
        <span className="text-sm font-semibold text-zinc-700">
          Reservas hoy
        </span>
        {confirmed.length > 0 && (
          <span className="rounded-full bg-blue-100 px-1.5 py-0.5 text-[10px] font-bold text-blue-700">
            {confirmed.length}
          </span>
        )}
        <div className="flex-1" />
        {onNewReservation && (
          <button
            type="button"
            onClick={onNewReservation}
            className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-blue-600 transition hover:bg-blue-50"
          >
            <CalendarPlus className="h-3.5 w-3.5" />
            Nueva
          </button>
        )}
      </div>

      {/* Lista */}
      {confirmed.length === 0 ? (
        <p className="px-4 pb-3 text-xs text-zinc-400">
          No hay reservas pendientes de sentar.
        </p>
      ) : (
        <div className="max-h-48 space-y-1 overflow-y-auto px-3 pb-3">
          {confirmed.map((r) => (
            <div
              key={r.id}
              className="flex items-center gap-2 rounded-xl bg-zinc-50 px-3 py-2 ring-1 ring-zinc-200/60"
            >
              {/* Info */}
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-1.5">
                  <span className="text-sm font-bold text-zinc-800">
                    {formatTime(r.starts_at)}
                  </span>
                  <span className="truncate text-sm text-zinc-600">
                    {r.customer_name}
                  </span>
                </div>
                <div className="mt-0.5 flex items-center gap-2 text-[11px] text-zinc-500">
                  <span>{r.party_size}p</span>
                  <span>·</span>
                  {tables.length > 0 ? (
                    // Asignar/cambiar la mesa desde el salón. Las reservas
                    // flexibles pueden venir sin mesa (se define al llegar).
                    <select
                      value={r.table_id ?? ""}
                      disabled={pending}
                      onChange={(e) => {
                        const v = e.target.value;
                        if (v) handleAsignarMesa(r.id, v, r.party_size);
                      }}
                      className={`-ml-1 max-w-[9rem] truncate rounded-md border-none bg-transparent px-1 py-0.5 text-[11px] font-medium focus:outline-none focus:ring-1 focus:ring-blue-300 ${
                        r.table_id ? "text-zinc-600" : "text-blue-600"
                      }`}
                      aria-label="Mesa de la reserva"
                    >
                      <option value="">Sin mesa — asignar</option>
                      {tables.map((t) => (
                        <option key={t.id} value={t.id}>
                          Mesa {t.label} ({t.seats})
                        </option>
                      ))}
                    </select>
                  ) : r.table_id && tableLabelById[r.table_id] ? (
                    <span>Mesa {tableLabelById[r.table_id]}</span>
                  ) : (
                    <span>Sin mesa</span>
                  )}
                </div>
              </div>

              {/* Actions */}
              <div className="flex shrink-0 items-center gap-1">
                <button
                  type="button"
                  onClick={() => handleSentar(r.id)}
                  disabled={pending}
                  className="flex items-center gap-1 rounded-lg bg-emerald-600 px-2.5 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:bg-emerald-700 active:scale-[0.97] disabled:opacity-60"
                >
                  <UserCheck className="h-3.5 w-3.5" />
                  Sentar
                </button>
                <button
                  type="button"
                  onClick={() => handleNoShow(r.id)}
                  disabled={pending}
                  title="No vino"
                  className="flex h-7 w-7 items-center justify-center rounded-lg text-zinc-400 transition hover:bg-zinc-200 hover:text-zinc-600 disabled:opacity-60"
                >
                  <UserX className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => handleCancel(r.id)}
                  disabled={pending}
                  title="Cancelar"
                  className="flex h-7 w-7 items-center justify-center rounded-lg text-zinc-400 transition hover:bg-red-50 hover:text-red-500 disabled:opacity-60"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
