import { describe, expect, it } from "vitest";

import {
  armarLibro,
  calcularSaldo,
  diasSinPagar,
  tramoDeAntiguedad,
  type CargoCuentaCorriente,
  type CobranzaCuentaCorriente,
} from "./cuenta-corriente";

const cargo = (
  over: Partial<CargoCuentaCorriente> = {},
): CargoCuentaCorriente => ({
  id: "c1",
  amount_cents: 10_000,
  created_at: "2026-09-01T12:00:00Z",
  cancelled_at: null,
  order_number: 128,
  ...over,
});

const cobranza = (
  over: Partial<CobranzaCuentaCorriente> = {},
): CobranzaCuentaCorriente => ({
  id: "p1",
  amount_cents: 10_000,
  created_at: "2026-09-02T12:00:00Z",
  method: "cash",
  cancelled_at: null,
  ...over,
});

describe("calcularSaldo", () => {
  it("sin movimientos, no debe nada", () => {
    expect(calcularSaldo([], [])).toBe(0);
  });

  it("los consumos suman y las cobranzas restan", () => {
    const saldo = calcularSaldo(
      [
        cargo({ id: "a", amount_cents: 25_000 }),
        cargo({ id: "b", amount_cents: 15_000 }),
      ],
      [cobranza({ amount_cents: 30_000 })],
    );
    expect(saldo).toBe(10_000);
  });

  it("un consumo anulado deja de deberse", () => {
    // El cobro se anula desde el libro de caja (spec 070) y el saldo tiene que
    // seguirlo solo: es justamente por esto que se deriva en vez de llevarse
    // en un libro aparte que habría que mantener en sync.
    const saldo = calcularSaldo(
      [
        cargo({ id: "a" }),
        cargo({ id: "b", cancelled_at: "2026-09-02T10:00:00Z" }),
      ],
      [],
    );
    expect(saldo).toBe(10_000);
  });

  it("una cobranza anulada vuelve a dejar la deuda", () => {
    const saldo = calcularSaldo(
      [cargo()],
      [cobranza({ cancelled_at: "2026-09-03T10:00:00Z" })],
    );
    expect(saldo).toBe(10_000);
  });

  it("pagar de más da saldo a favor, y NO se clampa a cero", () => {
    // Esconderlo sería esconder plata que el local le debe a alguien.
    expect(calcularSaldo([cargo()], [cobranza({ amount_cents: 15_000 })])).toBe(
      -5_000,
    );
  });
});

describe("armarLibro", () => {
  it("mezcla consumos y cobranzas, del más nuevo al más viejo", () => {
    const libro = armarLibro(
      [cargo({ id: "a", created_at: "2026-09-01T12:00:00Z" })],
      [cobranza({ id: "p", created_at: "2026-09-02T12:00:00Z" })],
    );
    expect(libro.map((m) => m.id)).toEqual(["p", "a"]);
    expect(libro[0].detalle).toBe("Pago · Efectivo");
    expect(libro[1].detalle).toBe("Consumo #128");
  });

  it("lo anulado se muestra igual, marcado", () => {
    const libro = armarLibro(
      [cargo({ cancelled_at: "2026-09-02T10:00:00Z" })],
      [],
    );
    expect(libro).toHaveLength(1);
    expect(libro[0].anulado).toBe(true);
  });
});

describe("diasSinPagar", () => {
  const ahora = new Date("2026-09-10T12:00:00Z");

  it("sin deuda, no hay antigüedad que mostrar", () => {
    expect(diasSinPagar([], [], ahora)).toBeNull();
  });

  it("cuenta desde la última cobranza", () => {
    expect(
      diasSinPagar(
        [cargo()],
        [cobranza({ created_at: "2026-09-05T12:00:00Z" })],
        ahora,
      ),
    ).toBe(5);
  });

  it("si nunca pagó, cuenta desde el primer consumo", () => {
    expect(
      diasSinPagar([cargo({ created_at: "2026-08-31T12:00:00Z" })], [], ahora),
    ).toBe(10);
  });

  it("un consumo anulado no arranca el reloj", () => {
    expect(
      diasSinPagar(
        [
          cargo({
            id: "viejo",
            created_at: "2026-01-01T12:00:00Z",
            cancelled_at: "x",
          }),
          cargo({ id: "vivo", created_at: "2026-09-08T12:00:00Z" }),
        ],
        [],
        ahora,
      ),
    ).toBe(2);
  });
});

describe("tramoDeAntiguedad", () => {
  it("reparte en al día / +30 / +60", () => {
    expect(tramoDeAntiguedad(null)).toBe("al_dia");
    expect(tramoDeAntiguedad(29)).toBe("al_dia");
    expect(tramoDeAntiguedad(30)).toBe("mas_30");
    expect(tramoDeAntiguedad(59)).toBe("mas_30");
    expect(tramoDeAntiguedad(60)).toBe("mas_60");
  });
});
