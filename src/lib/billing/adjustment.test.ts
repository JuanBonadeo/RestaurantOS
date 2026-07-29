import { describe, expect, it } from "vitest";

import { calculateAdjustment } from "./adjustment";

describe("calculateAdjustment", () => {
  it("sin ajuste devuelve la base intacta", () => {
    expect(calculateAdjustment(10_000, 0)).toEqual({
      adjustmentCents: 0,
      finalCents: 10_000,
    });
  });

  it("recargo suma sobre la base", () => {
    expect(calculateAdjustment(10_000, 10)).toEqual({
      adjustmentCents: 1_000,
      finalCents: 11_000,
    });
  });

  it("descuento (porcentaje negativo) resta", () => {
    expect(calculateAdjustment(10_000, -10)).toEqual({
      adjustmentCents: -1_000,
      finalCents: 9_000,
    });
  });

  it("redondea el ajuste al centavo", () => {
    // 3333 * 15% = 499.95 → 500
    expect(calculateAdjustment(3_333, 15).adjustmentCents).toBe(500);
    // 3333 * 5% = 166.65 → 167
    expect(calculateAdjustment(3_333, 5).adjustmentCents).toBe(167);
  });

  it("acepta porcentajes fraccionarios (numeric(5,2) en la config)", () => {
    expect(calculateAdjustment(10_000, 2.5)).toEqual({
      adjustmentCents: 250,
      finalCents: 10_250,
    });
  });

  it("base 0 no genera ajuste", () => {
    expect(calculateAdjustment(0, 21)).toEqual({
      adjustmentCents: 0,
      finalCents: 0,
    });
  });

  it("el final siempre es base + ajuste", () => {
    for (const [base, pct] of [
      [10_000, 10],
      [7_777, -3],
      [1, 50],
      [999_999, 21],
    ] as Array<[number, number]>) {
      const r = calculateAdjustment(base, pct);
      expect(r.finalCents).toBe(base + r.adjustmentCents);
    }
  });
});
