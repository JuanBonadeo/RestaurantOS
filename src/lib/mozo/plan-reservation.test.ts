import { describe, expect, it } from "vitest";

import {
  VENTANA_RESERVA_EN_PLANO_MS,
  planReservationsByTable,
} from "./plan-reservation";

const MEDIODIA = new Date("2026-08-04T12:00:00-03:00").getTime();

function reserva(p: {
  id: string;
  hora: string;
  table_id?: string | null;
  status?: string;
}) {
  return {
    id: p.id,
    table_id: p.table_id === undefined ? "t1" : p.table_id,
    starts_at: new Date(`2026-08-04T${p.hora}-03:00`).toISOString(),
    status: p.status ?? "confirmed",
  };
}

describe("planReservationsByTable", () => {
  it("la reserva de la noche no se dibuja al mediodía", () => {
    const map = planReservationsByTable([reserva({ id: "r1", hora: "21:00" })], MEDIODIA);
    expect(map.t1).toBeUndefined();
  });

  it("aparece cuando entra en la ventana de 3 h", () => {
    const map = planReservationsByTable(
      [reserva({ id: "r1", hora: "21:00" })],
      MEDIODIA + 6.5 * 60 * 60 * 1000, // 18:30
    );
    expect(map.t1?.id).toBe("r1");
  });

  it("una reserva que ya pasó sigue en la mesa (viene tarde)", () => {
    const map = planReservationsByTable(
      [reserva({ id: "r1", hora: "11:30" })],
      MEDIODIA,
    );
    expect(map.t1?.id).toBe("r1");
  });

  it("con dos reservas del día sobre la misma mesa gana la próxima, no la última", () => {
    const map = planReservationsByTable(
      [reserva({ id: "almuerzo", hora: "13:00" }), reserva({ id: "cena", hora: "21:00" })],
      MEDIODIA,
    );
    expect(map.t1?.id).toBe("almuerzo");
  });

  it("pasado el almuerzo, la mesa muestra la de la noche apenas entra en ventana", () => {
    const reservas = [
      reserva({ id: "almuerzo", hora: "13:00" }),
      reserva({ id: "cena", hora: "21:00" }),
    ];
    const alas17 = MEDIODIA + 5 * 60 * 60 * 1000;
    // 17:00 → la cena todavía está a 4 h; la mesa muestra la del almuerzo.
    expect(planReservationsByTable(reservas, alas17).t1?.id).toBe("almuerzo");
    // 19:00 → la cena entró en ventana y es la próxima.
    expect(
      planReservationsByTable(reservas, MEDIODIA + 7 * 60 * 60 * 1000).t1?.id,
    ).toBe("cena");
  });

  it("la reserva sentada se ve aunque su hora esté lejos (los sentaron temprano)", () => {
    const map = planReservationsByTable(
      [reserva({ id: "r1", hora: "21:00", status: "seated" })],
      MEDIODIA,
    );
    expect(map.t1?.id).toBe("r1");
  });

  it("la sentada le gana a la próxima confirmada de la misma mesa", () => {
    const map = planReservationsByTable(
      [
        reserva({ id: "sentada", hora: "11:00", status: "seated" }),
        reserva({ id: "proxima", hora: "13:30" }),
      ],
      MEDIODIA,
    );
    expect(map.t1?.id).toBe("sentada");
  });

  it("sin hora todavía (SSR) no dibuja ninguna", () => {
    const map = planReservationsByTable([reserva({ id: "r1", hora: "12:15" })], null);
    expect(map).toEqual({});
  });

  it("ignora las reservas sin mesa asignada", () => {
    const map = planReservationsByTable(
      [reserva({ id: "r1", hora: "12:15", table_id: null })],
      MEDIODIA,
    );
    expect(map).toEqual({});
  });

  it("el borde de la ventana es exacto", () => {
    // Reserva justo a 3 h del mediodía.
    const enElBorde = [
      reserva({
        id: "r1",
        hora: "15:00",
      }),
    ];
    expect(VENTANA_RESERVA_EN_PLANO_MS).toBe(3 * 60 * 60 * 1000);
    // 12:00 → falta exactamente la ventana: ya se ve.
    expect(planReservationsByTable(enElBorde, MEDIODIA).t1?.id).toBe("r1");
    // Un segundo antes, todavía no.
    expect(planReservationsByTable(enElBorde, MEDIODIA - 1000).t1).toBeUndefined();
  });
});
