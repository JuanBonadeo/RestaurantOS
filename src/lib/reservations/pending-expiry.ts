import type { Reservation } from "@/lib/reservations/types";

/** Piso duro: una pendiente nunca vence antes de darle este rato al local. */
export const MIN_PENDING_WINDOW_MIN = 15;

/** Default de `reservation_settings.approval_expiry_min` (migración 0053). */
export const DEFAULT_APPROVAL_EXPIRY_MIN = 120;

type PendingLike = Pick<Reservation, "status" | "starts_at" | "created_at">;

/**
 * Spec 131 — cuándo vence una solicitud sin respuesta del local.
 *
 * Normalmente `expiryMin` antes del turno: a esa altura el local ya tiene que
 * saber si la toma, y el cliente todavía llega a hacer otra cosa. El `max` con
 * el piso evita el caso patológico de la reserva cargada para dentro de un
 * rato, que si no moriría antes de que nadie la haya podido mirar.
 *
 * Función pura: el barrido (`expireStalePendingReservations`) sólo la consulta.
 */
export function pendingExpiresAt(
  reservation: Pick<Reservation, "starts_at" | "created_at">,
  expiryMin: number = DEFAULT_APPROVAL_EXPIRY_MIN,
): Date {
  const beforeService =
    new Date(reservation.starts_at).getTime() - expiryMin * 60_000;
  const floor =
    new Date(reservation.created_at).getTime() + MIN_PENDING_WINDOW_MIN * 60_000;
  return new Date(Math.max(beforeService, floor));
}

/** ¿Esta pendiente ya venció? Falso para cualquier estado que no sea `pending`. */
export function isPendingExpired(
  reservation: PendingLike,
  expiryMin: number,
  now: Date,
): boolean {
  if (reservation.status !== "pending") return false;
  return pendingExpiresAt(reservation, expiryMin).getTime() <= now.getTime();
}
