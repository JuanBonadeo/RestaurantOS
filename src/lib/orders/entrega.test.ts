import { describe, expect, it } from "vitest";

import { entregaLabel } from "./entrega";

const TZ = "America/Argentina/Buenos_Aires";

describe("entregaLabel", () => {
  it("prefiere la nota del encargado", () => {
    expect(
      entregaLabel(
        { kitchen_notes: "21:30, junto con la mesa 5", scheduled_at: "2026-08-20T23:30:00.000Z" },
        TZ,
      ),
    ).toBe("21:30, junto con la mesa 5");
  });

  it("cae en la hora agendada, en la timezone del negocio", () => {
    expect(
      entregaLabel({ kitchen_notes: null, scheduled_at: "2026-08-20T23:30:00.000Z" }, TZ),
    ).toBe("20:30 hs");
  });

  it("una nota en blanco no cuenta como indicación", () => {
    expect(entregaLabel({ kitchen_notes: "   ", scheduled_at: null }, TZ)).toBeNull();
  });

  it("sin nota ni agenda, el pedido es para ahora", () => {
    expect(entregaLabel({ kitchen_notes: null, scheduled_at: null }, TZ)).toBeNull();
  });
});
