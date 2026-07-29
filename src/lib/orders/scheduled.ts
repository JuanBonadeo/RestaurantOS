import { fromZonedTime } from "date-fns-tz";

import type { WeeklySchedule } from "@/lib/reservations/types";

/**
 * Pedidos diferidos (spec 31 + 061 + 064) — reglas puras, sin DB ni I/O.
 *
 * El server (persist-order) es la fuente de verdad; el checkout reusa el mismo
 * helper para feedback inmediato.
 *
 * El **lead de marcha** dejó de ser fijo (spec 061, cierra el D7 del design de
 * spec 31): vive por negocio en `businesses.scheduled_march_lead_{pickup,
 * delivery}_min`. Lo de acá son los defaults de la columna.
 *
 * **Spec 064 — programar dejó de ser libre.** Antes el cliente elegía cualquier
 * día dentro de una ventana de 7 días y cualquier hora dentro del horario de
 * atención. Ahora:
 * - solo **hoy** (mismo día calendario en el TZ del local), y
 * - solo una de las **horas de la grilla de reservas** del negocio
 *   (`reservation_settings.schedule`) — los mismos chips que ve el que reserva.
 *
 * La grilla es más estricta que `business_hours` y es config explícita del
 * negocio, así que reemplaza al chequeo de horario de atención. Corolario: un
 * negocio sin grilla cargada para hoy **no puede programar** (el checkout
 * deshabilita "Programar" en vez de dejar pedir y fallar en el server).
 */

/** Anticipación mínima entre "ahora" y el retiro/entrega programado. */
export const SCHEDULED_MIN_LEAD_MIN = 60;
/** Default de `businesses.scheduled_march_lead_pickup_min`. */
export const DEFAULT_MARCH_LEAD_PICKUP_MIN = 40;
/**
 * Default de `businesses.scheduled_march_lead_delivery_min`. Mayor que el de
 * retiro: además de cocinar, el pedido tiene que viajar.
 */
export const DEFAULT_MARCH_LEAD_DELIVERY_MIN = 60;
/**
 * Techo del lead configurable (= el check de la migración 0027). Además acota
 * la ventana del filtro SQL del cron: nada que caiga más allá de `now + esto`
 * puede estar en ventana para ningún negocio.
 */
export const MAX_MARCH_LEAD_MIN = 240;

const MIN_MS = 60_000;

const WEEKDAY_TO_DOW: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

/**
 * `HH:MM` y día de la semana (0=domingo) de un instante, **en el TZ del
 * negocio**. Vía `Intl.DateTimeFormat` (no `date-fns-tz`) para que sea robusto
 * sin importar el TZ del runtime — los tests corren en hora local AR y el truco
 * `getUTCHours` de `currentDayOfWeek` solo da bien en runtimes UTC.
 */
function localDowAndTime(at: Date, timezone: string): {
  dow: number;
  time: string;
} {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(at);
  const pick = (type: string) =>
    parts.find((p) => p.type === type)?.value ?? "";
  // `hour12:false` puede emitir "24" a medianoche en algunos entornos.
  const hh = pick("hour") === "24" ? "00" : pick("hour");
  return {
    dow: WEEKDAY_TO_DOW[pick("weekday")] ?? 0,
    time: `${hh}:${pick("minute")}`,
  };
}

/** YYYY-MM-DD del instante en el TZ del negocio. */
export function localYmd(at: Date, timezone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(at);
}

/**
 * Horarios (HH:MM) que la grilla de reservas tiene abiertos el día calendario
 * de `at`, ordenados y sin repetidos. Día cerrado o sin grilla → `[]`.
 */
export function scheduleSlotsForDay(
  schedule: WeeklySchedule | null | undefined,
  at: Date,
  timezone: string,
): string[] {
  if (!schedule) return [];
  const { dow } = localDowAndTime(at, timezone);
  const day = schedule[String(dow) as keyof WeeklySchedule];
  if (!day || !day.open) return [];
  return [...new Set(day.slots)].sort();
}

/**
 * Los slots que todavía cumplen la anticipación mínima. Es lo que se le ofrece
 * al cliente como chips; el server revalida con `validateScheduledOrder`.
 */
export function filterSlotsByLead(
  slots: string[],
  timezone: string,
  now: Date = new Date(),
  leadMin: number = SCHEDULED_MIN_LEAD_MIN,
): string[] {
  const ymd = localYmd(now, timezone);
  const cutoff = now.getTime() + leadMin * MIN_MS;
  return slots.filter((slot) => {
    const at = fromZonedTime(`${ymd}T${slot}:00`, timezone);
    return !Number.isNaN(at.getTime()) && at.getTime() >= cutoff;
  });
}

export type ScheduledOrderValidation = {
  scheduledAt: Date;
  deliveryType: "delivery" | "pickup" | "dine_in";
  /** Grilla de reservas del negocio (`reservation_settings.schedule`). */
  schedule: WeeklySchedule | null | undefined;
  timezone: string;
  now?: Date;
};

export type ScheduledValidationResult =
  | { ok: true }
  | { ok: false; error: string };

/**
 * Valida un pedido programado. Orden de chequeos pensado para que cada error
 * aísle su causa: tipo → día → anticipación → horario de la grilla.
 *
 * Spec 061: retiro y delivery se programan, **con cualquier método de pago**.
 * El prepago obligatorio de spec 31 se cayó — el resguardo contra el pedido
 * fantasma no es cobrar por adelantado sino que nada entra a cocina sin aval:
 * un programado impago espera a que el encargado lo acepte antes de que el
 * cron lo marche (`aceptarPedidoProgramado`, política de spec 047).
 *
 * La venta de mostrador (`dine_in`) nunca se programa — antes caía en el
 * rechazo genérico de "solo retiro"; ahora necesita su propio chequeo.
 */
export function validateScheduledOrder(
  input: ScheduledOrderValidation,
): ScheduledValidationResult {
  const now = input.now ?? new Date();

  if (input.deliveryType === "dine_in") {
    return { ok: false, error: "Los pedidos en mesa no se programan." };
  }

  // Spec 064 — solo el mismo día. Se chequea antes que la anticipación para
  // que "mañana a las 13" no se explique como un problema de anticipación.
  if (
    localYmd(input.scheduledAt, input.timezone) !==
    localYmd(now, input.timezone)
  ) {
    return {
      ok: false,
      error: "Los pedidos programados son solo para hoy.",
    };
  }

  const leadMs = input.scheduledAt.getTime() - now.getTime();
  if (leadMs < SCHEDULED_MIN_LEAD_MIN * MIN_MS) {
    return {
      ok: false,
      error: `Programá con al menos ${SCHEDULED_MIN_LEAD_MIN} minutos de anticipación.`,
    };
  }

  // Spec 064 — la hora tiene que ser una de la grilla de reservas, no cualquier
  // minuto dentro del horario de atención.
  const slots = scheduleSlotsForDay(
    input.schedule,
    input.scheduledAt,
    input.timezone,
  );
  const { time } = localDowAndTime(input.scheduledAt, input.timezone);
  if (!slots.includes(time)) {
    return {
      ok: false,
      error: "Elegí uno de los horarios disponibles del local.",
    };
  }

  return { ok: true };
}

/**
 * ¿El pedido es para más tarde (diferido a futuro)? Es la condición de "no
 * marchar al crear ni al aprobar el pago": null o instante pasado → marcha
 * como un pedido normal; instante futuro → queda agendado.
 */
export function isScheduledForLater(
  scheduledAt: Date | string | null | undefined,
  now: Date = new Date(),
): boolean {
  if (!scheduledAt) return false;
  const at =
    typeof scheduledAt === "string" ? new Date(scheduledAt) : scheduledAt;
  if (Number.isNaN(at.getTime())) return false;
  return at.getTime() > now.getTime();
}

/**
 * ¿Toca marchar el agendado? True si `scheduled_at - leadMin <= now`. El
 * `leadMin` sale del negocio (spec 061); el default cubre el caso retiro.
 */
export function shouldMarchNow(
  scheduledAt: Date,
  now: Date,
  leadMin: number = DEFAULT_MARCH_LEAD_PICKUP_MIN,
): boolean {
  return scheduledAt.getTime() - leadMin * MIN_MS <= now.getTime();
}

/**
 * Lead que aplica a un pedido según su tipo, con fallback a los defaults por si
 * la fila del negocio viene incompleta (join nulo, fixture viejo).
 */
export function marchLeadForOrder(
  deliveryType: string,
  business: {
    scheduled_march_lead_pickup_min?: number | null;
    scheduled_march_lead_delivery_min?: number | null;
  } | null,
): number {
  if (deliveryType === "delivery") {
    return (
      business?.scheduled_march_lead_delivery_min ??
      DEFAULT_MARCH_LEAD_DELIVERY_MIN
    );
  }
  return (
    business?.scheduled_march_lead_pickup_min ?? DEFAULT_MARCH_LEAD_PICKUP_MIN
  );
}
