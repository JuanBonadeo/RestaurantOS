import { fromZonedTime } from "date-fns-tz";

import { arrivalSlots } from "@/lib/reservations/flexible-availability";
import type {
  ReservationMode,
  ReservationService,
  WeeklySchedule,
} from "@/lib/reservations/types";

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
 * - solo uno de los **chips que ofrece reservas** ese día.
 *
 * De dónde salen esos chips depende del modo de reservas del negocio (spec
 * 059), igual que en el flujo de reservar:
 * - **flexible** → los horarios de llegada de los servicios del día, cada 15
 *   min (`arrivalSlots` sobre `reservation_services`). Es el caso de
 *   golf-house.
 * - **estricto** → la grilla fija de `reservation_settings.schedule`.
 *
 * Eso reemplaza al viejo chequeo contra `business_hours`: es config explícita
 * del negocio y es lo que el cliente ya ve al reservar. Corolario: un negocio
 * sin nada configurado para hoy **no puede programar** (el checkout deshabilita
 * "Programar" en vez de dejar pedir y fallar en el server).
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
 * Default de `businesses.scheduled_march_lead_kitchen_min` (spec 127).
 *
 * Es el lead que aplica cuando el pedido trae **hora de cocina**: ahí el viaje
 * ya está expresado en la diferencia entre las dos horas que escribió el
 * encargado, así que el lead vuelve a ser tiempo de preparación puro y —a
 * diferencia de los dos de arriba— no depende del tipo de entrega.
 */
export const DEFAULT_MARCH_LEAD_KITCHEN_MIN = 40;
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
 * **Jornada operativa** a la que pertenece un instante: el día de trabajo del
 * local, con corte a las 6 AM en vez de medianoche, para que la cena que cruza
 * las doce no se parta en dos.
 *
 * Espejo exacto de `public.operating_day(timestamptz)` (migración 0049), que es
 * quien materializa `orders.business_day` y sobre quien se reinicia
 * `daily_number`. Existe en TS porque el encargue **para otro día** (spec 127)
 * tiene que nacer con la jornada en que se va a trabajar, no con la del día en
 * que se cargó: si no, el pedido tomado hoy para mañana se llevaría un número
 * de hoy y mañana habría dos «#7» en el pase.
 */
export function operatingDay(at: Date, timezone: string): string {
  return localYmd(new Date(at.getTime() - 6 * 60 * MIN_MS), timezone);
}

/** Paso de la grilla de llegada en modo flexible (igual que reservas). */
export const ORDER_SLOT_STEP_MIN = 15;

/**
 * Config de reservas que define la grilla de horarios del negocio. Es lo que
 * necesita `orderSlotsForDay` para ofrecer los MISMOS chips que reservar.
 */
export type OrderSlotSource = {
  mode?: ReservationMode | null;
  /** Modo estricto. */
  schedule?: WeeklySchedule | null;
  /** Modo flexible: servicios del negocio (`day_of_week: null` = todos). */
  services?: Pick<
    ReservationService,
    "day_of_week" | "opens_at" | "closes_at"
  >[] | null;
};

/**
 * Horarios (HH:MM) que el negocio ofrece el día calendario de `at`, ordenados y
 * sin repetidos. Nada configurado ese día → `[]`.
 *
 * En flexible se unen los servicios del día (pueden venir duplicados por salón:
 * a un retiro/delivery no le importa la zona, así que se deduplican).
 */
export function orderSlotsForDay(
  source: OrderSlotSource,
  at: Date,
  timezone: string,
): string[] {
  const { dow } = localDowAndTime(at, timezone);

  if (source.mode === "flexible") {
    const out = new Set<string>();
    for (const s of source.services ?? []) {
      if (s.day_of_week !== null && s.day_of_week !== dow) continue;
      for (const slot of arrivalSlots(
        s.opens_at,
        s.closes_at,
        ORDER_SLOT_STEP_MIN,
      )) {
        out.add(slot);
      }
    }
    return [...out].sort();
  }

  const day = source.schedule?.[String(dow) as keyof WeeklySchedule];
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
  /** Hora DEL PEDIDO: cuándo el cliente lo retira o lo recibe. */
  scheduledAt: Date;
  deliveryType: "delivery" | "pickup" | "dine_in";
  /** Chips que el negocio ofrece hoy (`orderSlotsForDay`). */
  daySlots: string[];
  timezone: string;
  now?: Date;
  /**
   * Quién carga el pedido (spec 127). El default es `public` a propósito: si
   * alguien suma un call-site nuevo y se olvida del campo, hereda las reglas
   * estrictas, no las laxas.
   */
  source?: "public" | "staff";
  /**
   * Hora DE COCINA: para cuándo el plato tiene que estar listo. Sólo la escribe
   * el staff; el checkout público expresa una sola hora.
   */
  kitchenAt?: Date | null;
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

  // Spec 127 — la hora de cocina, cuando viene, no puede caer DESPUÉS de la del
  // pedido: el plato no puede estar listo después de que el cliente se lo lleve.
  // Vale para los dos orígenes (el público no la manda nunca).
  if (
    input.kitchenAt &&
    input.kitchenAt.getTime() > input.scheduledAt.getTime()
  ) {
    return {
      ok: false,
      error: "La hora de cocina no puede ser posterior a la del pedido.",
    };
  }

  // Spec 127 — el encargue que carga el staff no pasa por la grilla. Las tres
  // reglas de abajo son del checkout público: son exactamente las que hoy le
  // impiden al encargado cargar «para las 21:20» a las 20:50. Lo único que se
  // le exige es que la hora no haya pasado ya.
  if (input.source === "staff") {
    if (input.scheduledAt.getTime() <= now.getTime()) {
      return { ok: false, error: "Esa hora ya pasó." };
    }
    return { ok: true };
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

  // Spec 064 — la hora tiene que ser uno de los chips del día (los mismos que
  // ofrece reservar), no cualquier minuto dentro del horario de atención.
  const { time } = localDowAndTime(input.scheduledAt, input.timezone);
  if (!input.daySlots.includes(time)) {
    return {
      ok: false,
      error: "Elegí uno de los horarios disponibles del local.",
    };
  }

  return { ok: true };
}

/**
 * **El momento cero del pedido** (spec 127): cuándo se pone en marcha — pasa a
 * `preparing` y, si la comanda todavía no salió, se imprime.
 *
 * Dos caminos, y el `??` es lo que deja el canal web donde estaba:
 *
 * - **Con hora de cocina** (el encargue que carga el staff): `kitchen_at` menos
 *   el lead de cocina, que no mira el tipo de entrega. El encargado ya dijo para
 *   cuándo tiene que estar listo; el lead sólo dice cuánto tarda cocina.
 * - **Sin ella** (el checkout público, que expresa una sola hora): `scheduled_at`
 *   menos el lead por tipo de la spec 061, tal cual venía.
 *
 * `null` = el pedido no difiere nada y marcha cuando lo mandan.
 */
export function marchAtForOrder(
  order: {
    kitchen_at?: string | Date | null;
    scheduled_at?: string | Date | null;
    delivery_type: string;
  },
  business: {
    scheduled_march_lead_pickup_min?: number | null;
    scheduled_march_lead_delivery_min?: number | null;
    scheduled_march_lead_kitchen_min?: number | null;
  } | null,
): Date | null {
  const asDate = (v: string | Date | null | undefined): Date | null => {
    if (!v) return null;
    const d = v instanceof Date ? v : new Date(v);
    return Number.isNaN(d.getTime()) ? null : d;
  };

  const kitchenAt = asDate(order.kitchen_at);
  if (kitchenAt) {
    const lead =
      business?.scheduled_march_lead_kitchen_min ??
      DEFAULT_MARCH_LEAD_KITCHEN_MIN;
    return new Date(kitchenAt.getTime() - lead * MIN_MS);
  }

  const scheduledAt = asDate(order.scheduled_at);
  if (!scheduledAt) return null;
  const lead = marchLeadForOrder(order.delivery_type, business);
  return new Date(scheduledAt.getTime() - lead * MIN_MS);
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
