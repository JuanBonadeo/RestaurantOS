import { describe, expect, it } from "vitest";

import { SALON_ALL, matchesSalon, reservaSalonId } from "./salon-filter";

describe("matchesSalon", () => {
  it("«Todos» deja pasar todo, incluso lo que no tiene salón", () => {
    expect(matchesSalon(SALON_ALL, "terraza")).toBe(true);
    expect(matchesSalon(SALON_ALL, null)).toBe(true);
  });

  it("un salón puntual deja pasar sólo lo suyo", () => {
    expect(matchesSalon("terraza", "terraza")).toBe(true);
    expect(matchesSalon("terraza", "comedor")).toBe(false);
  });

  it("lo que no pertenece a ningún salón queda fuera de un salón puntual", () => {
    // Delivery / retiro / mostrador: la comanda no tiene mesa.
    expect(matchesSalon("terraza", null)).toBe(false);
  });
});

describe("reservaSalonId", () => {
  it("con mesa asignada, el salón sale de la mesa", () => {
    expect(
      reservaSalonId({
        tables: { floor_plans: { id: "terraza" } },
        floor_plan_id: "comedor",
      }),
    ).toBe("terraza");
  });

  it("sin mesa (flexible), cae a la zona propia de la reserva", () => {
    expect(reservaSalonId({ tables: null, floor_plan_id: "comedor" })).toBe(
      "comedor",
    );
  });

  it("sin mesa ni zona, no pertenece a ningún salón", () => {
    expect(reservaSalonId({ tables: null, floor_plan_id: null })).toBeNull();
    expect(reservaSalonId({})).toBeNull();
  });

  it("mesa sin plano cargado cae a la zona propia", () => {
    expect(
      reservaSalonId({ tables: { floor_plans: null }, floor_plan_id: "quincho" }),
    ).toBe("quincho");
  });
});
