import "server-only";

import { notifyReservationExpired } from "@/lib/notifications/reservation-notify";
import {
  DEFAULT_APPROVAL_EXPIRY_MIN,
  isPendingExpired,
} from "@/lib/reservations/pending-expiry";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

type PendingRow = {
  id: string;
  business_id: string;
  starts_at: string;
  created_at: string;
  status: "pending";
};

/**
 * Spec 131 — barrido de solicitudes que el local nunca respondió.
 *
 * Multi-tenant y best-effort, gemelo de `sendDueReservationReminders`: lo
 * dispara el mismo tick de `pg_cron` cada 15 min. La regla de cuándo vence es
 * pura y vive en `pending-expiry.ts`; acá sólo se marca y se avisa.
 *
 * Marcar es lo que libera el lugar: `expired` sale de
 * `LIVE_RESERVATION_STATUSES` y del GIST, así que la mesa y los cubiertos
 * vuelven a estar disponibles sin que nadie toque nada.
 */
export async function expireStalePendingReservations(
  now: Date = new Date(),
): Promise<{ considered: number; expired: number }> {
  const service = createSupabaseServiceClient();

  const { data: rows } = await service
    .from("reservations")
    .select("id, business_id, starts_at, created_at, status")
    .eq("status", "pending");

  const pendings = (rows ?? []) as PendingRow[];
  if (pendings.length === 0) return { considered: 0, expired: 0 };

  // Una consulta de settings por negocio, no por reserva.
  const expiryByBusiness = new Map<string, number>();
  for (const businessId of new Set(pendings.map((r) => r.business_id))) {
    const { data } = await service
      .from("reservation_settings")
      .select("approval_expiry_min")
      .eq("business_id", businessId)
      .maybeSingle();
    const value = (data as { approval_expiry_min: number | null } | null)
      ?.approval_expiry_min;
    expiryByBusiness.set(businessId, value ?? DEFAULT_APPROVAL_EXPIRY_MIN);
  }

  let expired = 0;
  for (const reservation of pendings) {
    const expiryMin =
      expiryByBusiness.get(reservation.business_id) ?? DEFAULT_APPROVAL_EXPIRY_MIN;
    if (!isPendingExpired(reservation, expiryMin, now)) continue;

    // `eq("status", "pending")` es el candado: si el encargado la resolvió
    // entre el select y el update, este write no toca nada.
    const { data: updated, error } = await service
      .from("reservations")
      .update({ status: "expired", decided_at: now.toISOString() })
      .eq("id", reservation.id)
      .eq("status", "pending")
      .select("id");
    if (error) {
      console.error("expireStalePendingReservations", reservation.id, error);
      continue;
    }
    if (!updated || updated.length === 0) continue;

    expired += 1;
    try {
      await notifyReservationExpired({ reservationId: reservation.id });
    } catch (err) {
      console.error("expireStalePendingReservations/notify", reservation.id, err);
    }
  }

  return { considered: pendings.length, expired };
}
