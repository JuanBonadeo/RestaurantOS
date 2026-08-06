/**
 * Stats de la cabecera de «Reservas del día» (#156).
 *
 * Vivían inline en `admin-day-list.tsx`, donde no se podían testear — y ahí se
 * coló el bug: `total` contaba **todas** las filas y `guests` sólo las vivas,
 * así que los dos KPI más grandes de la pantalla hablaban de conjuntos
 * distintos (12 reservas / 51 comensales, con 4 canceladas y 1 no-show
 * adentro del 12).
 *
 * Ahora los dos usan el mismo predicado: `cuentaEnElDia`.
 */

import type { ReservationStatus } from "@/lib/reservations/types";

/** Lo mínimo que necesita el cálculo. */
export type DayStatsRow = {
  status: ReservationStatus;
  party_size: number;
  starts_at: string;
};

export type ReservationDayStats = {
  /** Reservas que cuentan como reserva del día (ni canceladas ni no-show). */
  total: number;
  /** Cubiertos de esas mismas reservas. Mismo conjunto que `total`. */
  guests: number;
  confirmed: number;
  seated: number;
  completed: number;
  noShow: number;
  cancelled: number;
};

/**
 * ¿Esta reserva cuenta para los totales del día?
 *
 * `cancelled` y `no_show` **no**: la mesa nunca se ocupó ni se va a ocupar, y
 * sumarlas infla el día con gente que no existe. `completed` **sí**: ya comió y
 * se fue, pero pasó — si no contara, a las 23:00 con todo cerrado el panel
 * diría 0 comensales, que es la lectura opuesta a la verdadera.
 *
 * Las canceladas y los no-show siguen visibles en los chips secundarios y en la
 * lista: se sacan de las **sumas**, no de la vista.
 */
export function cuentaEnElDia(status: ReservationStatus): boolean {
  return status !== "cancelled" && status !== "no_show";
}

/** Contadores de la cabecera, todos sobre el mismo conjunto. */
export function reservationDayStats(rows: readonly DayStatsRow[]): ReservationDayStats {
  const cuentan = rows.filter((r) => cuentaEnElDia(r.status));
  const porEstado = (s: ReservationStatus) =>
    rows.filter((r) => r.status === s).length;

  return {
    total: cuentan.length,
    guests: cuentan.reduce((sum, r) => sum + (r.party_size ?? 0), 0),
    confirmed: porEstado("confirmed"),
    seated: porEstado("seated"),
    completed: porEstado("completed"),
    noShow: porEstado("no_show"),
    cancelled: porEstado("cancelled"),
  };
}

/**
 * La próxima reserva por sentar: la `confirmed` más temprana que todavía no
 * empezó. `now` entra por parámetro para que la función sea pura y testeable.
 */
export function proximaReserva<T extends DayStatsRow>(
  rows: readonly T[],
  now: number,
): T | undefined {
  return rows
    .filter((r) => r.status === "confirmed" && new Date(r.starts_at).getTime() > now)
    .sort((a, b) => +new Date(a.starts_at) - +new Date(b.starts_at))[0];
}
