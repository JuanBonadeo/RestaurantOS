import { describe, expect, it } from "vitest";

import {
  agruparPorTanda,
  contarItemsVivos,
  estaAnulado,
  sePuedeRepreciar,
  type LoPedidoItem,
} from "./lo-pedido";

const item = (over: Partial<LoPedidoItem> = {}): LoPedidoItem => ({
  order_item_id: over.order_item_id ?? `i-${over.product_name ?? "x"}`,
  product_id: "p1",
  product_name: "Milanesa",
  quantity: 1,
  notes: null,
  modifiers: [],
  unit_price_cents: 1000,
  subtotal_cents: 1000,
  price_original_cents: null,
  price_override_reason: null,
  daily_menu_id: null,
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
        comanda_id: "c2",
        batch: 2,
        emitted_at: "2026-08-11T22:00:00Z",
      }),
      // Las dos del primer envío viajan en el mismo papel: misma comanda.
      item({ product_name: "Milanesa", batch: 1 }),
      item({ product_name: "Papas", batch: 1 }),
    ]);
    expect(tandas.map((t) => t.numero)).toEqual([1, 2]);
    expect(tandas[0].items.map((i) => i.product_name)).toEqual([
      "Milanesa",
      "Papas",
    ]);
  });

  it("dos envíos a sectores distintos son dos tandas, cada una con su hora", () => {
    // El bug #188: `batch` es autoincremental dentro de (orden, sector), así
    // que la primera comanda de parrilla también es la 1 aunque salga en la
    // segunda vuelta. Agrupando por ese número, la vuelta de las 22 aparecía
    // adentro de la Tanda 1 y con la hora de las 21.
    const tandas = agruparPorTanda([
      item({
        product_name: "Milanesa",
        station_id: "fritera",
        comanda_id: "c1",
        batch: 1,
        emitted_at: "2026-08-11T21:00:00Z",
      }),
      item({
        product_name: "Asado",
        station_id: "parrilla",
        comanda_id: "c2",
        batch: 1,
        emitted_at: "2026-08-11T21:40:00Z",
      }),
    ]);
    expect(tandas.map((t) => t.numero)).toEqual([1, 2]);
    expect(tandas.map((t) => t.emitted_at)).toEqual([
      "2026-08-11T21:00:00Z",
      "2026-08-11T21:40:00Z",
    ]);
  });

  it("dos vueltas al mismo sector son dos tandas aunque salgan seguidas", () => {
    // Repetir sector es la señal dura: un envío crea a lo sumo una comanda por
    // sector, así que ver fritera dos veces es sí o sí otra vuelta.
    const tandas = agruparPorTanda([
      item({
        product_name: "Milanesa",
        station_id: "fritera",
        comanda_id: "c1",
        emitted_at: "2026-08-11T21:00:00Z",
      }),
      item({
        product_name: "Papas",
        station_id: "fritera",
        comanda_id: "c2",
        batch: 2,
        emitted_at: "2026-08-11T21:00:02Z",
      }),
    ]);
    expect(tandas.map((t) => t.numero)).toEqual([1, 2]);
  });

  it("la tanda toma la hora del envío más viejo (una por sector)", () => {
    const tandas = agruparPorTanda([
      item({
        product_name: "Parrilla",
        station_id: "parrilla",
        comanda_id: "c2",
        emitted_at: "2026-08-11T21:00:05Z",
      }),
      item({
        product_name: "Cocina",
        station_id: "cocina",
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
    expect(tandas.map((t) => t.numero)).toEqual([1, null]);
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
    expect(tandas[0].numero).toBeNull();
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

// Issue #283 — qué línea ya enviada acepta que le cambien el precio. Es el
// espejo de lo que rechaza `editarItemComanda`: sin esto la mesa ofrece un
// botón que el server contesta con un error.
describe("sePuedeRepreciar", () => {
  it("una línea común de catálogo, sí", () => {
    expect(sePuedeRepreciar(item())).toBe(true);
  });

  it("la anulada no: ya no se cobra", () => {
    expect(
      sePuedeRepreciar(
        item({ cancelled_at: "2026-09-09T21:00:00Z", cancelled_reason: "x" }),
      ),
    ).toBe(false);
  });

  it("la del menú del día tampoco: su precio vive en el combo", () => {
    expect(sePuedeRepreciar(item({ daily_menu_id: "dm1" }))).toBe(false);
  });

  it("ni el renglón libre, que no tiene precio de carta contra el cual medir", () => {
    expect(sePuedeRepreciar(item({ product_id: null }))).toBe(false);
  });
});
