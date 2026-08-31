import { describe, expect, it } from "vitest";

import type { ReservationStatus } from "@/lib/reservations/types";

import { cuentaEnElDia, proximaReserva, reservationDayStats } from "./day-stats";

function fila(
  status: ReservationStatus,
  party_size: number,
  starts_at = "2026-08-06T23:00:00Z",
) {
  return { status, party_size, starts_at };
}

describe("cuentaEnElDia", () => {
  it("deja fuera canceladas y no-shows", () => {
    expect(cuentaEnElDia("cancelled")).toBe(false);
    expect(cuentaEnElDia("no_show")).toBe(false);
  });

  it("cuenta confirmadas, sentadas y completadas", () => {
    expect(cuentaEnElDia("confirmed")).toBe(true);
    expect(cuentaEnElDia("seated")).toBe(true);
    expect(cuentaEnElDia("completed")).toBe(true);
  });
});

describe("reservationDayStats", () => {
  it("total y guests hablan del mismo conjunto (#156)", () => {
    // El caso real de golf-jcr del 06/08: 7 vivas, 4 canceladas, 1 no-show.
    const rows = [
      fila("confirmed", 8),
      fila("confirmed", 5),
      fila("confirmed", 6),
      fila("confirmed", 6),
      fila("confirmed", 8),
      fila("confirmed", 12),
      fila("confirmed", 6),
      fila("cancelled", 4),
      fila("cancelled", 4),
      fila("cancelled", 3),
      fila("cancelled", 4),
      fila("no_show", 4),
    ];
    const stats = reservationDayStats(rows);
    expect(stats.total).toBe(7); // antes: 12
    expect(stats.guests).toBe(51);
    expect(stats.cancelled).toBe(4);
    expect(stats.noShow).toBe(1);
  });

  it("la completada cuenta en total y en cubiertos", () => {
    const stats = reservationDayStats([fila("completed", 4), fila("confirmed", 2)]);
    expect(stats.total).toBe(2);
    expect(stats.guests).toBe(6);
    expect(stats.completed).toBe(1);
  });

  it("un día entero cancelado da 0 reservas y 0 cubiertos", () => {
    const stats = reservationDayStats([fila("cancelled", 6), fila("no_show", 4)]);
    expect(stats.total).toBe(0);
    expect(stats.guests).toBe(0);
    // Pero siguen contadas aparte para los chips.
    expect(stats.cancelled).toBe(1);
    expect(stats.noShow).toBe(1);
  });

  // Spec 131 — la solicitud ya tomó el lugar: para el día es tan real como una
  // confirmada. La rechazada y la vencida, en cambio, liberaron el lugar.
  it("la pendiente cuenta en el día; la rechazada y la vencida no", () => {
    const stats = reservationDayStats([
      fila("pending", 4),
      fila("confirmed", 2),
      fila("rejected", 8),
      fila("expired", 6),
    ]);
    expect(stats.total).toBe(2);
    expect(stats.guests).toBe(6);
    expect(stats.pending).toBe(1);
  });

  it("sin filas, todo en cero", () => {
    expect(reservationDayStats([])).toEqual({
      total: 0,
      guests: 0,
      confirmed: 0,
      seated: 0,
      completed: 0,
      noShow: 0,
      cancelled: 0,
      pending: 0,
    });
  });
});

describe("proximaReserva", () => {
  const now = Date.parse("2026-08-06T22:00:00Z");

  it("es la confirmada más temprana que todavía no empezó", () => {
    const tarde = fila("confirmed", 4, "2026-08-07T00:00:00Z");
    const temprano = fila("confirmed", 4, "2026-08-06T23:00:00Z");
    expect(proximaReserva([tarde, temprano], now)).toBe(temprano);
  });

  it("ignora las que ya pasaron", () => {
    const pasada = fila("confirmed", 4, "2026-08-06T21:00:00Z");
    const futura = fila("confirmed", 4, "2026-08-06T23:00:00Z");
    expect(proximaReserva([pasada, futura], now)).toBe(futura);
  });

  it("ignora canceladas aunque sean las más próximas", () => {
    const cancelada = fila("cancelled", 4, "2026-08-06T22:30:00Z");
    const viva = fila("confirmed", 4, "2026-08-06T23:00:00Z");
    expect(proximaReserva([cancelada, viva], now)).toBe(viva);
  });

  it("sin nada por delante, undefined", () => {
    expect(proximaReserva([fila("confirmed", 4, "2026-08-06T21:00:00Z")], now)).toBeUndefined();
  });
});
