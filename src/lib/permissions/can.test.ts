import { describe, expect, it } from "vitest";

import {
  DESCUENTO_BAJO_PCT,
  DESCUENTO_MEDIO_PCT,
  DIFERENCIA_CAJA_OK_CENTS,
  canAcceptCajaDifference,
  canAnularFactura,
  canApplyDiscount,
  canCancelItem,
  canCargarPedido,
  canCrearPedidoFlash,
  canHacerCorte,
  canMakeSangria,
  canConfigureReservations,
  canManageCajas,
  canManageReservations,
  canMarkRotura,
  canMoveTable,
  canModifyPostEnvio,
  canOverrideItemPrice,
  canRendirMozo,
  canSeatReservation,
} from "./can";

describe("permissions / canMoveTable", () => {
  it("solo admin y encargado pueden trasladar una mesa (spec 048)", () => {
    expect(canMoveTable("admin")).toBe(true);
    expect(canMoveTable("encargado")).toBe(true);
    expect(canMoveTable("mozo")).toBe(false);
  });
});

describe("permissions / canModifyPostEnvio", () => {
  it("admin y encargado pueden, mozo no", () => {
    expect(canModifyPostEnvio("admin")).toBe(true);
    expect(canModifyPostEnvio("encargado")).toBe(true);
    expect(canModifyPostEnvio("mozo")).toBe(false);
  });
});

describe("permissions / canCancelItem", () => {
  it("admin y encargado pueden, mozo no", () => {
    expect(canCancelItem("admin")).toBe(true);
    expect(canCancelItem("encargado")).toBe(true);
    expect(canCancelItem("mozo")).toBe(false);
  });
});

describe("permissions / canOverrideItemPrice", () => {
  it("admin y encargado pueden, mozo y personal no", () => {
    expect(canOverrideItemPrice("admin")).toBe(true);
    expect(canOverrideItemPrice("encargado")).toBe(true);
    expect(canOverrideItemPrice("mozo")).toBe(false);
    expect(canOverrideItemPrice("personal")).toBe(false);
  });
});

describe("permissions / canMarkRotura", () => {
  it("admin y encargado pueden, mozo no", () => {
    expect(canMarkRotura("admin")).toBe(true);
    expect(canMarkRotura("encargado")).toBe(true);
    expect(canMarkRotura("mozo")).toBe(false);
  });
});

describe("permissions / canApplyDiscount", () => {
  it("admin acepta cualquier porcentaje no negativo", () => {
    expect(canApplyDiscount("admin", 0)).toBe(true);
    expect(canApplyDiscount("admin", 25)).toBe(true);
    expect(canApplyDiscount("admin", 99)).toBe(true);
  });

  it("admin rechaza descuentos negativos", () => {
    expect(canApplyDiscount("admin", -1)).toBe(false);
  });

  it("encargado de caja: borde exacto en 25% acepta", () => {
    expect(canApplyDiscount("encargado", DESCUENTO_MEDIO_PCT)).toBe(true);
    expect(canApplyDiscount("encargado", 24.99)).toBe(true);
  });

  it("encargado de caja: por encima de 25% rechaza", () => {
    expect(canApplyDiscount("encargado", 25.0001)).toBe(false);
    expect(canApplyDiscount("encargado", 30)).toBe(false);
    expect(canApplyDiscount("encargado", 100)).toBe(false);
  });

  it("mozo: borde exacto en 10% acepta", () => {
    expect(canApplyDiscount("mozo", DESCUENTO_BAJO_PCT)).toBe(true);
    expect(canApplyDiscount("mozo", 9.99)).toBe(true);
    expect(canApplyDiscount("mozo", 0)).toBe(true);
  });

  it("mozo: por encima de 10% rechaza", () => {
    expect(canApplyDiscount("mozo", 10.0001)).toBe(false);
    expect(canApplyDiscount("mozo", 11)).toBe(false);
    expect(canApplyDiscount("mozo", 25)).toBe(false);
  });
});

describe("permissions / canManageCajas", () => {
  it("solo admin puede", () => {
    expect(canManageCajas("admin")).toBe(true);
    expect(canManageCajas("encargado")).toBe(false);
    expect(canManageCajas("mozo")).toBe(false);
  });
});

describe("permissions / canHacerCorte", () => {
  it("admin y encargado pueden, mozo no", () => {
    expect(canHacerCorte("admin")).toBe(true);
    expect(canHacerCorte("encargado")).toBe(true);
    expect(canHacerCorte("mozo")).toBe(false);
  });
});

describe("permissions / canAcceptCajaDifference", () => {
  it("admin acepta cualquier diferencia", () => {
    expect(canAcceptCajaDifference("admin", 0)).toBe(true);
    expect(canAcceptCajaDifference("admin", 100_000_000)).toBe(true);
    expect(canAcceptCajaDifference("admin", -100_000_000)).toBe(true);
  });

  it("encargado: borde exacto en $5000 (positivo) acepta", () => {
    expect(canAcceptCajaDifference("encargado", DIFERENCIA_CAJA_OK_CENTS))
      .toBe(true);
  });

  it("encargado: borde exacto en -$5000 (faltante) acepta", () => {
    expect(canAcceptCajaDifference("encargado", -DIFERENCIA_CAJA_OK_CENTS))
      .toBe(true);
  });

  it("encargado: $5000.01 rechaza (sobrante)", () => {
    expect(canAcceptCajaDifference("encargado", DIFERENCIA_CAJA_OK_CENTS + 1))
      .toBe(false);
  });

  it("encargado: -$5000.01 rechaza (faltante)", () => {
    expect(
      canAcceptCajaDifference(
        "encargado",
        -(DIFERENCIA_CAJA_OK_CENTS + 1),
      ),
    ).toBe(false);
  });

  it("mozo siempre rechaza", () => {
    expect(canAcceptCajaDifference("mozo", 0)).toBe(false);
    expect(canAcceptCajaDifference("mozo", 1000)).toBe(false);
  });
});

describe("permissions / canMakeSangria", () => {
  it("admin y encargado pueden, mozo no", () => {
    expect(canMakeSangria("admin")).toBe(true);
    expect(canMakeSangria("encargado")).toBe(true);
    expect(canMakeSangria("mozo")).toBe(false);
  });
});

describe("permissions / canRendirMozo", () => {
  it("admin y encargado pueden, mozo no", () => {
    expect(canRendirMozo("admin")).toBe(true);
    expect(canRendirMozo("encargado")).toBe(true);
    expect(canRendirMozo("mozo")).toBe(false);
  });
});

describe("permissions / canAnularFactura", () => {
  it("admin y encargado pueden anular, mozo y personal no", () => {
    expect(canAnularFactura("admin")).toBe(true);
    expect(canAnularFactura("encargado")).toBe(true);
    expect(canAnularFactura("mozo")).toBe(false);
    expect(canAnularFactura("personal")).toBe(false);
  });
});

describe("permissions / canCrearPedidoFlash", () => {
  it("admin y encargado (mostrador) pueden, mozo y personal no", () => {
    expect(canCrearPedidoFlash("admin")).toBe(true);
    expect(canCrearPedidoFlash("encargado")).toBe(true);
    expect(canCrearPedidoFlash("mozo")).toBe(false);
    expect(canCrearPedidoFlash("personal")).toBe(false);
  });
});

describe("permissions / canCargarPedido", () => {
  it("admin y encargado (mostrador) pueden cargar pedidos, mozo y personal no (spec 054, fase 1)", () => {
    expect(canCargarPedido("admin")).toBe(true);
    expect(canCargarPedido("encargado")).toBe(true);
    expect(canCargarPedido("mozo")).toBe(false);
    expect(canCargarPedido("personal")).toBe(false);
  });
});

describe("permissions / canManageReservations", () => {
  it("admin, encargado y mozo pueden; personal no", () => {
    expect(canManageReservations("admin")).toBe(true);
    expect(canManageReservations("encargado")).toBe(true);
    expect(canManageReservations("mozo")).toBe(true);
    expect(canManageReservations("personal")).toBe(false);
  });

  it("sin membership (null) no puede", () => {
    expect(canManageReservations(null)).toBe(false);
  });

  it("canSeatReservation es alias de canManageReservations", () => {
    expect(canSeatReservation("mozo")).toBe(true);
    expect(canSeatReservation("personal")).toBe(false);
  });
});

describe("permissions / canConfigureReservations", () => {
  it("admin y encargado configuran; mozo y personal no", () => {
    expect(canConfigureReservations("admin")).toBe(true);
    expect(canConfigureReservations("encargado")).toBe(true);
    expect(canConfigureReservations("mozo")).toBe(false);
    expect(canConfigureReservations("personal")).toBe(false);
  });

  it("sin membership (null) no puede", () => {
    expect(canConfigureReservations(null)).toBe(false);
  });
});
