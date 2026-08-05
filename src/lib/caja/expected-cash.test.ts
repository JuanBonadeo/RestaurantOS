import { describe, expect, it } from "vitest";

import { calculateExpectedCash } from "./expected-cash";

describe("calculateExpectedCash", () => {
  it("sin movimientos ni payments: devuelve last_closing_cash", () => {
    expect(
      calculateExpectedCash({
        last_closing_cash_cents: 100_000,
        payments: [],
        movimientos: [],
      }),
    ).toBe(100_000);
  });

  it("primer período sin corte previo: last_closing = 0", () => {
    expect(
      calculateExpectedCash({
        last_closing_cash_cents: 0,
        payments: [{ method: "cash", amount_cents: 50_000 }],
        movimientos: [],
      }),
    ).toBe(50_000);
  });

  it("suma cash payments e ignora otros métodos", () => {
    expect(
      calculateExpectedCash({
        last_closing_cash_cents: 50_000,
        payments: [
          { method: "cash", amount_cents: 10_000 },
          { method: "cash", amount_cents: 25_000 },
          { method: "card_manual", amount_cents: 70_000 },
          { method: "mp_link", amount_cents: 30_000 },
          { method: "other", amount_cents: 5_000 },
        ],
        movimientos: [],
      }),
    ).toBe(50_000 + 10_000 + 25_000);
  });

  it("suma ingresos y resta sangrías", () => {
    expect(
      calculateExpectedCash({
        last_closing_cash_cents: 100_000,
        payments: [],
        movimientos: [
          { kind: "ingreso", amount_cents: 20_000 },
          { kind: "sangria", amount_cents: 30_000 },
          { kind: "sangria", amount_cents: 5_000 },
        ],
      }),
    ).toBe(100_000 + 20_000 - 30_000 - 5_000);
  });

  it("escenario completo: cash + ingreso + sangría + métodos varios", () => {
    expect(
      calculateExpectedCash({
        last_closing_cash_cents: 200_000,
        payments: [
          { method: "cash", amount_cents: 150_000 },
          { method: "cash", amount_cents: 80_000 },
          { method: "card_manual", amount_cents: 100_000 },
        ],
        movimientos: [
          { kind: "ingreso", amount_cents: 50_000 },
          { kind: "sangria", amount_cents: 70_000 },
        ],
      }),
    ).toBe(200_000 + 150_000 + 80_000 + 50_000 - 70_000);
  });
  it("un movimiento anulado no mueve el efectivo esperado (spec 070)", () => {
    expect(
      calculateExpectedCash({
        last_closing_cash_cents: 100_000,
        payments: [],
        movimientos: [
          { kind: "sangria", amount_cents: 50_000, cancelled_at: "2026-07-30T21:00:00Z" },
          { kind: "ingreso", amount_cents: 20_000, cancelled_at: null },
        ],
      }),
    ).toBe(100_000 + 20_000);
  });

  // ── spec 098 · la propina no es plata del negocio ──────────────────
  //
  // Decisión de producto (Juan, 2026-08-05): la propina se cobra por el sistema
  // para poder liquidársela al mozo, pero **no es una venta ni queda en la
  // caja**. Antes se sumaba `amount_cents` entero y el arqueo esperaba también
  // la propina, así que cerraba con sobrante todos los días.

  it("no espera la propina en el cajón", () => {
    // El cliente paga $11.000 por una cuenta de $10.000. En el cajón del
    // negocio tienen que quedar $10.000: los otros $1.000 son del mozo.
    expect(
      calculateExpectedCash({
        last_closing_cash_cents: 0,
        payments: [{ method: "cash", amount_cents: 11_000, tip_cents: 1_000 }],
        movimientos: [],
      }),
    ).toBe(10_000);
  });

  it("un pago sin propina no cambia", () => {
    expect(
      calculateExpectedCash({
        last_closing_cash_cents: 0,
        payments: [{ method: "cash", amount_cents: 10_000, tip_cents: 0 }],
        movimientos: [],
      }),
    ).toBe(10_000);
  });

  it("la propina de un pago que NO es efectivo no toca el cajón", () => {
    // Sólo el efectivo mueve la caja física; una propina cobrada con tarjeta no
    // resta de un cajón donde nunca entró.
    expect(
      calculateExpectedCash({
        last_closing_cash_cents: 0,
        payments: [
          { method: "card_manual", amount_cents: 11_000, tip_cents: 1_000 },
        ],
        movimientos: [],
      }),
    ).toBe(0);
  });

  it("`tip_cents` ausente se trata como 0 (compat con filas viejas)", () => {
    expect(
      calculateExpectedCash({
        last_closing_cash_cents: 0,
        payments: [{ method: "cash", amount_cents: 10_000 }],
        movimientos: [],
      }),
    ).toBe(10_000);
  });
});
