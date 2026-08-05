import type { CajaMovimientoKind, PaymentMethod } from "./types";

export type ExpectedCashInput = {
  last_closing_cash_cents: number;
  payments: Array<{
    method: PaymentMethod;
    amount_cents: number;
    /** Cuánto de `amount_cents` es propina (spec 097). */
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
 * spec 097 — la propina no es plata del negocio: se cobra por el sistema para
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
