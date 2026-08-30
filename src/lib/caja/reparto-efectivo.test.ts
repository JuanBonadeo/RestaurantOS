import { describe, expect, it } from "vitest";

import { repartirEfectivoEsperado } from "./reparto-efectivo";

const mozo = (id: string, nombre: string, efectivo: number) => ({
  mozo_id: id,
  mozo_name: nombre,
  efectivo_cents: efectivo,
});

describe("repartirEfectivoEsperado", () => {
  it("sin mozos pendientes: todo el esperado está en el cajón", () => {
    const r = repartirEfectivoEsperado({
      expected_cash_cents: 312_400,
      mozos_sin_rendir: [],
    });
    expect(r.en_cajon_cents).toBe(312_400);
    expect(r.mozos).toEqual([]);
    expect(r.descuadre_cents).toBe(0);
  });

  it("el ejemplo de la spec: el cajón es el resto de lo que no rindieron", () => {
    const r = repartirEfectivoEsperado({
      expected_cash_cents: 312_400,
      mozos_sin_rendir: [
        mozo("n", "Nacho", 71_200),
        mozo("c", "Caro", 43_200),
      ],
    });
    expect(r.en_cajon_cents).toBe(198_000);
    expect(r.mozos.map((m) => m.mozo_name)).toEqual(["Nacho", "Caro"]);
    expect(r.en_cajon_cents + r.mozos.reduce((s, m) => s + m.efectivo_cents, 0)).toBe(
      312_400,
    );
  });

  it("el mozo que no tiene efectivo pendiente no ocupa un renglón", () => {
    const r = repartirEfectivoEsperado({
      expected_cash_cents: 100_000,
      mozos_sin_rendir: [
        mozo("a", "Sin plata", 0),
        mozo("b", "Con plata", 30_000),
      ],
    });
    expect(r.mozos.map((m) => m.mozo_name)).toEqual(["Con plata"]);
    expect(r.en_cajon_cents).toBe(70_000);
  });

  it("ordena de mayor a menor: primero el que más plata tiene encima", () => {
    const r = repartirEfectivoEsperado({
      expected_cash_cents: 100_000,
      mozos_sin_rendir: [
        mozo("a", "Chico", 10_000),
        mozo("b", "Grande", 40_000),
        mozo("c", "Medio", 20_000),
      ],
    });
    expect(r.mozos.map((m) => m.mozo_name)).toEqual(["Grande", "Medio", "Chico"]);
  });

  // Pasa de verdad: el mozo cobró $50.000 en efectivo y todavía no rindió,
  // pero el encargado ya hizo una sangría por esa plata. El esperado bajó y lo
  // que el mozo tiene encima no. El cajón no puede mostrar un negativo —
  // se clampea y el descuadre se dice aparte en vez de inventar un número.
  it("si lo no rendido excede al esperado, el cajón es $0 y el descuadre se expone", () => {
    const r = repartirEfectivoEsperado({
      expected_cash_cents: 20_000,
      mozos_sin_rendir: [mozo("a", "Nacho", 50_000)],
    });
    expect(r.en_cajon_cents).toBe(0);
    expect(r.descuadre_cents).toBe(30_000);
  });

  it("un esperado negativo (sangría de más) no arrastra el reparto", () => {
    const r = repartirEfectivoEsperado({
      expected_cash_cents: -5_000,
      mozos_sin_rendir: [],
    });
    expect(r.en_cajon_cents).toBe(-5_000);
    expect(r.descuadre_cents).toBe(0);
  });
});
