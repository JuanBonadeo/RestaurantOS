import { describe, expect, it } from "vitest";

import type { MozoMember } from "./queries";
import { filterMozos, shouldShowMozoSearch } from "./mozo-search";

const mozo = (full_name: string | null, id = full_name ?? "x"): MozoMember => ({
  user_id: id,
  full_name,
  role: "mozo",
});

const equipo = [
  mozo("Juan Pérez"),
  mozo("Román Gómez"),
  mozo("Ana María Pérez"),
  mozo("martin lopez"),
];

describe("filterMozos", () => {
  it("sin búsqueda devuelve todos", () => {
    expect(filterMozos(equipo, "")).toEqual(equipo);
    expect(filterMozos(equipo, "   ")).toEqual(equipo);
  });

  it("no distingue mayúsculas", () => {
    expect(filterMozos(equipo, "MARTIN").map((m) => m.full_name)).toEqual([
      "martin lopez",
    ]);
  });

  it("no distingue acentos, en los dos sentidos", () => {
    // Lo que tipea el mozo en el teléfono casi nunca lleva tilde.
    expect(filterMozos(equipo, "roman").map((m) => m.full_name)).toEqual([
      "Román Gómez",
    ]);
    // Y al revés: si la tipea, tampoco puede fallar.
    expect(filterMozos(equipo, "Rómán").map((m) => m.full_name)).toEqual([
      "Román Gómez",
    ]);
  });

  it("matchea por pedazo de palabra", () => {
    expect(filterMozos(equipo, "per").map((m) => m.full_name)).toEqual([
      "Juan Pérez",
      "Ana María Pérez",
    ]);
  });

  it("los tokens van en cualquier orden", () => {
    expect(filterMozos(equipo, "perez juan").map((m) => m.full_name)).toEqual([
      "Juan Pérez",
    ]);
  });

  it("sin coincidencias devuelve vacío", () => {
    expect(filterMozos(equipo, "zzz")).toEqual([]);
  });

  it("un mozo sin nombre no rompe la búsqueda", () => {
    const conNulo = [...equipo, mozo(null, "sin-nombre")];
    expect(filterMozos(conNulo, "juan").map((m) => m.full_name)).toEqual([
      "Juan Pérez",
    ]);
    // Sin búsqueda sigue estando: no lo escondemos, solo no lo encuentra.
    expect(filterMozos(conNulo, "")).toHaveLength(5);
  });
});

describe("shouldShowMozoSearch", () => {
  it("con equipo chico no aparece", () => {
    expect(shouldShowMozoSearch(0)).toBe(false);
    expect(shouldShowMozoSearch(6)).toBe(false);
  });

  it("aparece a partir de 7 candidatos", () => {
    expect(shouldShowMozoSearch(7)).toBe(true);
    expect(shouldShowMozoSearch(20)).toBe(true);
  });
});
