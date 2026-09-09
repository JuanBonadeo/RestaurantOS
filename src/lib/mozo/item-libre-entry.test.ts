import { describe, it, expect } from "vitest";

import type { CatalogProduct } from "./catalog-query";
import {
  ITEM_LIBRE_ID,
  isItemLibreCartLine,
  isItemLibreEntry,
  itemLibreCartLine,
  itemLibrePayload,
  nombreSugerido,
  withItemLibreEntry,
} from "./item-libre-entry";

const producto = (name: string): CatalogProduct => ({
  id: `p-${name}`,
  category_id: null,
  name,
  description: null,
  price_cents: 100000,
  image_url: null,
  sort_order: 0,
  show_online: true,
  modifier_groups: [],
});

const carta = [producto("Milanesa napolitana"), producto("Coca-Cola")];

describe("spec 174 · la entrada «no existe» en el buscador", () => {
  it("sin búsqueda no ensucia el catálogo", () => {
    expect(withItemLibreEntry(carta, "", true)).toEqual(carta);
    expect(withItemLibreEntry(carta, "   ", true)).toEqual(carta);
  });

  it("cuando lo tipeado no encuentra nada, aparece — que es justo el momento", () => {
    const results = withItemLibreEntry([], "torta del cliente", true);
    expect(results).toHaveLength(1);
    expect(isItemLibreEntry(results[0])).toBe(true);
  });

  it("con resultados va al final, no le roba el Enter al producto real", () => {
    // Enter en el buscador agrega el primero: si la fila «no existe» quedara
    // arriba, tipear «mila» + Enter cargaría un renglón libre en vez de la
    // milanesa.
    const results = withItemLibreEntry(carta, "no existe", true);
    expect(isItemLibreEntry(results[0])).toBe(false);
    expect(isItemLibreEntry(results[results.length - 1])).toBe(true);
  });

  it("aparece buscando «no existe» y sus sinónimos, aunque haya resultados", () => {
    for (const q of ["no existe", "noexiste", "libre", "suelto", "otro"]) {
      const results = withItemLibreEntry(carta, q, true);
      expect(results.some(isItemLibreEntry)).toBe(true);
    }
  });

  it("no aparece si el rol no puede cargarlo", () => {
    expect(withItemLibreEntry([], "torta", false)).toEqual([]);
    expect(withItemLibreEntry(carta, "no existe", false)).toEqual(carta);
  });

  it("el nombre sugerido es lo que se tipeó, recortado", () => {
    expect(nombreSugerido("  torta del cliente ")).toBe("torta del cliente");
    // Salvo que lo tipeado sea el disparador: ahí no hay nombre que proponer.
    expect(nombreSugerido("no existe")).toBe("");
    expect(nombreSugerido("NO EXISTE")).toBe("");
    expect(nombreSugerido("")).toBe("");
  });

  it("la entrada sintética no colisiona con ningún id de producto", () => {
    // Los ids de `products` son uuid; éste no lo es a propósito.
    expect(ITEM_LIBRE_ID).not.toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
    expect(carta.some((p) => p.id === ITEM_LIBRE_ID)).toBe(false);
  });
});

/* ── La línea del carrito ─────────────────────────────────────────────────── */

describe("spec 174 · la línea libre en el carrito", () => {
  const draft = { name: "Torta del cliente", unit_price_cents: 350000, quantity: 2 };

  it("tiene la misma forma que cualquier línea, marcada por el id centinela", () => {
    const line = itemLibreCartLine(draft);
    // Misma forma = el carrito le cambia la cantidad, la borra y le suma el
    // subtotal con el código que ya tiene. Sin ramas nuevas.
    expect(line.product_id).toBe(ITEM_LIBRE_ID);
    expect(line.product_name).toBe("Torta del cliente");
    expect(line.unit_price_cents).toBe(350000);
    expect(line.quantity).toBe(2);
    expect(line.modifiers).toEqual([]);
    expect(line.line_subtotal_cents).toBe(700000);
  });

  it("se reconoce en el carrito", () => {
    expect(isItemLibreCartLine(itemLibreCartLine(draft))).toBe(true);
    expect(isItemLibreCartLine({ product_id: "uuid-de-un-producto" })).toBe(false);
  });

  it("el payload que viaja al server es el del schema `free`", () => {
    expect(itemLibrePayload({ ...itemLibreCartLine(draft), quantity: 3 })).toEqual({
      kind: "free",
      name: "Torta del cliente",
      unit_price_cents: 350000,
      quantity: 3,
    });
  });

  it("las notas viajan sólo si hay algo escrito", () => {
    const conNota = { ...itemLibreCartLine(draft), notes: "para 8" };
    expect(itemLibrePayload(conNota)).toMatchObject({ notes: "para 8" });
    expect(itemLibrePayload({ ...conNota, notes: "  " })).not.toHaveProperty("notes");
  });
});
