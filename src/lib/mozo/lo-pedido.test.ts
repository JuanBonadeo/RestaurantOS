import { describe, expect, it } from "vitest";

import {
  agruparPorTanda,
  contarItemsVivos,
  estaAnulado,
  type LoPedidoItem,
} from "./lo-pedido";

const item = (over: Partial<LoPedidoItem> = {}): LoPedidoItem => ({
  order_item_id: over.order_item_id ?? `i-${over.product_name ?? "x"}`,
  product_name: "Milanesa",
  quantity: 1,
  notes: null,
  modifiers: [],
  unit_price_cents: 1000,
  subtotal_cents: 1000,
  seat_number: null,
  station_id: "cocina",
  kitchen_status: "pending",
  cancelled_at: null,
  cancelled_reason: null,
  comanda_id: "c1",
  batch: 1,
  emitted_at: "2026-08-11T21:00:00Z",
  ...over,
});

describe("agruparPorTanda", () => {
  it("agrupa por tanda y las ordena como se pidieron", () => {
    const tandas = agruparPorTanda([
      item({
        product_name: "Postre",
        batch: 2,
        emitted_at: "2026-08-11T22:00:00Z",
      }),
      item({ product_name: "Milanesa", batch: 1 }),
      item({ product_name: "Papas", batch: 1 }),
    ]);
    expect(tandas.map((t) => t.batch)).toEqual([1, 2]);
    expect(tandas[0].items.map((i) => i.product_name)).toEqual([
      "Milanesa",
      "Papas",
    ]);
  });

  it("la tanda toma la hora del envío más viejo (una por sector)", () => {
    const tandas = agruparPorTanda([
      item({
        product_name: "Parrilla",
        comanda_id: "c2",
        emitted_at: "2026-08-11T21:00:05Z",
      }),
      item({
        product_name: "Cocina",
        comanda_id: "c1",
        emitted_at: "2026-08-11T21:00:01Z",
      }),
    ]);
    expect(tandas).toHaveLength(1);
    expect(tandas[0].emitted_at).toBe("2026-08-11T21:00:01Z");
  });

  it("lo que no fue a cocina va en un grupo al final, sin tanda", () => {
    // El caso de golf-house: no hay sector "barra", así que la gaseosa se
    // guarda con station_id null y NO genera comanda.
    const tandas = agruparPorTanda([
      item({
        product_name: "Coca",
        station_id: null,
        comanda_id: null,
        batch: null,
        emitted_at: null,
      }),
      item({ product_name: "Milanesa", batch: 1 }),
    ]);
    expect(tandas.map((t) => t.batch)).toEqual([1, null]);
    expect(tandas[1].items.map((i) => i.product_name)).toEqual(["Coca"]);
    expect(tandas[1].emitted_at).toBeNull();
  });

  it("sin ítems, sin tandas", () => {
    expect(agruparPorTanda([])).toEqual([]);
  });

  it("una mesa que sólo tomó algo: un único grupo sin tanda", () => {
    const tandas = agruparPorTanda([
      item({
        product_name: "Cerveza",
        station_id: null,
        comanda_id: null,
        batch: null,
        emitted_at: null,
      }),
    ]);
    expect(tandas).toHaveLength(1);
    expect(tandas[0].batch).toBeNull();
  });
});

describe("estaAnulado", () => {
  it("con cancelled_at está anulado", () => {
    expect(estaAnulado(item({ cancelled_at: "2026-08-11T21:30:00Z" }))).toBe(
      true,
    );
  });

  it("sin cancelled_at, no", () => {
    expect(estaAnulado(item())).toBe(false);
  });
});

describe("contarItemsVivos", () => {
  it("suma cantidades, no líneas", () => {
    expect(
      contarItemsVivos([item({ quantity: 2 }), item({ quantity: 3 })]),
    ).toBe(5);
  });

  it("los anulados no cuentan", () => {
    expect(
      contarItemsVivos([
        item({ quantity: 2 }),
        item({ quantity: 5, cancelled_at: "2026-08-11T21:30:00Z" }),
      ]),
    ).toBe(2);
  });

  it("mesa vacía: cero", () => {
    expect(contarItemsVivos([])).toBe(0);
  });
});
