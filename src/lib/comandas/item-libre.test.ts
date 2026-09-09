import { describe, it, expect } from "vitest";

import { buildItemLibreRow, validateItemLibre } from "./item-libre";

const linea = { kind: "free" as const, name: "Torta del cliente", unit_price_cents: 350000, quantity: 1 };

describe("spec 174 · validateItemLibre", () => {
  it("el encargado y el admin pueden", () => {
    expect(validateItemLibre(linea, "encargado").ok).toBe(true);
    expect(validateItemLibre(linea, "admin").ok).toBe(true);
  });

  it("el mozo, el personal y la terminal no — y el error dice a quién pedirle", () => {
    for (const role of ["mozo", "personal", "terminal"] as const) {
      const r = validateItemLibre(linea, role);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toMatch(/encargado/i);
    }
  });

  it("recorta el nombre y rechaza el vacío", () => {
    const r = validateItemLibre({ ...linea, name: "  Menú sanatorio  " }, "encargado");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.libre.name).toBe("Menú sanatorio");

    expect(validateItemLibre({ ...linea, name: "   " }, "encargado").ok).toBe(false);
  });

  it("acepta $0 y rechaza el precio negativo o con decimales", () => {
    expect(validateItemLibre({ ...linea, unit_price_cents: 0 }, "admin").ok).toBe(true);
    expect(validateItemLibre({ ...linea, unit_price_cents: -1 }, "admin").ok).toBe(false);
    expect(validateItemLibre({ ...linea, unit_price_cents: 10.5 }, "admin").ok).toBe(false);
  });

  it("rechaza la cantidad fuera de rango", () => {
    expect(validateItemLibre({ ...linea, quantity: 0 }, "admin").ok).toBe(false);
    expect(validateItemLibre({ ...linea, quantity: 100 }, "admin").ok).toBe(false);
    expect(validateItemLibre({ ...linea, quantity: 99 }, "admin").ok).toBe(true);
  });
});

describe("spec 174 · buildItemLibreRow", () => {
  const row = buildItemLibreRow(
    { name: "Torta del cliente", unit_price_cents: 350000, quantity: 2, notes: "para 8" },
    { orderId: "order-1", userId: "user-1" },
  );

  it("no cuelga de ningún producto del catálogo", () => {
    expect(row.product_id).toBeNull();
    expect(row.product_name).toBe("Torta del cliente");
  });

  it("no va a cocina: sin sector y ya entregado", () => {
    // Misma regla que el issue #189: lo que no va a cocina no espera a cocina.
    // Dejarlo `pending` sería una cola que nadie va a marcar nunca.
    expect(row.station_id).toBeNull();
    expect(row.kitchen_status).toBe("delivered");
  });

  it("el subtotal es precio × cantidad", () => {
    expect(row.unit_price_cents).toBe(350000);
    expect(row.subtotal_cents).toBe(700000);
  });

  it("registra quién lo cargó y a qué orden va", () => {
    expect(row.order_id).toBe("order-1");
    expect(row.loaded_by).toBe("user-1");
    expect(row.notes).toBe("para 8");
  });

  it("no arrastra las columnas del override de precio (spec 069)", () => {
    // El precio del renglón libre no *pisa* nada: no hay precio de catálogo
    // contra el cual medir un delta, así que el reporte de precios
    // modificados no lo tiene que ver.
    expect(row).not.toHaveProperty("price_original_cents");
    expect(row).not.toHaveProperty("price_override_reason");
  });
});
