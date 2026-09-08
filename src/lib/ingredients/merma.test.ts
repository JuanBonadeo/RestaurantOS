import { describe, expect, it } from "vitest";

import { computeMermaReport, type MermaConsumptionRow } from "./merma";

function row(partial: Partial<MermaConsumptionRow>): MermaConsumptionRow {
  return {
    ingredientId: "ing-1",
    ingredientName: "Entrecote",
    ingredientUnit: "kg",
    wastePercent: 12,
    kind: "compra",
    quantity: 0,
    orderItemId: null,
    ...partial,
  };
}

describe("computeMermaReport", () => {
  it("cruza entró vs salió y estima merma según waste_percent", () => {
    // Escenario de la spec: entrecote waste 12%, compró 50kg, salió 44kg
    const rows: MermaConsumptionRow[] = [
      row({ kind: "compra", quantity: 30 }),
      row({ kind: "compra", quantity: 20 }),
      row({ kind: "venta", quantity: 40 }),
      row({ kind: "merma", quantity: 4 }),
    ];

    const [item] = computeMermaReport(rows);

    expect(item.enteredQty).toBe(50);
    expect(item.ventaQty).toBe(40);
    expect(item.mermaRegistradaQty).toBe(4);
    expect(item.exitedQty).toBe(44);
    // 50 × 12 / 100 = 6
    expect(item.mermaEstimadaQty).toBe(6);
    // 50 − 44 = 6
    expect(item.diffQty).toBe(6);
    expect(item.ingredientUnit).toBe("kg");
    expect(item.wastePercent).toBe(12);
  });

  // Issue #270 · hallazgo 6 — las reversiones NO se ignoran.
  //
  // Este test decía «ignora reversiones y ajustes» y consagraba el bug: se
  // anulaba un comprobante cargado por error y «Entró» seguía diciendo los 20 kg
  // que nunca entraron, así que «Diferencia» inventaba 20 kg de faltante. Y en
  // espejo, se cancelaba un plato y la `venta` se seguía contando como salida
  // aunque el insumo hubiera vuelto a la heladera. La columna no se podía
  // conciliar contra un conteo físico en NINGUNA de las dos direcciones — que es
  // literalmente el daño que la cabecera de la 0039 dice querer evitar («el
  // reporte de merma se lo muestra al encargado como robo»).
  //
  // Los ajustes sí se siguen ignorando: son correcciones de conteo, no
  // movimientos de mercadería. La baja a mano ya no cae ahí — desde el issue
  // #270 escribe `kind='merma'`, que es salida.
  it("ignora los ajustes de conteo, que no son entrada ni salida", () => {
    const rows: MermaConsumptionRow[] = [
      row({ kind: "compra", quantity: 10 }),
      row({ kind: "ajuste", quantity: 2 }),
      row({ kind: "venta", quantity: 5 }),
    ];

    const [item] = computeMermaReport(rows);

    expect(item.enteredQty).toBe(10);
    expect(item.exitedQty).toBe(5);
    expect(item.diffQty).toBe(5);
  });

  // Las dos reversiones comparten `kind` pero no son la misma cosa, y se
  // distinguen por `order_item_id`: la de compra lo tiene en null y viene con la
  // cantidad en NEGATIVO; la de venta lo tiene seteado y viene en positivo. Un
  // `entered -= qty` a secas sobre las dos introduciría el bug espejado.
  it("la reversión de un comprobante descuenta de lo que entró", () => {
    const rows: MermaConsumptionRow[] = [
      row({ kind: "compra", quantity: 20 }),
      row({ kind: "reversion", quantity: -20, orderItemId: null }),
      row({ kind: "venta", quantity: 5 }),
    ];

    const [item] = computeMermaReport(rows);

    expect(item.enteredQty).toBe(0);
    expect(item.exitedQty).toBe(5);
    // El faltante fantasma de 20 kg que el reporte le mostraba al encargado
    // como robo.
    expect(item.diffQty).toBe(-5);
  });

  it("la reversión de una línea cancelada descuenta de lo que se vendió", () => {
    const rows: MermaConsumptionRow[] = [
      row({ kind: "compra", quantity: 10 }),
      row({ kind: "venta", quantity: 4 }),
      row({ kind: "reversion", quantity: 4, orderItemId: "oi-1" }),
    ];

    const [item] = computeMermaReport(rows);

    expect(item.enteredQty).toBe(10);
    expect(item.ventaQty).toBe(0);
    expect(item.exitedQty).toBe(0);
    expect(item.diffQty).toBe(10);
  });

  // La nota de crédito devuelve mercadería y se anota igual que la reversión de
  // compra (0085): sin `order_item_id` y en negativo.
  it("la nota de crédito baja lo que entró", () => {
    const rows: MermaConsumptionRow[] = [
      row({ kind: "compra", quantity: 40 }),
      row({ kind: "reversion", quantity: -40, orderItemId: null }),
    ];

    expect(computeMermaReport(rows)[0].enteredQty).toBe(0);
  });

  it("normaliza cantidades negativas con valor absoluto", () => {
    const rows: MermaConsumptionRow[] = [
      row({ kind: "venta", quantity: -8 }),
      row({ kind: "compra", quantity: 8 }),
    ];

    const [item] = computeMermaReport(rows);

    expect(item.ventaQty).toBe(8);
    expect(item.enteredQty).toBe(8);
  });

  it("agrupa por insumo y ordena por cantidad que entró (desc)", () => {
    const rows: MermaConsumptionRow[] = [
      row({ ingredientId: "a", ingredientName: "Harina", quantity: 5, kind: "compra" }),
      row({ ingredientId: "b", ingredientName: "Azúcar", quantity: 12, kind: "compra" }),
    ];

    const report = computeMermaReport(rows);

    expect(report).toHaveLength(2);
    expect(report[0].ingredientId).toBe("b");
    expect(report[1].ingredientId).toBe("a");
  });

  it("insumo sin compras: entró 0, merma estimada 0", () => {
    const rows: MermaConsumptionRow[] = [row({ kind: "venta", quantity: 7 })];

    const [item] = computeMermaReport(rows);

    expect(item.enteredQty).toBe(0);
    expect(item.mermaEstimadaQty).toBe(0);
    expect(item.exitedQty).toBe(7);
    expect(item.diffQty).toBe(-7);
  });
});
