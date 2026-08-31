import { describe, expect, it } from "vitest";

import {
  DEFAULT_APPROVAL_EXPIRY_MIN,
  isPendingExpired,
  MIN_PENDING_WINDOW_MIN,
  pendingExpiresAt,
} from "./pending-expiry";

const NOW = new Date("2026-06-15T22:00:00Z");

/** Reserva pendiente creada hace `agoMin` minutos para dentro de `inMin`. */
function pending(inMin: number, agoMin: number) {
  return {
    status: "pending" as const,
    starts_at: new Date(NOW.getTime() + inMin * 60_000).toISOString(),
    created_at: new Date(NOW.getTime() - agoMin * 60_000).toISOString(),
  };
}

describe("pendingExpiresAt", () => {
  it("vence `expiryMin` antes del turno", () => {
    // turno 23:00Z, expiry 120 → 21:00Z. Creada hace rato, el piso no manda.
    const r = pending(60, 600);
    expect(pendingExpiresAt(r, 120).toISOString()).toBe("2026-06-15T21:00:00.000Z");
  });

  it("el piso manda cuando la reserva es para dentro de poco", () => {
    // creada recién (22:00Z) para las 22:30Z: 120 min antes del turno ya pasó,
    // así que vence a los 15 min de creada.
    const r = pending(30, 0);
    expect(pendingExpiresAt(r, 120).toISOString()).toBe(
      new Date(NOW.getTime() + MIN_PENDING_WINDOW_MIN * 60_000).toISOString(),
    );
  });

  it("default de expiry = 120 min", () => {
    const r = pending(600, 600);
    expect(pendingExpiresAt(r).getTime()).toBe(
      pendingExpiresAt(r, DEFAULT_APPROVAL_EXPIRY_MIN).getTime(),
    );
  });
});

describe("isPendingExpired", () => {
  it("pendiente con el turno encima → true", () => {
    // turno dentro de 30 min, creada hace 3 h: venció hace rato.
    expect(isPendingExpired(pending(30, 180), 120, NOW)).toBe(true);
  });

  it("pendiente con margen de sobra → false", () => {
    expect(isPendingExpired(pending(600, 60), 120, NOW)).toBe(false);
  });

  it("recién creada para dentro de una hora → false (piso de 15 min)", () => {
    // Escenario 6 de la spec: sin el piso, moriría sin que nadie la vea.
    expect(isPendingExpired(pending(60, 5), 120, NOW)).toBe(false);
  });

  it("recién creada, pasado el piso → true", () => {
    expect(isPendingExpired(pending(60, 16), 120, NOW)).toBe(true);
  });

  it("borde exacto del vencimiento → true", () => {
    // turno 00:00Z del 16 con expiry 120 → vence 22:00Z == now.
    expect(isPendingExpired(pending(120, 300), 120, NOW)).toBe(true);
  });

  it("cualquier estado que no sea pending → false", () => {
    const vencida = pending(30, 180);
    for (const status of ["confirmed", "seated", "cancelled", "rejected", "expired"] as const) {
      expect(isPendingExpired({ ...vencida, status }, 120, NOW)).toBe(false);
    }
  });
});
