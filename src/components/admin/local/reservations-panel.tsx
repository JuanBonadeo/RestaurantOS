"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  CalendarPlus,
  Clock,
  MapPin,
  MoreVertical,
  UserCheck,
  UserX,
  X,
} from "lucide-react";
import { toast } from "sonner";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { sentarReserva } from "@/lib/reservations/booking-actions";
import { updateReservationStatus } from "@/lib/reservations/booking-actions";

import type { SalonReservationRef } from "./salon-desktop";

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("es-AR", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function ReservationsPanel({
  reservations,
  slug,
  tableLabelById,
  pickingForId = null,
  onAsignarMesa,
  onNewReservation,
}: {
  reservations: SalonReservationRef[];
  slug: string;
  tableLabelById: Record<string, string>;
  /** Reserva que está esperando que toquen una mesa en el plano (spec 059). */
  pickingForId?: string | null;
  /** Pone el plano del salón en modo "elegí una mesa" para esta reserva.
   *  `intent: "seat"` = elegir la mesa Y sentar en el mismo gesto. */
  onAsignarMesa?: (
    reservation: SalonReservationRef,
    intent: "assign" | "seat",
  ) => void;
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
      toast.success("Reserva sentada.");
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
        <span className="text-sm font-semibold text-zinc-700">Reservas hoy</span>
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
            className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-bold text-white shadow-sm transition hover:bg-blue-700 active:scale-[0.97]"
          >
            <CalendarPlus className="h-3.5 w-3.5" />
            Nueva reserva
          </button>
        )}
      </div>

      {/* Lista — una fila por reserva, compacta */}
      {confirmed.length === 0 ? (
        <p className="px-4 pb-3 text-xs text-zinc-400">
          No hay reservas pendientes de sentar.
        </p>
      ) : (
        <div className="max-h-48 space-y-1 overflow-y-auto px-3 pb-3">
          {confirmed.map((r) => {
            const tableLabel = r.table_id ? tableLabelById[r.table_id] : null;
            const canPickOnPlan = !!onAsignarMesa;
            const picking = pickingForId === r.id;
            return (
              <div
                key={r.id}
                className="flex items-center gap-2 rounded-xl bg-zinc-50 px-3 py-1.5 ring-1 ring-zinc-200/60"
              >
                {/* Info en una sola línea */}
                <div className="flex min-w-0 flex-1 items-baseline gap-1.5">
                  <span className="text-sm font-bold tabular-nums text-zinc-800">
                    {formatTime(r.starts_at)}
                  </span>
                  <span className="truncate text-sm text-zinc-600">{r.customer_name}</span>
                  <span className="shrink-0 text-[11px] text-zinc-400">
                    · {r.party_size}p
                    {tableLabel ? ` · Mesa ${tableLabel}` : ""}
                  </span>
                </div>

                {/* Acción primaria: SIEMPRE sentar. Sin mesa (reserva genérica
                    del modo flexible) la mesa se elige en el plano y se sienta
                    en el mismo gesto — antes había que asignar y después sentar. */}
                <button
                  type="button"
                  onClick={() =>
                    r.table_id ? handleSentar(r.id) : onAsignarMesa?.(r, "seat")
                  }
                  disabled={pending || (!r.table_id && !canPickOnPlan)}
                  className={`flex shrink-0 items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-white shadow-sm transition active:scale-[0.97] disabled:opacity-60 ${
                    picking
                      ? "bg-emerald-700 ring-2 ring-emerald-300"
                      : "bg-emerald-600 hover:bg-emerald-700"
                  }`}
                >
                  {picking ? (
                    <MapPin className="h-3.5 w-3.5" />
                  ) : (
                    <UserCheck className="h-3.5 w-3.5" />
                  )}
                  {picking ? "Elegí en el plano…" : "Sentar"}
                </button>

                {/* Resto de acciones */}
                <DropdownMenu>
                  <DropdownMenuTrigger
                    aria-label="Más acciones"
                    disabled={pending}
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-zinc-500 transition hover:bg-zinc-200 hover:text-zinc-700 disabled:opacity-60"
                  >
                    <MoreVertical className="h-4 w-4" />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-44">
                    {canPickOnPlan ? (
                      <>
                        <DropdownMenuItem onClick={() => onAsignarMesa?.(r, "assign")}>
                          <MapPin className="h-4 w-4" />
                          {r.table_id ? "Reasignar mesa" : "Asignar mesa (sin sentar)"}
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                      </>
                    ) : null}
                    <DropdownMenuItem onClick={() => handleNoShow(r.id)}>
                      <UserX className="h-4 w-4" />
                      No vino
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      variant="destructive"
                      onClick={() => handleCancel(r.id)}
                    >
                      <X className="h-4 w-4" />
                      Cancelar reserva
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            );
          })}
        </div>
      )}

    </div>
  );
}
