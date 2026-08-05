import { formatInTimeZone, fromZonedTime } from "date-fns-tz";

import { flexibleServiceWindow } from "@/lib/reservations/flexible-availability";
import type { ReservationService } from "@/lib/reservations/types";

/**
 * Spec 097 — cálculo de la ventana `[starts_at, ends_at)` que deja una EDICIÓN
 * de reserva. Puro y testeable: la action sólo orquesta permisos, datos y
 * escritura.
 *
 * Los dos modos derivan el cierre distinto y no hay que mezclarlos:
 * - **estricto**: `starts + slot_duration_min` (la grilla de slots).
 * - **flexible**: el **cierre del servicio** (spec 059 — la hora ancla, el
 *   bloqueo llega hasta que cierra).
 *
 * En los dos, la **fecha no cambia**: la hora nueva se interpreta en el día
 * local que la reserva ya tiene (spec 097, RF-03).
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Cola de los errores de **cupo blando** (spec 077): el encargado puede pasarse
 * confirmando. La action la agrega al mensaje y la UI la usa para ofrecer
 * "Guardar igual" en vez de tratarlo como un rechazo definitivo. Vive acá y no
 * en la action porque un módulo `"use server"` sólo puede exportar funciones.
 */
export const OVERBOOK_HINT = "Confirmá para guardar igual.";

export type EditWindow = { starts: Date; ends: Date };

/** Día local ("YYYY-MM-DD") de un instante, en la TZ del negocio. */
export function localDateOf(instant: Date, timezone: string): string {
  return formatInTimeZone(instant, timezone, "yyyy-MM-dd");
}

/**
 * Ventana resultante de mover una reserva del modo **estricto** a `time`
 * ("HH:MM" local) dentro de su mismo día. `null` si el arranque actual o la
 * hora nueva no son válidos — llamar sólo cuando hay cambio de horario.
 */
export function estrictoEditWindow(params: {
  currentStartsAt: string;
  time: string;
  timezone: string;
  slotDurationMin: number;
}): EditWindow | null {
  const current = new Date(params.currentStartsAt);
  if (Number.isNaN(current.getTime())) return null;

  const date = localDateOf(current, params.timezone);
  const starts = fromZonedTime(`${date}T${params.time}:00`, params.timezone);
  if (Number.isNaN(starts.getTime())) return null;

  return {
    starts,
    ends: new Date(starts.getTime() + params.slotDurationMin * 60_000),
  };
}

export type FlexibleEditWindowResult =
  | ({ ok: true } & EditWindow)
  | { ok: false; reason: "ventana-invalida" | "hora-invalida" | "fuera-de-servicio" };

/**
 * Ventana resultante de editar una reserva del modo **flexible**.
 *
 * - Con `time`: es la hora de llegada nueva, y tiene que caer dentro de la
 *   ventana del servicio.
 * - Sin `time`: si cambió de servicio arranca en la **apertura** del nuevo; si
 *   no, conserva el arranque que ya tenía.
 *
 * El cierre siempre es el del servicio.
 */
export function flexibleEditWindow(params: {
  /** Día local del servicio ("YYYY-MM-DD"), ya resuelto por el caller. */
  serviceDate: string;
  service: Pick<ReservationService, "opens_at" | "closes_at">;
  timezone: string;
  time?: string | null;
  serviceChanged: boolean;
  currentStartsAt: string;
}): FlexibleEditWindowResult {
  const window = flexibleServiceWindow(params.serviceDate, params.service, params.timezone);
  if (!window) return { ok: false, reason: "ventana-invalida" };

  let starts: Date;
  if (params.time) {
    starts = fromZonedTime(`${params.serviceDate}T${params.time}:00`, params.timezone);
    if (Number.isNaN(starts.getTime())) return { ok: false, reason: "hora-invalida" };
    // Servicio que cruza la medianoche: "00:15" es del día siguiente, no de
    // las 00:15 del día en que abrió el servicio.
    if (starts.getTime() < window.starts.getTime()) {
      const nextDay = new Date(starts.getTime() + DAY_MS);
      if (nextDay.getTime() < window.ends.getTime()) starts = nextDay;
    }
  } else if (params.serviceChanged) {
    starts = window.starts;
  } else {
    starts = new Date(params.currentStartsAt);
    if (Number.isNaN(starts.getTime())) return { ok: false, reason: "hora-invalida" };
  }

  if (starts.getTime() < window.starts.getTime() || starts.getTime() >= window.ends.getTime()) {
    return { ok: false, reason: "fuera-de-servicio" };
  }

  return { ok: true, starts, ends: window.ends };
}
