import { describe, expect, it } from "vitest";

import { effectiveMargin } from "./effective-margin";

// Spec 069 (T019) — la ingeniería de menú mezclaba ingreso REAL (de
// `order_items`) con margen de CATÁLOGO (de `products.price_cents`). Con el
// precio por ítem eso pasó de "aproximación" a "mentira": un plato regalado
// mostraba $0 facturado y 70% de margen en la misma tarjeta.

describe("effectiveMargin", () => {
  it("sin precios pisados da lo mismo que el margen de catálogo", () => {
    // 10 unidades de un plato de $100 con food cost $30.
    const m = effectiveMargin({
      revenueCents: 100_000,
      unitsSold: 10,
      foodCostCents: 3_000,
    });
    expect(m.marginPercent).toBe(70);
    expect(m.marginCents).toBe(7_000);
  });

  it("una cortesía baja el margen efectivo (antes quedaba inflado)", () => {
    // 10 vendidos a $100 + 2 regalados: ingreso 100.000, costo 12 × 3.000.
    const m = effectiveMargin({
      revenueCents: 100_000,
      unitsSold: 12,
      foodCostCents: 3_000,
    });
    // (100000 - 36000) / 100000 = 64%, no 70%.
    expect(m.marginPercent).toBe(64);
    expect(m.marginCents).toBeCloseTo(64_000 / 12, 5);
  });

  it("un plato enteramente regalado da −100%, no 70%", () => {
    const m = effectiveMargin({
      revenueCents: 0,
      unitsSold: 3,
      foodCostCents: 3_000,
    });
    expect(m.marginPercent).toBe(-100);
    expect(m.marginCents).toBe(-3_000);
  });

  it("regalado y sin costo cargado da 0, no −100", () => {
    const m = effectiveMargin({
      revenueCents: 0,
      unitsSold: 3,
      foodCostCents: 0,
    });
    expect(m.marginPercent).toBe(0);
    expect(m.marginCents).toBe(0);
  });

  it("vendido por encima de la carta sube el margen", () => {
    // 1 unidad cobrada $180 (carta $100), food cost $30.
    const m = effectiveMargin({
      revenueCents: 18_000,
      unitsSold: 1,
      foodCostCents: 3_000,
    });
    expect(m.marginPercent).toBeCloseTo(83.33, 1);
    expect(m.marginCents).toBe(15_000);
  });

  it("un margen negativo (se cobra menos que el costo) se reporta negativo", () => {
    const m = effectiveMargin({
      revenueCents: 2_000,
      unitsSold: 1,
      foodCostCents: 3_000,
    });
    expect(m.marginPercent).toBe(-50);
    expect(m.marginCents).toBe(-1_000);
  });

  it("sin unidades vendidas no divide por cero", () => {
    const m = effectiveMargin({
      revenueCents: 0,
      unitsSold: 0,
      foodCostCents: 3_000,
    });
    expect(m.marginPercent).toBe(0);
    expect(m.marginCents).toBe(0);
  });
});
