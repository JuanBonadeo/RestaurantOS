import { describe, expect, it } from "vitest";

import {
  applyPriceOverride,
  lineSubtotalCents,
  validatePriceOverride,
} from "./price-override";

// Spec 069 — precio por ítem editable con motivo. Lógica pura: validación del
// par (precio, motivo) contra el rol, y resolución de qué precio termina en la
// línea. Las actions (`enviarComanda`, `cargarPedidoStaff`,
// `editarItemComanda`) montan sobre esto.

describe("price-override / validatePriceOverride", () => {
  it("sin override, cualquier rol pasa", () => {
    expect(validatePriceOverride({}, "mozo")).toEqual({ ok: true, override: null });
    expect(
      validatePriceOverride(
        { price_override_cents: null, price_override_reason: null },
        "personal",
      ),
    ).toEqual({ ok: true, override: null });
  });

  it("encargado y admin pueden; mozo y personal no", () => {
    const input = { price_override_cents: 500, price_override_reason: "cortesía" };
    expect(validatePriceOverride(input, "encargado").ok).toBe(true);
    expect(validatePriceOverride(input, "admin").ok).toBe(true);

    const mozo = validatePriceOverride(input, "mozo");
    expect(mozo.ok).toBe(false);
    expect(mozo.ok === false && mozo.error).toMatch(/no permite cambiar el precio/i);
    expect(validatePriceOverride(input, "personal").ok).toBe(false);
  });

  it("acepta $0 — la cortesía es el caso central", () => {
    const r = validatePriceOverride(
      { price_override_cents: 0, price_override_reason: "cortesía, plato quemado" },
      "encargado",
    );
    expect(r).toEqual({
      ok: true,
      override: { cents: 0, reason: "cortesía, plato quemado" },
    });
  });

  it("acepta un precio POR ENCIMA del de lista (no hay tope)", () => {
    const r = validatePriceOverride(
      { price_override_cents: 9_999_999, price_override_reason: "pescado del día" },
      "encargado",
    );
    expect(r.ok).toBe(true);
  });

  it("exige motivo no vacío", () => {
    for (const reason of [undefined, null, "", "   ", "\n\t"]) {
      const r = validatePriceOverride(
        { price_override_cents: 500, price_override_reason: reason },
        "encargado",
      );
      expect(r.ok).toBe(false);
      expect(r.ok === false && r.error).toMatch(/motivo/i);
    }
  });

  it("recorta el motivo", () => {
    const r = validatePriceOverride(
      { price_override_cents: 500, price_override_reason: "  media porción  " },
      "encargado",
    );
    expect(r.ok === true && r.override?.reason).toBe("media porción");
  });

  it("rechaza motivo sin precio — señal de un cliente mal armado", () => {
    const r = validatePriceOverride(
      { price_override_reason: "cortesía" },
      "encargado",
    );
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.error).toMatch(/sin un precio/i);
  });

  it("rechaza precios negativos y no enteros", () => {
    for (const cents of [-1, -0.5, 10.5, NaN, Infinity]) {
      const r = validatePriceOverride(
        { price_override_cents: cents, price_override_reason: "x" },
        "encargado",
      );
      expect(r.ok).toBe(false);
    }
  });
});

describe("price-override / applyPriceOverride", () => {
  it("sin override, la línea va a precio de catálogo y no marca nada", () => {
    expect(applyPriceOverride(10_000, null, "u1")).toEqual({
      unit_price_cents: 10_000,
      price_original_cents: null,
      price_override_at: null,
      price_override_by: null,
      price_override_reason: null,
    });
  });

  it("con override, cobra el override y guarda el de lista", () => {
    const r = applyPriceOverride(10_000, { cents: 0, reason: "cortesía" }, "u1");
    expect(r.unit_price_cents).toBe(0);
    expect(r.price_original_cents).toBe(10_000);
    expect(r.price_override_by).toBe("u1");
    expect(r.price_override_reason).toBe("cortesía");
    expect(r.price_override_at).toBeTypeOf("string");
  });

  it("un segundo override NO pisa el precio de lista original", () => {
    // La línea ya venía overrideada a $6.000 desde un catálogo de $10.000.
    const r = applyPriceOverride(
      6_000,
      { cents: 4_000, reason: "segundo ajuste" },
      "u2",
      10_000, // price_original_cents ya existente
    );
    expect(r.unit_price_cents).toBe(4_000);
    // El delta del reporte se mide contra la LISTA, no contra el ajuste previo.
    expect(r.price_original_cents).toBe(10_000);
    expect(r.price_override_by).toBe("u2");
    expect(r.price_override_reason).toBe("segundo ajuste");
  });
});

describe("price-override / lineSubtotalCents", () => {
  it("el override reemplaza sólo la base; los adicionales conservan su precio", () => {
    // Producto $10.000 overrideado a $6.000, con dos adicionales de $500 y $300.
    expect(lineSubtotalCents(6_000, 800, 2)).toBe((6_000 + 800) * 2);
  });

  it("cortesía a $0 con adicionales sigue cobrando los adicionales", () => {
    expect(lineSubtotalCents(0, 800, 1)).toBe(800);
  });

  it("sin adicionales es precio por cantidad", () => {
    expect(lineSubtotalCents(10_000, 0, 3)).toBe(30_000);
  });
});
