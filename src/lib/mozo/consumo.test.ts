import { describe, expect, it } from "vitest";

import { tieneConsumo } from "./consumo";

const vivo = { cancelled_at: null };
const cancelado = { cancelled_at: "2026-07-30T12:00:00Z" };

describe("tieneConsumo", () => {
  it("una mesa sin ítems no tiene consumo", () => {
    expect(tieneConsumo([])).toBe(false);
  });

  it("sin orden abierta (null/undefined) tampoco", () => {
    expect(tieneConsumo(null)).toBe(false);
    expect(tieneConsumo(undefined)).toBe(false);
  });

  it("un solo ítem vivo ya es consumo", () => {
    expect(tieneConsumo([vivo])).toBe(true);
  });

  it("ítems todos cancelados NO son consumo: la mesa quedó como nueva", () => {
    expect(tieneConsumo([cancelado, cancelado])).toBe(false);
  });

  it("basta un vivo entre cancelados", () => {
    expect(tieneConsumo([cancelado, vivo, cancelado])).toBe(true);
  });
});
