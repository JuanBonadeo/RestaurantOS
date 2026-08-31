import { describe, expect, it } from "vitest";

import {
  mesaSirveParaReserva,
  textoDeAsignacion,
  textoDelModo,
} from "./asignar-mesa";

const mesa = (seats: number, status: "active" | "disabled" = "active") => ({
  label: "12",
  seats,
  status,
});

describe("mesaSirveParaReserva", () => {
  it("entra justo: sirve", () => {
    expect(mesaSirveParaReserva({ mesa: mesa(6), partySize: 6 })).toEqual({
      ok: true,
    });
  });

  it("sobra lugar: sirve", () => {
    expect(mesaSirveParaReserva({ mesa: mesa(8), partySize: 2 }).ok).toBe(true);
  });

  it("no entran: lo dice con los dos números", () => {
    const r = mesaSirveParaReserva({ mesa: mesa(4), partySize: 6 });
    expect(r).toEqual({
      ok: false,
      motivo: "Mesa 12 tiene 4 lugares para 6 personas.",
    });
  });

  it("singular cuando corresponde", () => {
    const r = mesaSirveParaReserva({ mesa: mesa(1), partySize: 2 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.motivo).toContain("1 lugar para 2 personas");
  });

  it("una mesa deshabilitada no sirve aunque entren", () => {
    const r = mesaSirveParaReserva({
      mesa: mesa(10, "disabled"),
      partySize: 2,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.motivo).toContain("deshabilitada");
  });
});

describe("copy del modo", () => {
  it("asignar y sentar dicen cosas distintas", () => {
    expect(textoDelModo({ intent: "assign", nombre: "Martín", partySize: 6 })).toBe(
      "Tocá una mesa para Martín · 6p",
    );
    expect(textoDelModo({ intent: "seat", nombre: "Martín", partySize: 6 })).toBe(
      "Tocá dónde sentar a Martín · 6p",
    );
  });

  it("el aviso final también", () => {
    expect(
      textoDeAsignacion({ intent: "assign", etiquetaMesa: "12", nombre: "Ana" }),
    ).toBe("Mesa 12 asignada a Ana.");
    expect(
      textoDeAsignacion({ intent: "seat", etiquetaMesa: "12", nombre: "Ana" }),
    ).toBe("Ana sentado en 12.");
  });
});
