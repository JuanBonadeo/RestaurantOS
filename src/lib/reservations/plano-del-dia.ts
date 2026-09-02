import { formatInTimeZone, fromZonedTime } from "date-fns-tz";

import { arrivalSlots } from "@/lib/reservations/flexible-availability";
import type {
  FloorTable,
  Reservation,
  ReservationMode,
  ReservationService,
  WeeklySchedule,
} from "@/lib/reservations/types";

/**
 * El plano del día a una hora elegida (spec 137) — reglas puras, sin DOM.
 *
 * El plano que ya existe (`salon-desktop`) es la foto del **ahora**: las
 * reservas entran recién cuando faltan 3 h (`VENTANA_RESERVA_EN_PLANO_MS`),
 * porque a quien atiende el mediodía una reserva de las 21 no le dice nada.
 *
 * Acá la pregunta es la opuesta y es la que hay que contestar para decidir una
 * solicitud: **cómo queda el salón el sábado a las 21**.
 */

export type EstadoDeMesa = "libre" | "reservada" | "pendiente";

export type MesaEnElPlano = {
  mesa: FloorTable;
  estado: EstadoDeMesa;
  /** La reserva que la ocupa a esa hora, si hay alguna. */
  reserva: ReservaEnPlano | null;
};

export type ReservaEnPlano = Pick<
  Reservation,
  "id" | "table_id" | "starts_at" | "ends_at" | "status" | "party_size" | "customer_name"
> & { service?: string | null; floor_plan_id?: string | null };

/**
 * Qué pasa en cada mesa en el instante `momento`.
 *
 * El rango es `[starts_at, ends_at)` — el mismo que usa el `EXCLUDE USING gist`
 * de la tabla. Que el dibujo y la base midan igual es lo que evita que el plano
 * diga «libre» sobre algo que la DB va a rechazar.
 *
 * `pendiente` gana sobre `reservada` cuando dos se pisan: lo que el encargado
 * necesita ver es qué mesa se comería una solicitud sin responder.
 */
export function estadoDeMesasEn(
  momento: Date,
  reservas: ReservaEnPlano[],
  mesas: FloorTable[],
): MesaEnElPlano[] {
  const t = momento.getTime();
  const activas = reservas.filter(
    (r) => r.status === "pending" || r.status === "confirmed" || r.status === "seated",
  );

  return mesas.map((mesa) => {
    const encima = activas.filter((r) => {
      if (r.table_id !== mesa.id) return false;
      const desde = new Date(r.starts_at).getTime();
      const hasta = new Date(r.ends_at).getTime();
      return desde <= t && t < hasta;
    });
    if (encima.length === 0) return { mesa, estado: "libre", reserva: null };
    const pendiente = encima.find((r) => r.status === "pending");
    return pendiente
      ? { mesa, estado: "pendiente", reserva: pendiente }
      : { mesa, estado: "reservada", reserva: encima[0] };
  });
}

/**
 * Las horas que ofrece el control. Son las del negocio, no una grilla
 * inventada: los slots configurados en estricto, la ventana de los servicios
 * en flexible. Si no hay nada configurado, las horas de las propias reservas —
 * un día sin config igual se puede mirar.
 */
export function horasDelDia(input: {
  date: string;
  timezone: string;
  mode: ReservationMode;
  schedule: WeeklySchedule;
  services: ReservationService[];
  reservas: ReservaEnPlano[];
}): string[] {
  const { date, timezone, mode, schedule, services, reservas } = input;
  const horas = new Set<string>();

  if (mode === "flexible") {
    const dow = new Date(`${date}T12:00:00Z`).getUTCDay();
    for (const svc of services) {
      if (svc.day_of_week !== null && svc.day_of_week !== dow) continue;
      for (const h of arrivalSlots(svc.opens_at, svc.closes_at, 30)) horas.add(h);
    }
  } else {
    const dow = String(new Date(`${date}T12:00:00Z`).getUTCDay()) as keyof WeeklySchedule;
    const dia = schedule[dow];
    if (dia?.open) for (const slot of dia.slots) horas.add(slot);
  }

  // Sin config para ese día, las horas de lo que hay reservado.
  if (horas.size === 0) {
    for (const r of reservas) {
      horas.add(formatInTimeZone(new Date(r.starts_at), timezone, "HH:mm"));
    }
  }

  return [...horas].sort();
}

/** El instante que representa `HH:MM` de `date` en la TZ del negocio. */
export function momentoDe(date: string, hora: string, timezone: string): Date {
  return fromZonedTime(`${date}T${hora}:00`, timezone);
}

/**
 * Las reservas sin mesa de ese momento. En flexible son mayoría (la mesa se
 * define al llegar, spec 059): no se pueden dibujar, pero esconderlas haría
 * leer un salón más vacío de lo que está.
 */
export function sinMesa(
  momento: Date,
  reservas: ReservaEnPlano[],
): { cantidad: number; cubiertos: number } {
  const t = momento.getTime();
  const vivas = reservas.filter(
    (r) =>
      r.table_id === null &&
      (r.status === "pending" || r.status === "confirmed" || r.status === "seated") &&
      new Date(r.starts_at).getTime() <= t &&
      t < new Date(r.ends_at).getTime(),
  );
  return {
    cantidad: vivas.length,
    cubiertos: vivas.reduce((sum, r) => sum + (r.party_size ?? 0), 0),
  };
}

/** La primera hora con algo reservado: donde conviene abrir el plano. */
export function horaInicial(
  horas: string[],
  reservas: ReservaEnPlano[],
  date: string,
  timezone: string,
): string {
  if (horas.length === 0) return "";
  const conReserva = horas.find((h) => {
    const t = momentoDe(date, h, timezone).getTime();
    return reservas.some(
      (r) =>
        (r.status === "pending" || r.status === "confirmed" || r.status === "seated") &&
        new Date(r.starts_at).getTime() <= t &&
        t < new Date(r.ends_at).getTime(),
    );
  });
  return conReserva ?? horas[0];
}

/**
 * El `viewBox` que encuadra un conjunto de mesas, con aire alrededor
 * (spec 144). Lo comparten el plano del día y el picker del formulario de
 * reserva: dos planos del mismo salón que encuadraran distinto se leerían como
 * dos salones.
 */
export function encuadreDeMesas(
  mesas: Pick<FloorTable, "x" | "y" | "width" | "height">[],
  pad = 40,
): string {
  if (mesas.length === 0) return "0 0 100 100";
  const minX = Math.min(...mesas.map((t) => t.x)) - pad;
  const minY = Math.min(...mesas.map((t) => t.y)) - pad;
  const maxX = Math.max(...mesas.map((t) => t.x + t.width)) + pad;
  const maxY = Math.max(...mesas.map((t) => t.y + t.height)) + pad;
  return `${minX} ${minY} ${maxX - minX} ${maxY - minY}`;
}
