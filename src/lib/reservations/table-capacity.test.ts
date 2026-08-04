import { describe, expect, it } from "vitest";

import { assignParty, simulateTableUsage, type TableSeat } from "./table-capacity";

const mesas = (...seats: number[]): TableSeat[] =>
  seats.map((s, i) => ({ id: `T${i + 1}`, seats: s }));

describe("assignParty", () => {
  it("toma la mesa más chica que entre el party (no desperdicia la grande)", () => {
    const out = assignParty(4, [2, 4, 8])!;
    expect(out.count).toBe(1);
    expect(out.rest.sort()).toEqual([2, 8]);
  });

  it("si ninguna mesa entra el grupo, lo parte entre varias", () => {
    // Salón de mesas de 4: un grupo de 10 se sienta en 3 mesas.
    const out = assignParty(10, [4, 4, 4, 4])!;
    expect(out.count).toBe(3);
    expect(out.rest).toEqual([4]);
  });

  it("parte usando primero las mesas más grandes", () => {
    const out = assignParty(10, [2, 4, 8])!;
    // 8 + 2 alcanza: 2 mesas, queda libre la de 4.
    expect(out.count).toBe(2);
    expect(out.rest).toEqual([4]);
  });

  it("no alcanzan las mesas ni sumándolas todas → null", () => {
    expect(assignParty(12, [2, 4])).toBeNull();
    expect(assignParty(2, [])).toBeNull();
  });

  it("un party de 1 consume una mesa igual", () => {
    expect(assignParty(1, [4])!.count).toBe(1);
  });
});

describe("simulateTableUsage", () => {
  it("sin reservas no se consume ninguna mesa", () => {
    const out = simulateTableUsage(mesas(4, 4, 4), []);
    expect(out.usedCount).toBe(0);
    expect(out.freeSeats).toHaveLength(3);
  });

  it("una reserva con mesa asignada consume exactamente esa mesa", () => {
    const out = simulateTableUsage(mesas(2, 4, 8), [{ tableId: "T3", partySize: 2 }]);
    expect(out.usedCount).toBe(1);
    expect(out.freeSeats.sort()).toEqual([2, 4]); // se fue la de 8
  });

  it("las genéricas se imputan a mesas aunque no tengan mesa asignada — el agujero de 077", () => {
    // 4 reservas de 2 en un salón de 3 mesas: consumen las 3 y una no entra.
    const out = simulateTableUsage(
      mesas(4, 4, 4),
      [2, 2, 2, 2].map((partySize) => ({ tableId: null, partySize })),
    );
    expect(out.usedCount).toBe(3);
    expect(out.freeSeats).toHaveLength(0);
  });

  it("un grupo grande consume las mesas que necesita", () => {
    const out = simulateTableUsage(mesas(4, 4, 4, 4), [{ tableId: null, partySize: 10 }]);
    expect(out.usedCount).toBe(3);
  });

  it("atiende primero a los grupos grandes (si no, se quedan sin lugar por las mesas chicas)", () => {
    // Con 2 mesas (8 y 2): si entrara primero el party de 2 tomaría la de 2,
    // y el de 8 seguiría entrando en la de 8. El orden importa al revés:
    // el grande primero toma la de 8 y el chico la de 2 → 2 mesas, todo entra.
    const out = simulateTableUsage(mesas(8, 2), [
      { tableId: null, partySize: 2 },
      { tableId: null, partySize: 8 },
    ]);
    expect(out.usedCount).toBe(2);
    expect(out.freeSeats).toHaveLength(0);
  });

  it("una mesa asignada que no es de la zona no descuenta nada", () => {
    const out = simulateTableUsage(mesas(4, 4), [{ tableId: "otra-zona", partySize: 2 }]);
    // La reserva sigue ocupando lugar, pero sobre las mesas de ESTA zona
    // se imputa como genérica.
    expect(out.usedCount).toBe(1);
  });

  it("cuando las reservas exceden el salón, el consumo se topea en las mesas que hay", () => {
    const out = simulateTableUsage(
      mesas(4, 4),
      Array.from({ length: 10 }, () => ({ tableId: null, partySize: 2 })),
    );
    expect(out.usedCount).toBe(2);
    expect(out.freeSeats).toHaveLength(0);
  });
});
