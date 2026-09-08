import { describe, expect, it } from "vitest";

import { isTableAvailableForReservation, pickTable, pickTableExcluding } from "./assign-table";
import type { FloorTable, Reservation } from "./types";

function makeTable(id: string, seats: number, status: "active" | "disabled" = "active"): FloorTable {
  return {
    id,
    floor_plan_id: "fp",
    label: `Mesa ${id}`,
    seats,
    shape: "circle",
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    rotation: 0,
    status,
    created_at: "2026-01-01T00:00:00Z",
  };
}

describe("pickTable", () => {
  const windowStart = new Date("2026-04-21T20:00:00Z");
  const windowEnd = new Date("2026-04-21T22:00:00Z");

  it("returns the smallest fitting table when free", () => {
    const tables = [makeTable("a", 8), makeTable("b", 4), makeTable("c", 2)];
    const result = pickTable({
      tables,
      reservations: [],
      partySize: 3,
      windowStart,
      windowEnd,
    });
    expect(result?.id).toBe("b");
  });

  it("skips disabled tables", () => {
    const tables = [makeTable("a", 4, "disabled"), makeTable("b", 6)];
    const result = pickTable({
      tables,
      reservations: [],
      partySize: 3,
      windowStart,
      windowEnd,
    });
    expect(result?.id).toBe("b");
  });

  it("skips tables with overlapping live reservations", () => {
    const tables = [makeTable("a", 4), makeTable("b", 6)];
    const reservations: Reservation[] = [
      {
        id: "r1",
        business_id: "x",
        table_id: "a",
        user_id: null,
        customer_name: "Y",
        customer_phone: "0",
        party_size: 2,
        starts_at: "2026-04-21T19:00:00Z",
        ends_at: "2026-04-21T20:30:00Z",
        status: "confirmed",
        notes: null,
        source: "web",
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-01-01T00:00:00Z",
      },
    ];
    const result = pickTable({
      tables,
      reservations,
      partySize: 2,
      windowStart,
      windowEnd,
    });
    expect(result?.id).toBe("b");
  });

  it("returns null when no table fits", () => {
    const tables = [makeTable("a", 2)];
    const result = pickTable({
      tables,
      reservations: [],
      partySize: 5,
      windowStart,
      windowEnd,
    });
    expect(result).toBeNull();
  });

  it("ignores cancelled reservations on the table", () => {
    const tables = [makeTable("a", 4)];
    const reservations: Reservation[] = [
      {
        id: "r1",
        business_id: "x",
        table_id: "a",
        user_id: null,
        customer_name: "Y",
        customer_phone: "0",
        party_size: 2,
        starts_at: "2026-04-21T19:00:00Z",
        ends_at: "2026-04-21T22:00:00Z",
        status: "cancelled",
        notes: null,
        source: "web",
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-01-01T00:00:00Z",
      },
    ];
    const result = pickTable({
      tables,
      reservations,
      partySize: 2,
      windowStart,
      windowEnd,
    });
    expect(result?.id).toBe("a");
  });
});

describe("pickTableExcluding", () => {
  it("excludes specified ids and returns next-best fit", () => {
    const tables = [makeTable("a", 2), makeTable("b", 4), makeTable("c", 6)];
    const result = pickTableExcluding(
      {
        tables,
        reservations: [],
        partySize: 2,
        windowStart: new Date(),
        windowEnd: new Date(Date.now() + 60_000),
      },
      new Set(["a", "b"]),
    );
    expect(result?.id).toBe("c");
  });
});

describe("isTableAvailableForReservation", () => {
  const windowStart = new Date("2026-04-21T20:00:00Z");
  const windowEnd = new Date("2026-04-21T22:00:00Z");

  function makeReservation(
    overrides: Partial<Pick<Reservation, "table_id" | "starts_at" | "ends_at" | "status" | "id">>,
  ): Pick<Reservation, "table_id" | "starts_at" | "ends_at" | "status" | "id"> {
    return {
      id: "r-default",
      table_id: "a",
      starts_at: "2026-04-21T19:00:00Z",
      ends_at: "2026-04-21T20:30:00Z",
      status: "confirmed",
      ...overrides,
    };
  }

  it("returns true when the table has no reservations in the window", () => {
    const result = isTableAvailableForReservation({
      tableId: "a",
      reservations: [],
      windowStart,
      windowEnd,
      bufferMs: 0,
    });
    expect(result).toBe(true);
  });

  it("returns false when a live reservation overlaps the window", () => {
    const result = isTableAvailableForReservation({
      tableId: "a",
      reservations: [makeReservation({ table_id: "a", status: "confirmed" })],
      windowStart,
      windowEnd,
      bufferMs: 0,
    });
    expect(result).toBe(false);
  });

  it("returns false when overlap happens due to buffer", () => {
    // Reservation ends at 19:46 — no raw overlap with 20:00–22:00,
    // but with 15 min buffer (900_000ms) the effective end is 20:01 → overlaps.
    const result = isTableAvailableForReservation({
      tableId: "a",
      reservations: [
        makeReservation({
          table_id: "a",
          starts_at: "2026-04-21T18:00:00Z",
          ends_at: "2026-04-21T19:46:00Z",
          status: "confirmed",
        }),
      ],
      windowStart,
      windowEnd,
      bufferMs: 15 * 60_000,
    });
    expect(result).toBe(false);
  });

  it("ignores cancelled reservations on the table", () => {
    const result = isTableAvailableForReservation({
      tableId: "a",
      reservations: [makeReservation({ table_id: "a", status: "cancelled" })],
      windowStart,
      windowEnd,
      bufferMs: 0,
    });
    expect(result).toBe(true);
  });

  it("ignores no_show reservations on the table", () => {
    const result = isTableAvailableForReservation({
      tableId: "a",
      reservations: [makeReservation({ table_id: "a", status: "no_show" })],
      windowStart,
      windowEnd,
      bufferMs: 0,
    });
    expect(result).toBe(true);
  });

  it("ignores reservations on a different table", () => {
    const result = isTableAvailableForReservation({
      tableId: "a",
      reservations: [makeReservation({ table_id: "b", status: "confirmed" })],
      windowStart,
      windowEnd,
      bufferMs: 0,
    });
    expect(result).toBe(true);
  });

  it("excludes the reservation being moved (excludeReservationId)", () => {
    const result = isTableAvailableForReservation({
      tableId: "a",
      reservations: [
        makeReservation({
          id: "r-moving",
          table_id: "a",
          starts_at: "2026-04-21T20:00:00Z",
          ends_at: "2026-04-21T22:00:00Z",
          status: "confirmed",
        }),
      ],
      windowStart,
      windowEnd,
      bufferMs: 0,
      excludeReservationId: "r-moving",
    });
    expect(result).toBe(true);
  });
});

describe("el colchón va de los dos lados también al editar (issue #261)", () => {
  const reservas = [
    {
      id: "r1",
      table_id: "t1",
      status: "confirmed",
      starts_at: "2026-09-10T23:00:00.000Z", // 20:00 AR
      ends_at: "2026-09-11T00:30:00.000Z", // 21:30 AR
    },
  ];

  it("no deja pegar una reserva que termina justo cuando empieza la otra", () => {
    // 18:30–20:00 AR: termina exactamente cuando arranca la de las 20:00. Con
    // 15 min de colchón, la mesa no llega a rotar. El alta ya lo rebotaba;
    // editar lo tomaba.
    const libre = isTableAvailableForReservation({
      tableId: "t1",
      reservations: reservas as never,
      windowStart: new Date("2026-09-10T21:30:00.000Z"),
      windowEnd: new Date("2026-09-10T23:00:00.000Z"),
      bufferMs: 15 * 60_000,
    });
    expect(libre).toBe(false);
  });

  it("con el colchón cumplido, sí deja", () => {
    // 18:00–19:30 AR: quedan 30 min hasta la de las 20:00.
    const libre = isTableAvailableForReservation({
      tableId: "t1",
      reservations: reservas as never,
      windowStart: new Date("2026-09-10T21:00:00.000Z"),
      windowEnd: new Date("2026-09-10T22:30:00.000Z"),
      bufferMs: 15 * 60_000,
    });
    expect(libre).toBe(true);
  });
});
