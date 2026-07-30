import { describe, expect, it } from "vitest";

import {
  calculateTotals,
  expectedByAmounts,
  isCashShortPayment,
  expectedBySplitItems,
  prorrateEqualSplits,
  sumActiveItems,
} from "./totals";
import type { CuentaItem } from "./types";

const item = (id: string, sub: number, cancelled = false): CuentaItem => ({
  id,
  product_name: "x",
  quantity: 1,
  subtotal_cents: sub,
  notes: null,
  station_id: null,
  cancelled_at: cancelled ? new Date().toISOString() : null,
  loaded_by: null,
  seat_number: null,
  unit_price_cents: sub,
  price_original_cents: null,
  price_override_reason: null,
});

describe("calculateTotals", () => {
  it("subtotal − discount + tip", () => {
    expect(
      calculateTotals({ subtotal_cents: 10_000, tip_cents: 1_500, discount_cents: 0 }),
    ).toEqual({ subtotal_cents: 10_000, tip_cents: 1_500, discount_cents: 0, total_cents: 11_500 });
  });

  it("clampea total a 0 si descuento > subtotal+tip", () => {
    expect(
      calculateTotals({ subtotal_cents: 1_000, tip_cents: 0, discount_cents: 5_000 }).total_cents,
    ).toBe(0);
  });
});

describe("sumActiveItems", () => {
  it("ignora cancelados", () => {
    expect(
      sumActiveItems([item("a", 1_000), item("b", 2_000), item("c", 500, true)]),
    ).toBe(3_000);
  });
});

describe("prorrateEqualSplits", () => {
  it("3 splits sobre $100.00 → 33.34 / 33.33 / 33.33", () => {
    expect(prorrateEqualSplits(10_000, 3)).toEqual([3_334, 3_333, 3_333]);
  });

  it("división exacta sin residuo", () => {
    expect(prorrateEqualSplits(10_000, 5)).toEqual([2_000, 2_000, 2_000, 2_000, 2_000]);
  });

  it("count=1 devuelve el total entero", () => {
    expect(prorrateEqualSplits(10_000, 1)).toEqual([10_000]);
  });
});

describe("expectedBySplitItems", () => {
  it("dos splits sin propina ni descuento: subtotal directo", () => {
    const items = [item("a", 5_000), item("b", 3_000)];
    const mapping = new Map<number, string[]>([
      [1, ["a"]],
      [2, ["b"]],
    ]);
    const result = expectedBySplitItems({
      items,
      mapping,
      tip_cents: 0,
      discount_cents: 0,
    });
    expect(result).toEqual([
      { split_index: 1, expected_amount_cents: 5_000 },
      { split_index: 2, expected_amount_cents: 3_000 },
    ]);
  });

  it("propina y descuento prorrateados; suma cierra al total", () => {
    const items = [item("a", 6_000), item("b", 4_000)];
    const mapping = new Map<number, string[]>([
      [1, ["a"]],
      [2, ["b"]],
    ]);
    const result = expectedBySplitItems({
      items,
      mapping,
      tip_cents: 1_000, // 600 → split1, 400 → split2
      discount_cents: 500, // 300 → split1, 200 → split2
    });
    const total = result.reduce((acc, r) => acc + r.expected_amount_cents, 0);
    expect(total).toBe(6_000 + 4_000 + 1_000 - 500); // 10_500
    expect(result[0].expected_amount_cents).toBe(6_000 + 600 - 300);
    expect(result[1].expected_amount_cents).toBe(4_000 + 400 - 200);
  });

  it("redondeo de centavos: el último split absorbe el residuo", () => {
    const items = [item("a", 3_333), item("b", 3_333), item("c", 3_334)];
    const mapping = new Map<number, string[]>([
      [1, ["a"]],
      [2, ["b"]],
      [3, ["c"]],
    ]);
    // tip 100, sin descuento. 100 / 10_000 prorrateado por subtotales muy
    // parejos → suma debe cerrar exacto a 100.
    const result = expectedBySplitItems({
      items,
      mapping,
      tip_cents: 100,
      discount_cents: 0,
    });
    const totalSubtotal = items.reduce((a, it) => a + it.subtotal_cents, 0);
    const totalExpected = result.reduce((a, r) => a + r.expected_amount_cents, 0);
    expect(totalExpected).toBe(totalSubtotal + 100);
  });

  it("ignora items cancelados al sumar", () => {
    const items = [item("a", 5_000), item("b", 3_000, true)];
    const mapping = new Map<number, string[]>([
      [1, ["a", "b"]],
    ]);
    const result = expectedBySplitItems({
      items,
      mapping,
      tip_cents: 0,
      discount_cents: 0,
    });
    expect(result[0].expected_amount_cents).toBe(5_000);
  });
});

describe("expectedByAmounts (dividir por monto)", () => {
  it("el resto queda como última sub-cuenta", () => {
    const r = expectedByAmounts(30_000, [10_000]);
    expect(r).toEqual({ ok: true, expecteds: [10_000, 20_000] });
  });

  it("varios montos cargados + resto", () => {
    const r = expectedByAmounts(50_000, [10_000, 15_000]);
    expect(r).toEqual({ ok: true, expecteds: [10_000, 15_000, 25_000] });
  });

  it("si los montos suman exacto no agrega split de resto", () => {
    const r = expectedByAmounts(30_000, [10_000, 20_000]);
    expect(r).toEqual({ ok: true, expecteds: [10_000, 20_000] });
  });

  it("la suma de los expecteds siempre cierra contra el total", () => {
    for (const [total, amounts] of [
      [30_000, [10_000]],
      [10_001, [3_333, 3_333]],
      [99_999, [1]],
    ] as Array<[number, number[]]>) {
      const r = expectedByAmounts(total, amounts);
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.expecteds.reduce((a, b) => a + b, 0)).toBe(total);
    }
  });

  it("rechaza montos que se pasan del total", () => {
    const r = expectedByAmounts(30_000, [10_000, 25_000]);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain("suman más");
  });

  it("rechaza un único monto igual al total (no habría división)", () => {
    const r = expectedByAmounts(30_000, [30_000]);
    expect(r.ok).toBe(false);
  });

  it("rechaza montos cero o negativos", () => {
    expect(expectedByAmounts(30_000, [0]).ok).toBe(false);
    expect(expectedByAmounts(30_000, [-1_000]).ok).toBe(false);
  });

  it("rechaza centavos no enteros y cuenta vacía", () => {
    expect(expectedByAmounts(30_000, [10_000.5]).ok).toBe(false);
    expect(expectedByAmounts(30_000, []).ok).toBe(false);
    expect(expectedByAmounts(0, [1_000]).ok).toBe(false);
  });
});

describe("isCashShortPayment (efectivo: nunca de menos)", () => {
  const base = { method: "cash", adjustment_cents: 0, remaining_cents: 10_000 };

  it("rechaza pagar menos de lo que falta", () => {
    expect(isCashShortPayment({ ...base, amount_cents: 9_999 })).toBe(true);
  });

  it("acepta el monto exacto", () => {
    expect(isCashShortPayment({ ...base, amount_cents: 10_000 })).toBe(false);
  });

  it("acepta de más — es vuelto", () => {
    expect(isCashShortPayment({ ...base, amount_cents: 20_000 })).toBe(false);
  });

  it("con descuento por efectivo, pagar el neto es pagar completo", () => {
    // -10%: la cuenta es 10.000, el cliente entrega 9.000 y está saldada.
    expect(
      isCashShortPayment({
        ...base,
        amount_cents: 9_000,
        adjustment_cents: -1_000,
      }),
    ).toBe(false);
    // Un peso menos que el neto sí es de menos.
    expect(
      isCashShortPayment({
        ...base,
        amount_cents: 8_999,
        adjustment_cents: -1_000,
      }),
    ).toBe(true);
  });

  it("con recargo, la base sigue siendo lo que se debe", () => {
    expect(
      isCashShortPayment({
        ...base,
        amount_cents: 11_000,
        adjustment_cents: 1_000,
      }),
    ).toBe(false);
  });

  it("no aplica a los otros métodos (dos tarjetas, transferencia parcial)", () => {
    for (const method of ["card_manual", "transfer", "other", "mp_link"]) {
      expect(isCashShortPayment({ ...base, method, amount_cents: 1 })).toBe(false);
    }
  });
});
