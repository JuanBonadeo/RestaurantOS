import { describe, expect, it } from "vitest";

import { soloCambiaElPrecio } from "./edicion";

// Issue #283 — qué edición de una línea ya enviada merece papel en el sector.
describe("soloCambiaElPrecio", () => {
  it("un cambio de precio (con o sin motivo) no toca lo que cocina prepara", () => {
    expect(
      soloCambiaElPrecio({
        priceOverrideCents: 350000,
        priceOverrideReason: "media porción",
      }),
    ).toBe(true);
    // Volver a la carta es lo mismo del otro lado: sigue siendo plata.
    expect(soloCambiaElPrecio({ priceOverrideCents: null })).toBe(true);
  });

  it("cantidad, producto o aclaración sí cambian el plato", () => {
    expect(soloCambiaElPrecio({ quantity: 2 })).toBe(false);
    expect(soloCambiaElPrecio({ productId: "p2" })).toBe(false);
    expect(soloCambiaElPrecio({ notes: "sin sal" })).toBe(false);
    // Y mezclado con el precio, también: el papel sale por el otro cambio.
    expect(soloCambiaElPrecio({ quantity: 2, priceOverrideCents: 100 })).toBe(
      false,
    );
  });

  it("un patch vacío no es un cambio de precio", () => {
    expect(soloCambiaElPrecio({})).toBe(false);
  });
});
