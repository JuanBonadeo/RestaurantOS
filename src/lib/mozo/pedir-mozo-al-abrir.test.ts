import { describe, expect, it } from "vitest";

import {
  pideComensalesAlAbrir,
  pideMozoAlAbrir,
} from "./pedir-mozo-al-abrir";

/**
 * Cuándo abrir solo el selector de mozo al entrar a una mesa (spec 146,
 * fast-follow). Es una decisión de un `if`, pero decide si en hora pico te
 * aparece un modal que no pediste, así que va pura y con sus casos escritos.
 */
const base = {
  estado: "libre" as string,
  mozoId: null as string | null,
  esBarra: false,
  puedeAsignar: true,
  candidatos: 3,
};

describe("pideMozoAlAbrir", () => {
  it("mesa libre sin mozo, con quien asignar: sí", () => {
    expect(pideMozoAlAbrir(base)).toBe(true);
  });

  it("la mesa que ya tiene mozo no pregunta nada", () => {
    expect(pideMozoAlAbrir({ ...base, mozoId: "u1" })).toBe(false);
  });

  it("una mesa ocupada tampoco: el mozo se cambia a mano, no de prepo", () => {
    expect(pideMozoAlAbrir({ ...base, estado: "ocupada" })).toBe(false);
    expect(pideMozoAlAbrir({ ...base, estado: "pidio_cuenta" })).toBe(false);
  });

  it("la barra vende sin mozo (spec 08): no pregunta", () => {
    expect(pideMozoAlAbrir({ ...base, esBarra: true })).toBe(false);
  });

  it("sin permiso para asignar, ni se abre", () => {
    expect(pideMozoAlAbrir({ ...base, puedeAsignar: false })).toBe(false);
  });

  it("sin candidatos no se abre un modal vacío", () => {
    expect(pideMozoAlAbrir({ ...base, candidatos: 0 })).toBe(false);
  });
});

/**
 * La segunda pregunta de la apertura (spec 146, fast-follow 2). Es más simple
 * que la del mozo: no depende de permisos de asignación ni de que haya a quién
 * elegir — cuántos se sientan lo sabe cualquiera que pueda cargar el pedido.
 */
describe("pideComensalesAlAbrir", () => {
  it("mesa libre: sí, siempre — tenga o no mozo", () => {
    expect(pideComensalesAlAbrir({ estado: "libre", esBarra: false })).toBe(
      true,
    );
  });

  it("mesa ocupada: no. Ya tiene su gente y su orden en curso", () => {
    expect(pideComensalesAlAbrir({ estado: "ocupada", esBarra: false })).toBe(
      false,
    );
    expect(
      pideComensalesAlAbrir({ estado: "pidio_cuenta", esBarra: false }),
    ).toBe(false);
  });

  it("la barra no tiene comensales: vende de parado (spec 08)", () => {
    expect(pideComensalesAlAbrir({ estado: "libre", esBarra: true })).toBe(
      false,
    );
  });
});
