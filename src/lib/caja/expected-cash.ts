import type { CajaMovimientoKind, PaymentMethod } from "./types";

export type ExpectedCashInput = {
  last_closing_cash_cents: number;
  payments: Array<{ method: PaymentMethod; amount_cents: number }>;
  movimientos: Array<{
    kind: CajaMovimientoKind;
    amount_cents: number;
    /** Anulado (spec 070): sigue en el libro, pero no mueve la caja. */
    cancelled_at?: string | null;
  }>;
};

export function calculateExpectedCash(input: ExpectedCashInput): number {
  const cashPayments = input.payments
    .filter((p) => p.method === "cash")
    .reduce((acc, p) => acc + p.amount_cents, 0);

  const movimientos = input.movimientos.filter((m) => !m.cancelled_at);

  const ingresos = movimientos
    .filter((m) => m.kind === "ingreso")
    .reduce((acc, m) => acc + m.amount_cents, 0);

  const sangrias = movimientos
    .filter((m) => m.kind === "sangria")
    .reduce((acc, m) => acc + m.amount_cents, 0);

  return input.last_closing_cash_cents + cashPayments + ingresos - sangrias;
}
