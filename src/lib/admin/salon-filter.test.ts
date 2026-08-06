import { describe, expect, it } from "vitest";

import { matchesSalon, matchesSalonReserva, reservaSalonId } from "./salon-filter";

describe("matchesSalon", () => {
  it("la selección vacía deja pasar todo, incluso lo que no tiene salón", () => {
    expect(matchesSalon([], "terraza")).toBe(true);
    expect(matchesSalon([], null)).toBe(true);
  });

  it("un salón elegido deja pasar sólo lo suyo", () => {
    expect(matchesSalon(["terraza"], "terraza")).toBe(true);
    expect(matchesSalon(["terraza"], "comedor")).toBe(false);
  });

  it("dos salones a la vez dejan pasar los dos", () => {
    expect(matchesSalon(["terraza", "comedor"], "terraza")).toBe(true);
    expect(matchesSalon(["terraza", "comedor"], "comedor")).toBe(true);
    expect(matchesSalon(["terraza", "comedor"], "quincho")).toBe(false);
  });

  it("lo que no pertenece a ningún salón queda fuera de cualquier selección", () => {
    // Delivery / retiro / mostrador: la comanda no tiene mesa.
    expect(matchesSalon(["terraza"], null)).toBe(false);
    expect(matchesSalon(["terraza", "comedor"], null)).toBe(false);
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

describe("matchesSalonReserva", () => {
  const enTerraza = { tables: { floor_plans: { id: "terraza" } } };
  const zonaComedor = { tables: null, floor_plan_id: "comedor" };
  const sinSalon = { tables: null, floor_plan_id: null };

  it("con salón asignado filtra igual que matchesSalon", () => {
    expect(matchesSalonReserva(["terraza"], enTerraza)).toBe(true);
    expect(matchesSalonReserva(["terraza"], zonaComedor)).toBe(false);
    expect(matchesSalonReserva(["terraza", "comedor"], zonaComedor)).toBe(true);
  });

  it("la reserva sin salón pasa cualquier filtro (#155)", () => {
    expect(matchesSalonReserva([], sinSalon)).toBe(true);
    expect(matchesSalonReserva(["terraza"], sinSalon)).toBe(true);
    expect(matchesSalonReserva(["terraza", "comedor"], sinSalon)).toBe(true);
    expect(matchesSalonReserva([], {})).toBe(true);
    expect(matchesSalonReserva(["terraza"], {})).toBe(true);
  });

  it("la selección vacía sigue dejando pasar todo", () => {
    expect(matchesSalonReserva([], enTerraza)).toBe(true);
    expect(matchesSalonReserva([], zonaComedor)).toBe(true);
  });
});
