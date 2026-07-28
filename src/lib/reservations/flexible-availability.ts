import { fromZonedTime } from "date-fns-tz";

import type { FloorTable, Reservation, ReservationService } from "@/lib/reservations/types";
import { LIVE_RESERVATION_STATUSES } from "@/lib/reservations/types";

/**
 * Motor de disponibilidad del **modo flexible** (spec 059) — "libro de reservas".
 *
 * A diferencia del estricto (`availability.ts`, slots de 90 min + `pickTable`),
 * acá no hay grilla de horarios: se razona por **servicio** (mediodía/cena) y la
 * regla dura es **una reserva por (mesa, servicio, fecha)**. La mesa es opcional;
 * las genéricas cuentan sólo para la **capacidad blanda** (advisory, no bloquea).
 *
 * Todo puro y testeable — la fuente de verdad de la integridad sigue siendo la
 * base (el GIST con `ends_at = cierre del servicio`).
 */

const HHMM_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const DAY_MS = 24 * 60 * 60 * 1000;

export type ServiceWindow = { starts: Date; ends: Date };

/** Campos mínimos de una reserva que necesita este motor. */
export type ReservationForFlexible = Pick<
  Reservation,
  "table_id" | "starts_at" | "party_size" | "status"
> & { floor_plan_id?: string | null };

/**
 * Ventana `[apertura, cierre]` de un servicio en una fecha concreta, TZ-aware.
 * Si `closes_at <= opens_at` (ej. cena 20:00 → 00:30) se interpreta que el
 * servicio cruza la medianoche y el cierre cae al día siguiente.
 *
 * @param date "YYYY-MM-DD" en la TZ del negocio.
 */
export function flexibleServiceWindow(
  date: string,
  service: Pick<ReservationService, "opens_at" | "closes_at">,
  timezone: string,
): ServiceWindow | null {
  // Postgres `time` llega como "HH:MM:SS" — normalizamos a "HH:MM" antes de
  // validar (si no, la config real de la DB nunca matchea el regex).
  const opensAt = service.opens_at.slice(0, 5);
  const closesAt = service.closes_at.slice(0, 5);
  if (!HHMM_RE.test(opensAt) || !HHMM_RE.test(closesAt)) return null;
  const starts = fromZonedTime(`${date}T${opensAt}:00`, timezone);
  let ends = fromZonedTime(`${date}T${closesAt}:00`, timezone);
  if (Number.isNaN(starts.getTime()) || Number.isNaN(ends.getTime())) return null;
  if (ends.getTime() <= starts.getTime()) {
    // Cierre después de medianoche → siguiente día.
    ends = new Date(ends.getTime() + DAY_MS);
  }
  return { starts, ends };
}

function hhmmToMin(hhmm: string): number | null {
  if (!HHMM_RE.test(hhmm)) return null;
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

/**
 * Horarios de llegada elegibles de un servicio, en pasos de `stepMin` (default
 * 15 min), desde la apertura hasta el cierre (excluido). Maneja el cruce de
 * medianoche (cena 20:00→00:30 → …23:45, 00:00, 00:15). Devuelve strings
 * "HH:MM" locales — el equivalente flexible a los slots fijos del estricto,
 * pero derivados de la ventana del servicio.
 */
export function arrivalSlots(opensAt: string, closesAt: string, stepMin = 15): string[] {
  const open = hhmmToMin(opensAt.slice(0, 5));
  let close = hhmmToMin(closesAt.slice(0, 5));
  if (open == null || close == null || stepMin <= 0) return [];
  if (close <= open) close += 24 * 60; // cruza medianoche
  const out: string[] = [];
  for (let t = open; t < close; t += stepMin) {
    const mm = ((t % (24 * 60)) + 24 * 60) % (24 * 60);
    const h = Math.floor(mm / 60);
    const m = mm % 60;
    out.push(`${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`);
  }
  return out;
}

/**
 * Una reserva "pertenece" a un servicio si está viva y su `starts_at` cae dentro
 * de la ventana `[starts, ends)`. Ancla cada reserva a exactamente un servicio
 * por su hora de inicio (las genéricas sin hora se guardan con la hora de
 * apertura del servicio, así que también entran).
 */
function isLiveInWindow(r: ReservationForFlexible, window: ServiceWindow): boolean {
  if (!LIVE_RESERVATION_STATUSES.includes(r.status)) return false;
  const s = new Date(r.starts_at).getTime();
  if (Number.isNaN(s)) return false;
  return s >= window.starts.getTime() && s < window.ends.getTime();
}

/**
 * ¿La mesa está libre para reservar en este servicio? Regla de oro del modo
 * flexible: **una reserva viva por (mesa, servicio)**. Devuelve `false` apenas
 * hay una reserva viva de ese servicio sobre esa mesa (a cualquier hora) — es
 * lo que impide prometer la misma mesa dos veces y mata el desalojo.
 */
export function isTableFreeForService(
  reservations: ReservationForFlexible[],
  tableId: string,
  window: ServiceWindow,
): boolean {
  return !reservations.some(
    (r) => r.table_id === tableId && isLiveInWindow(r, window),
  );
}

/**
 * Cubiertos reservados (suma de `party_size`) de las reservas vivas de este
 * servicio. Si se pasa `floorPlanId`, cuenta sólo esa zona (para la capacidad
 * blanda por zona). El caller resuelve la zona de las reservas con mesa
 * (deriva de la mesa) antes de llamar; las genéricas ya traen `floor_plan_id`.
 */
export function reservedCovers(
  reservations: ReservationForFlexible[],
  window: ServiceWindow,
  floorPlanId?: string | null,
): number {
  return reservations
    .filter((r) => isLiveInWindow(r, window))
    .filter((r) => (floorPlanId == null ? true : r.floor_plan_id === floorPlanId))
    .reduce((sum, r) => sum + (r.party_size ?? 0), 0);
}

export type FlexibleAvailabilityParams = {
  /** "YYYY-MM-DD" en la TZ del negocio. */
  date: string;
  service: Pick<ReservationService, "opens_at" | "closes_at" | "soft_capacity">;
  partySize: number;
  /** Mesas del negocio (se filtra `active` acá). */
  tables: FloorTable[];
  /** Reservas vivas que puedan caer en el servicio (ventana + vecinos). */
  reservations: ReservationForFlexible[];
  timezone: string;
  /** Mesa puntual pedida (reserva con mesa). Si se omite → reserva genérica. */
  tableId?: string | null;
  /** Zona a la que se acota (cubiertos + mesas libres). */
  floorPlanId?: string | null;
};

export type FlexibleUnavailableReason =
  | "mesa-ocupada"
  | "mesa-chica"
  | "mesa-inexistente"
  | "fecha-invalida";

export type FlexibleAvailability = {
  window: ServiceWindow;
  /** Mesas activas de la zona, con asientos suficientes y libres este servicio. */
  freeTables: FloorTable[];
  reservedCovers: number;
  softCapacity: number | null;
  /** `true` si sumar este party supera el umbral blando (sólo avisa). */
  overCapacity: boolean;
  /**
   * `true` si la reserva se puede tomar. En flexible siempre es `true` para las
   * **genéricas** (la capacidad es blanda); sólo es `false` si se pidió una
   * **mesa puntual** que está ocupada, es chica o no existe.
   */
  available: boolean;
  reason?: FlexibleUnavailableReason;
  warning?: "sobre-capacidad";
};

/**
 * Disponibilidad del modo flexible para una fecha + servicio.
 * - **Genérica** (sin `tableId`): `available` siempre `true` (capacidad blanda);
 *   devuelve las mesas libres y el `warning: "sobre-capacidad"` si corresponde.
 * - **Mesa puntual** (`tableId`): `available` sólo si la mesa existe, está
 *   activa, tiene asientos y está libre este servicio.
 *
 * Devuelve `null` si la ventana del servicio es inválida.
 */
export function computeFlexibleAvailability(
  params: FlexibleAvailabilityParams,
): FlexibleAvailability | null {
  const { date, service, partySize, tables, reservations, timezone, tableId, floorPlanId } = params;

  const window = flexibleServiceWindow(date, service, timezone);
  if (!window) return null;

  const inZone = (t: FloorTable) => (floorPlanId == null ? true : t.floor_plan_id === floorPlanId);

  const freeTables = tables
    .filter((t) => t.status === "active")
    .filter(inZone)
    .filter((t) => t.seats >= partySize)
    .filter((t) => isTableFreeForService(reservations, t.id, window));

  const covers = reservedCovers(reservations, window, floorPlanId);
  const softCapacity = service.soft_capacity ?? null;
  const overCapacity = softCapacity != null && covers + partySize > softCapacity;

  let available = true;
  let reason: FlexibleUnavailableReason | undefined;

  if (tableId != null) {
    const t = tables.find((x) => x.id === tableId);
    if (!t || t.status !== "active") {
      available = false;
      reason = "mesa-inexistente";
    } else if (t.seats < partySize) {
      available = false;
      reason = "mesa-chica";
    } else if (!isTableFreeForService(reservations, tableId, window)) {
      available = false;
      reason = "mesa-ocupada";
    }
  }

  return {
    window,
    freeTables,
    reservedCovers: covers,
    softCapacity,
    overCapacity,
    available,
    reason,
    warning: overCapacity ? "sobre-capacidad" : undefined,
  };
}
