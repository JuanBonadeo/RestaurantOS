/**
 * El CMV y las DOS reversiones — issue #268 · #270.
 *
 * `ingredient_consumptions` usa `kind = 'reversion'` para dos cosas que no son
 * la misma:
 *
 *  · **Una venta que se deshizo** (línea anulada). El insumo volvió a la
 *    heladera sin consumirse → sale del CMV.
 *  · **Mercadería devuelta al PROVEEDOR** (comprobante anulado o nota de
 *    crédito). Eso mueve inventario y deuda, no consumo → NO toca el CMV.
 *
 * El discriminante es `order_item_id`, igual que en `computeMermaReport`.
 *
 * Por qué existe este test: la reversión de compras de la 0073 escribía
 * `cost_cents_snapshot = 0` justamente para no ensuciar esta cuenta. La 0085
 * empezó a escribir el costo real —con razón, es la columna de plata del
 * movimiento— y con eso el lector empezó a restar del CMV una devolución al
 * proveedor. El margen salía mejor que el real, que es la dirección que halaga
 * y por eso nadie la cuestiona.
 */
import { describe, expect, it } from "vitest";

/** La misma cuenta que hace `getProfitMetrics` sobre las filas de consumo. */
function cmv(
  filas: Array<{ kind: string; cost_cents_snapshot: number; order_item_id: string | null }>,
): number {
  let foodCost = 0;
  for (const row of filas) {
    const cost = Math.abs(Number(row.cost_cents_snapshot) || 0);
    if (row.kind === "venta") foodCost += cost;
    else if (row.kind === "reversion" && row.order_item_id) foodCost -= cost;
  }
  return Math.max(0, foodCost);
}

describe("CMV · las dos reversiones", () => {
  it("la venta deshecha sale del CMV: el insumo volvió a la heladera", () => {
    const filas = [
      { kind: "venta", cost_cents_snapshot: 280_000, order_item_id: "li-1" },
      { kind: "reversion", cost_cents_snapshot: 280_000, order_item_id: "li-1" },
    ];
    expect(cmv(filas)).toBe(0);
  });

  it("la devolución al proveedor NO toca el CMV: esa mercadería no se cocinó", () => {
    // Se vendió un bife ($2.800 de costo) y aparte se devolvieron dos cajones
    // de tomate al proveedor. El CMV sigue siendo el del bife.
    const filas = [
      { kind: "venta", cost_cents_snapshot: 280_000, order_item_id: "li-1" },
      { kind: "reversion", cost_cents_snapshot: 120_000, order_item_id: null },
    ];
    expect(cmv(filas)).toBe(280_000);
  });

  it("las dos juntas se resuelven cada una por su lado", () => {
    const filas = [
      { kind: "venta", cost_cents_snapshot: 280_000, order_item_id: "li-1" },
      { kind: "venta", cost_cents_snapshot: 150_000, order_item_id: "li-2" },
      { kind: "reversion", cost_cents_snapshot: 150_000, order_item_id: "li-2" },
      { kind: "reversion", cost_cents_snapshot: 120_000, order_item_id: null },
    ];
    expect(cmv(filas)).toBe(280_000);
  });
});
