import type { CajaMovimientoKind, PaymentMethod } from "./types";

export type ExpectedCashInput = {
  last_closing_cash_cents: number;
  payments: Array<{
    method: PaymentMethod;
    amount_cents: number;
    /** Cuánto de `amount_cents` es propina (spec 098). */
    tip_cents?: number;
  }>;
  movimientos: Array<{
    kind: CajaMovimientoKind;
    amount_cents: number;
    /** Anulado (spec 070): sigue en el libro, pero no mueve la caja. */
    cancelled_at?: string | null;
  }>;
};

/**
 * Efectivo que **el negocio** tiene que tener en el cajón.
 *
 * spec 098 — la propina no es plata del negocio: se cobra por el sistema para
 * poder liquidársela al mozo, pero no es una venta ni queda en la caja. El
 * cliente paga $11.000 por una cuenta de $10.000 y esos $1.000 son del mozo, no
 * del local.
 *
 * Antes se sumaba `amount_cents` entero, así que el arqueo esperaba también la
 * propina y **cerraba con sobrante todos los días** — un sobrante que el
 * encargado no podía explicar porque la plata sí estaba… en el bolsillo de
 * quien correspondía.
 */
export function calculateExpectedCash(input: ExpectedCashInput): number {
  const cashPayments = input.payments
    .filter((p) => p.method === "cash")
    .reduce((acc, p) => acc + p.amount_cents - (p.tip_cents ?? 0), 0);

  const movimientos = input.movimientos.filter((m) => !m.cancelled_at);

  const ingresos = movimientos
    .filter((m) => m.kind === "ingreso")
    .reduce((acc, m) => acc + m.amount_cents, 0);

  const sangrias = movimientos
    .filter((m) => m.kind === "sangria")
    .reduce((acc, m) => acc + m.amount_cents, 0);

  return input.last_closing_cash_cents + cashPayments + ingresos - sangrias;
}

export type MovimientoConCorte = {
  kind: CajaMovimientoKind;
  amount_cents: number;
  cancelled_at?: string | null;
  /** Spec 130 · Escrito por el cierre: es el retiro del cajón, no del turno. */
  corte_id?: string | null;
};

/**
 * Separa el retiro del cierre de los movimientos del turno que empieza.
 *
 * El retiro vive en el período nuevo por un milisegundo de diferencia con el
 * corte (0052), y eso está bien para la plata: apertura = lo contado, sangría
 * por lo mismo, caja en $0. Está mal para lo que se lee: el encargado ve
 * «$262.000 del corte anterior» arriba y la sangría que lo vacía abajo, y
 * entiende que el sistema le pide un saldo anterior que ya no está en el cajón.
 *
 * Netear el retiro contra la apertura mueve el mismo sumando del otro lado de
 * la cuenta: `apertura + Σmov` no cambia — hay un test que lo fija— pero el
 * turno arranca en $0 y la lista de movimientos empieza vacía, que es lo que
 * pasó de verdad.
 *
 * Los anulados (spec 070) no mueven la caja: siguen en el libro y acá suman 0.
 */
export function separarRetiroDelCierre<T extends MovimientoConCorte>(
  arrastreBrutoCents: number,
  movimientos: T[],
): { apertura_cents: number; retiro_cierre_cents: number; del_turno: T[] } {
  const delCierre = movimientos.filter((m) => m.corte_id != null);
  const del_turno = movimientos.filter((m) => m.corte_id == null);

  // Firmado como lo firma el arqueo: el ingreso suma al cajón, la sangría resta.
  const neto = delCierre
    .filter((m) => !m.cancelled_at)
    .reduce(
      (acc, m) => acc + (m.kind === "ingreso" ? m.amount_cents : -m.amount_cents),
      0,
    );

  return {
    apertura_cents: arrastreBrutoCents + neto,
    // `0 - neto` y no `-neto`: sin retiro el neto es 0 y `-0` no es `0`.
    retiro_cierre_cents: 0 - neto,
    del_turno,
  };
}
