import { describe, expect, it } from "vitest";

import { entregaLabel, horariosLabel, horaLocal } from "./entrega";

const TZ = "America/Argentina/Buenos_Aires";

describe("entregaLabel", () => {
  it("es la hora DEL PEDIDO, en la timezone del negocio", () => {
    expect(entregaLabel({ scheduled_at: "2026-08-20T23:30:00.000Z" }, TZ)).toBe(
      "20:30 hs",
    );
  });

  it("sin hora, el pedido es para ahora", () => {
    expect(entregaLabel({ scheduled_at: null }, TZ)).toBeNull();
  });
});

describe("horariosLabel (spec 127)", () => {
  it("dice las dos horas cuando el encargado las escribió", () => {
    expect(
      horariosLabel(
        {
          scheduled_at: "2026-08-21T00:30:00.000Z", // 21:30 AR
          kitchen_at: "2026-08-21T00:15:00.000Z", // 21:15 AR
        },
        TZ,
      ),
    ).toBe("21:30 hs · listo 21:15");
  });

  it("el programado del cliente tiene una sola hora", () => {
    expect(
      horariosLabel(
        { scheduled_at: "2026-08-21T00:30:00.000Z", kitchen_at: null },
        TZ,
      ),
    ).toBe("21:30 hs");
  });

  it("sin horas no hay nada que decir", () => {
    expect(horariosLabel({ scheduled_at: null, kitchen_at: null }, TZ)).toBeNull();
  });
});

describe("horaLocal", () => {
  it("formatea en la timezone del negocio, 24 h", () => {
    expect(horaLocal("2026-08-21T00:15:00.000Z", TZ)).toBe("21:15");
  });
});
