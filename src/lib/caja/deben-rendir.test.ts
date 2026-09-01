import { describe, expect, it } from "vitest";

import { mozosQueDebenRendir } from "./deben-rendir";

type Row = Parameters<typeof mozosQueDebenRendir>[0][number];

function mozo(over: Partial<Row> & { mozo_id: string }): Row {
  return {
    mozo_name: over.mozo_id,
    efectivo_cents: 0,
    pagos_count: 1,
    ...over,
  };
}

describe("mozosQueDebenRendir (spec 139 · D3 + D4)", () => {
  it("deja afuera al que no cobró nada en el período", () => {
    const out = mozosQueDebenRendir(
      [
        mozo({ mozo_id: "nacho", efectivo_cents: 71_200, pagos_count: 3 }),
        mozo({ mozo_id: "sin-turno", pagos_count: 0 }),
      ],
      [],
    );

    expect(out.map((m) => m.mozo_id)).toEqual(["nacho"]);
  });

  it("incluye al que cobró todo con tarjeta: rinde el que cobró, no el que tiene efectivo (D4)", () => {
    const out = mozosQueDebenRendir(
      [mozo({ mozo_id: "caro", efectivo_cents: 0, pagos_count: 5 })],
      [],
    );

    expect(out.map((m) => m.mozo_id)).toEqual(["caro"]);
  });

  it("deja afuera al operador de la caja: su plata ya está en el cajón (D3)", () => {
    const out = mozosQueDebenRendir(
      [
        mozo({ mozo_id: "sofia", efectivo_cents: 113_800, pagos_count: 9 }),
        mozo({ mozo_id: "nacho", efectivo_cents: 71_200, pagos_count: 3 }),
      ],
      ["sofia"],
    );

    expect(out.map((m) => m.mozo_id)).toEqual(["nacho"]);
  });

  it("ordena por efectivo descendente y desempata por nombre", () => {
    const out = mozosQueDebenRendir(
      [
        mozo({ mozo_id: "b", mozo_name: "Beto", efectivo_cents: 10_000 }),
        mozo({ mozo_id: "a", mozo_name: "Ana", efectivo_cents: 10_000 }),
        mozo({ mozo_id: "c", mozo_name: "Caro", efectivo_cents: 90_000 }),
      ],
      [],
    );

    expect(out.map((m) => m.mozo_name)).toEqual(["Caro", "Ana", "Beto"]);
  });

  it("sin nadie que haya cobrado, no hay nada que bloquear", () => {
    expect(mozosQueDebenRendir([], [])).toEqual([]);
    expect(mozosQueDebenRendir([mozo({ mozo_id: "x", pagos_count: 0 })], [])).toEqual(
      [],
    );
  });
});
