import { describe, expect, it } from "vitest";

import { buildPriceOverrideRows, summarizeOverrides } from "./price-overrides";

// Spec 069 (US3) — reporte de precios modificados. La query de Supabase es un
// select plano; lo que tiene lógica es el armado de las filas (defensa contra
// relaciones anidadas de PostgREST, cast de bigint, cálculo del delta) y los
// dos totales separados. Eso es puro y se testea sin DB.

const row = (over: Record<string, unknown> = {}) => ({
  id: "i1",
  product_name: "Milanesa",
  quantity: 1,
  unit_price_cents: 600,
  price_original_cents: 1000,
  price_override_at: "2026-07-30T18:00:00.000Z",
  price_override_by: "u1",
  price_override_reason: "cortesía",
  orders: { order_number: 12, table_id: "t1", tables: { label: "5" } },
  ...over,
});

const actors = new Map([["u1", "Ana"]]);

describe("price-overrides / buildPriceOverrideRows", () => {
  it("calcula el delta contra el precio de LISTA", () => {
    const [r] = buildPriceOverrideRows([row()], actors);
    expect(r.priceOriginalCents).toBe(1000);
    expect(r.unitPriceCents).toBe(600);
    expect(r.deltaCents).toBe(-400);
    expect(r.actorName).toBe("Ana");
    expect(r.reason).toBe("cortesía");
  });

  it("un precio por encima de la carta da delta positivo", () => {
    const [r] = buildPriceOverrideRows(
      [row({ unit_price_cents: 1800, price_original_cents: 1000 })],
      actors,
    );
    expect(r.deltaCents).toBe(800);
  });

  it("castea bigint que PostgREST puede devolver como string", () => {
    // `unit_price_cents` y `price_original_cents` son bigint: sin Number() el
    // delta concatena en vez de restar.
    const [r] = buildPriceOverrideRows(
      [row({ unit_price_cents: "600", price_original_cents: "1000" })],
      actors,
    );
    expect(r.deltaCents).toBe(-400);
    expect(Number.isNaN(r.deltaCents)).toBe(false);
  });

  it("sobrevive a la relación anidada como array (PostgREST)", () => {
    const [r] = buildPriceOverrideRows(
      [
        row({
          orders: [{ order_number: 12, table_id: "t1", tables: [{ label: "5" }] }],
        }),
      ],
      actors,
    );
    expect(r.tableLabel).toBe("5");
    expect(r.orderNumber).toBe(12);
  });

  it("sin mesa (pedido de mostrador/delivery) no rompe", () => {
    const [r] = buildPriceOverrideRows(
      [row({ orders: { order_number: 40, table_id: null, tables: null } })],
      actors,
    );
    expect(r.tableLabel).toBeNull();
    expect(r.orderNumber).toBe(40);
  });

  it("actor desconocido cae a null, no rompe", () => {
    const [r] = buildPriceOverrideRows([row({ price_override_by: "zzz" })], new Map());
    expect(r.actorName).toBeNull();
  });

  it("descarta filas sin price_original_cents — no son un precio pisado", () => {
    expect(buildPriceOverrideRows([row({ price_original_cents: null })], actors))
      .toHaveLength(0);
  });

  it("ordena por |delta| descendente", () => {
    const rows = buildPriceOverrideRows(
      [
        row({ id: "a", unit_price_cents: 900, price_original_cents: 1000 }), // -100
        row({ id: "b", unit_price_cents: 0, price_original_cents: 1000 }), // -1000
        row({ id: "c", unit_price_cents: 1500, price_original_cents: 1000 }), // +500
      ],
      actors,
    );
    expect(rows.map((r) => r.id)).toEqual(["b", "c", "a"]);
  });
});

describe("price-overrides / summarizeOverrides", () => {
  it("separa resignado de recargado — NO netean", () => {
    const rows = buildPriceOverrideRows(
      [
        row({ id: "a", unit_price_cents: 0, price_original_cents: 1000 }), // -1000
        row({ id: "b", unit_price_cents: 1500, price_original_cents: 1000 }), // +500
      ],
      actors,
    );
    const s = summarizeOverrides(rows);
    // Netear escondería que se regalaron $10 y se recargaron $5: el dueño
    // vería "-$5" y creería que fue un solo ajuste chico.
    expect(s.resignedCents).toBe(1000);
    expect(s.surchargedCents).toBe(500);
  });

  it("multiplica el delta por la cantidad de la línea", () => {
    const rows = buildPriceOverrideRows(
      [row({ quantity: 3, unit_price_cents: 0, price_original_cents: 1000 })],
      actors,
    );
    expect(summarizeOverrides(rows).resignedCents).toBe(3000);
  });

  it("sin filas, todo en cero", () => {
    expect(summarizeOverrides([])).toEqual({
      resignedCents: 0,
      surchargedCents: 0,
    });
  });
});
