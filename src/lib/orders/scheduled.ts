import type { BusinessHourSlot } from "@/lib/business-hours/schema";

/**
 * Pedidos diferidos (spec 31 + 061) — reglas puras, sin DB ni I/O.
 *
 * El server (persist-order) es la fuente de verdad; el checkout reusa el mismo
 * helper para feedback inmediato.
 *
 * El **lead de marcha** dejó de ser fijo (spec 061, cierra el D7 del design de
 * spec 31): vive por negocio en `businesses.scheduled_march_lead_{pickup,
 * delivery}_min`. Lo de acá son los defaults de la columna. La anticipación
 * mínima y la ventana máxima **sí** siguen fijas.
 */

/** Anticipación mínima entre "ahora" y el retiro/entrega programado. */
export const SCHEDULED_MIN_LEAD_MIN = 60;
/** Ventana máxima hacia adelante (no se programa más allá de esto). */
export const SCHEDULED_MAX_WINDOW_DAYS = 7;
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

/** "00:00" como cierre = medianoche → "24:00" para comparar como string. */
function effectiveClose(time: string): string {
  return time === "00:00" ? "24:00" : time;
}

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

/** ¿El instante cae dentro de alguna franja de `business_hours`? */
export function isWithinBusinessHours(
  at: Date,
  businessHours: BusinessHourSlot[],
  timezone: string,
): boolean {
  const { dow, time } = localDowAndTime(at, timezone);
  return businessHours.some(
    (s) =>
      s.day_of_week === dow &&
      s.opens_at <= time &&
      time < effectiveClose(s.closes_at),
  );
}

export type ScheduledOrderValidation = {
  scheduledAt: Date;
  deliveryType: "delivery" | "pickup" | "dine_in";
  paymentMethod: "cash" | "mp" | undefined;
  businessHours: BusinessHourSlot[];
  timezone: string;
  now?: Date;
};

export type ScheduledValidationResult =
  | { ok: true }
  | { ok: false; error: string };

/**
 * Valida un pedido programado. Orden de chequeos pensado para que cada error
 * aísle su causa: tipo → pago → anticipación → ventana → horario.
 *
 * Spec 061: el **delivery** también se programa, y puede pagarse en efectivo al
 * recibir. El **retiro** sigue exigiendo MP adelantado (nadie retiene nada si
 * el cliente no aparece). La venta de mostrador (`dine_in`) nunca se programa —
 * antes caía en el rechazo genérico de "solo retiro"; ahora que el delivery
 * está permitido necesita su propio chequeo o se colaría.
 */
export function validateScheduledOrder(
  input: ScheduledOrderValidation,
): ScheduledValidationResult {
  const now = input.now ?? new Date();

  if (input.deliveryType === "dine_in") {
    return { ok: false, error: "Los pedidos en mesa no se programan." };
  }
  if (input.deliveryType === "pickup" && input.paymentMethod !== "mp") {
    return {
      ok: false,
      error:
        "Un pedido de retiro programado se paga con Mercado Pago por adelantado.",
    };
  }

  const leadMs = input.scheduledAt.getTime() - now.getTime();
  if (leadMs < SCHEDULED_MIN_LEAD_MIN * MIN_MS) {
    return {
      ok: false,
      error: `Programá con al menos ${SCHEDULED_MIN_LEAD_MIN} minutos de anticipación.`,
    };
  }
  if (leadMs > SCHEDULED_MAX_WINDOW_DAYS * 24 * 60 * MIN_MS) {
    return {
      ok: false,
      error: `No se puede programar a más de ${SCHEDULED_MAX_WINDOW_DAYS} días.`,
    };
  }

  if (!isWithinBusinessHours(input.scheduledAt, input.businessHours, input.timezone)) {
    return {
      ok: false,
      error: "El horario elegido está fuera del horario de atención del local.",
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
