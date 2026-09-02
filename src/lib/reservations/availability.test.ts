import { describe, expect, it } from "vitest";

import { availabilityLookupWindow, computeAvailableSlots } from "./availability";
import type { FloorTable, Reservation, WeeklySchedule } from "./types";

const TZ = "America/Argentina/Buenos_Aires";

describe("availabilityLookupWindow", () => {
  it("AR (UTC-3): cubre el día local completo, anclado en la TZ y no en UTC", () => {
    // 2026-06-20 00:00 local AR == 2026-06-20T03:00:00Z.
    const { fromIso, toIso } = availabilityLookupWindow("2026-06-20", TZ);
    expect(fromIso).toBe("2026-06-19T03:00:00.000Z");
    expect(toIso).toBe("2026-06-22T03:00:00.000Z");

    // El inicio y el fin del día local quedan DENTRO de la ventana.
    const localDayStart = new Date("2026-06-20T03:00:00.000Z").getTime();
    const localDayEnd = new Date("2026-06-21T03:00:00.000Z").getTime();
    expect(new Date(fromIso).getTime()).toBeLessThan(localDayStart);
    expect(new Date(toIso).getTime()).toBeGreaterThan(localDayEnd);
  });

  it("offset positivo (UTC+13): el inicio del día local NO se pierde (regresión del bug UTC fijo)", () => {
    const TZ_POS = "Pacific/Auckland";
    const { fromIso, toIso } = availabilityLookupWindow("2026-06-20", TZ_POS);
    // 2026-06-20 00:00 en Auckland es 2026-06-19T12:00:00Z (invierno NZ, UTC+12).
    const localDayStart = new Date("2026-06-19T12:00:00.000Z").getTime();
    // El viejo cálculo (`${date}T00:00:00Z`) arrancaba a las 2026-06-20T00:00Z,
    // 12h DESPUÉS del inicio del día local → perdía reservas de la mañana.
    expect(new Date(fromIso).getTime()).toBeLessThanOrEqual(localDayStart);
    expect(new Date(toIso).getTime()).toBeGreaterThan(localDayStart);
  });
});

const baseSettings = {
  slot_duration_min: 90,
  buffer_min: 15,
  lead_time_min: 60,
  advance_days_max: 30,
  max_party_size: 12,
};

function makeTable(over: Partial<FloorTable> & { id: string; seats: number }): FloorTable {
  return {
    id: over.id,
    floor_plan_id: over.floor_plan_id ?? "fp",
    label: over.label ?? `Mesa ${over.id}`,
    seats: over.seats,
    shape: over.shape ?? "circle",
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    rotation: 0,
    status: over.status ?? "active",
    created_at: "2026-01-01T00:00:00Z",
  };
}

const SCHEDULE_OPEN_TUE: WeeklySchedule = {
  // 2026-04-21 is a Tuesday → dow = 2
  "2": { open: true, slots: ["12:00", "13:30", "20:30", "22:00"] },
};

const SCHEDULE_CLOSED_TUE: WeeklySchedule = {
  "2": { open: false, slots: [] },
};

describe("computeAvailableSlots", () => {
  it("returns no slots when the day is closed", () => {
    const slots = computeAvailableSlots({
      date: "2026-04-21",
      partySize: 2,
      settings: { ...baseSettings, schedule: SCHEDULE_CLOSED_TUE },
      tables: [makeTable({ id: "t1", seats: 4 })],
      reservations: [],
      timezone: TZ,
      now: new Date("2026-04-21T12:00:00Z"), // 09:00 ART
    });
    expect(slots).toEqual([]);
  });

  it("excludes slots inside the lead-time window", () => {
    const slots = computeAvailableSlots({
      date: "2026-04-21",
      partySize: 2,
      settings: { ...baseSettings, schedule: SCHEDULE_OPEN_TUE, lead_time_min: 60 },
      tables: [makeTable({ id: "t1", seats: 4 })],
      reservations: [],
      timezone: TZ,
      // 11:30 ART → 14:30 UTC. With lead_time=60min, 12:00 ART (15:00 UTC)
      // is too soon; 13:30 ART and later are fine.
      now: new Date("2026-04-21T14:30:00Z"),
    });
    expect(slots.map((s) => s.slot)).toEqual(["13:30", "20:30", "22:00"]);
  });

  it("excludes slots when the only large-enough table is busy", () => {
    const tables = [
      makeTable({ id: "t1", seats: 2 }),
      makeTable({ id: "t2", seats: 6 }),
    ];
    // t2 is occupied from 12:00 to 13:30 ART.
    const reservations: Reservation[] = [
      {
        id: "r1",
        business_id: "b1",
        table_id: "t2",
        user_id: null,
        customer_name: "X",
        customer_phone: "0",
        party_size: 5,
        starts_at: "2026-04-21T15:00:00Z", // 12:00 ART
        ends_at: "2026-04-21T16:30:00Z", // 13:30 ART
        status: "confirmed",
        notes: null,
        source: "web",
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-01-01T00:00:00Z",
      },
    ];
    const slots = computeAvailableSlots({
      date: "2026-04-21",
      partySize: 5,
      settings: { ...baseSettings, schedule: SCHEDULE_OPEN_TUE },
      tables,
      reservations,
      timezone: TZ,
      now: new Date("2026-04-21T03:00:00Z"), // 00:00 ART (early morning)
    });
    // 12:00 conflicts; 13:30 + duration overlaps the 90min reservation
    // ending 13:30 once buffer applied — so it's blocked too.
    expect(slots.map((s) => s.slot)).toEqual(["20:30", "22:00"]);
  });

  it("excludes slots when no table fits the party", () => {
    const slots = computeAvailableSlots({
      date: "2026-04-21",
      partySize: 8,
      settings: { ...baseSettings, schedule: SCHEDULE_OPEN_TUE },
      tables: [
        makeTable({ id: "t1", seats: 2 }),
        makeTable({ id: "t2", seats: 4 }),
      ],
      reservations: [],
      timezone: TZ,
      now: new Date("2026-04-21T03:00:00Z"),
    });
    expect(slots).toEqual([]);
  });

  it("ignores disabled tables", () => {
    const slots = computeAvailableSlots({
      date: "2026-04-21",
      partySize: 4,
      settings: { ...baseSettings, schedule: SCHEDULE_OPEN_TUE },
      tables: [
        makeTable({ id: "t1", seats: 6, status: "disabled" }),
      ],
      reservations: [],
      timezone: TZ,
      now: new Date("2026-04-21T03:00:00Z"),
    });
    expect(slots).toEqual([]);
  });

  it("rejects party_size beyond max_party_size", () => {
    const slots = computeAvailableSlots({
      date: "2026-04-21",
      partySize: 50,
      settings: { ...baseSettings, schedule: SCHEDULE_OPEN_TUE, max_party_size: 12 },
      tables: [makeTable({ id: "t1", seats: 80 })],
      reservations: [],
      timezone: TZ,
      now: new Date("2026-04-21T03:00:00Z"),
    });
    expect(slots).toEqual([]);
  });

  it("rejects dates beyond advance_days_max", () => {
    const slots = computeAvailableSlots({
      date: "2026-06-30",
      partySize: 2,
      settings: { ...baseSettings, schedule: { "2": { open: true, slots: ["20:00"] } }, advance_days_max: 30 },
      tables: [makeTable({ id: "t1", seats: 4 })],
      reservations: [],
      timezone: TZ,
      now: new Date("2026-04-21T03:00:00Z"),
    });
    expect(slots).toEqual([]);
  });

  it("only considers the tables it is given (multi-salón filtering)", () => {
    // En el flujo real, getBusinessTables(businessId, { floorPlanId })
    // entrega solo las mesas del salón elegido. Acá simulamos los dos casos:
    // si llamamos con las mesas del salón A (solo t1 chica), no hay slot para 6;
    // si llamamos con las del salón B (t2 grande), todos los slots aparecen.
    const tablesSalonA = [
      makeTable({ id: "t1", seats: 2, floor_plan_id: "salon-a" }),
    ];
    const tablesSalonB = [
      makeTable({ id: "t2", seats: 8, floor_plan_id: "salon-b" }),
    ];

    const slotsA = computeAvailableSlots({
      date: "2026-04-21",
      partySize: 6,
      settings: { ...baseSettings, schedule: SCHEDULE_OPEN_TUE },
      tables: tablesSalonA,
      reservations: [],
      timezone: TZ,
      now: new Date("2026-04-21T03:00:00Z"),
    });
    expect(slotsA).toEqual([]);

    const slotsB = computeAvailableSlots({
      date: "2026-04-21",
      partySize: 6,
      settings: { ...baseSettings, schedule: SCHEDULE_OPEN_TUE },
      tables: tablesSalonB,
      reservations: [],
      timezone: TZ,
      now: new Date("2026-04-21T03:00:00Z"),
    });
    expect(slotsB.map((s) => s.slot)).toEqual([
      "12:00",
      "13:30",
      "20:30",
      "22:00",
    ]);
  });

  // Spec 131 — la solicitud pendiente TOMA EL LUGAR: mientras espera al
  // encargado nadie más puede quedarse con esa mesa.
  it("una reserva pendiente ocupa la mesa igual que una confirmada", () => {
    const reservations: Reservation[] = [
      {
        id: "r1",
        business_id: "b1",
        table_id: "t1",
        user_id: null,
        customer_name: "X",
        customer_phone: "0",
        party_size: 2,
        starts_at: "2026-04-21T15:00:00Z", // 12:00 ART
        ends_at: "2026-04-21T16:30:00Z", // 13:30 ART
        status: "pending",
        notes: null,
        source: "web",
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-01-01T00:00:00Z",
      },
    ];
    const slots = computeAvailableSlots({
      date: "2026-04-21",
      partySize: 2,
      settings: { ...baseSettings, schedule: SCHEDULE_OPEN_TUE },
      tables: [makeTable({ id: "t1", seats: 4 })],
      reservations,
      timezone: TZ,
      now: new Date("2026-04-21T03:00:00Z"),
    });
    expect(slots.map((s) => s.slot)).not.toContain("12:00");
  });

  // …y una rechazada o vencida lo libera.
  it("una reserva rechazada o vencida no ocupa nada", () => {
    for (const status of ["rejected", "expired"] as const) {
      const reservations: Reservation[] = [
        {
          id: "r1",
          business_id: "b1",
          table_id: "t1",
          user_id: null,
          customer_name: "X",
          customer_phone: "0",
          party_size: 2,
          starts_at: "2026-04-21T15:00:00Z",
          ends_at: "2026-04-21T16:30:00Z",
          status,
          notes: null,
          source: "web",
          created_at: "2026-01-01T00:00:00Z",
          updated_at: "2026-01-01T00:00:00Z",
        },
      ];
      const slots = computeAvailableSlots({
        date: "2026-04-21",
        partySize: 2,
        settings: { ...baseSettings, schedule: SCHEDULE_OPEN_TUE },
        tables: [makeTable({ id: "t1", seats: 4 })],
        reservations,
        timezone: TZ,
        now: new Date("2026-04-21T03:00:00Z"),
      });
      expect(slots.map((s) => s.slot)).toContain("12:00");
    }
  });

  it("ignores cancelled / completed reservations", () => {
    const reservations: Reservation[] = [
      {
        id: "r1",
        business_id: "b1",
        table_id: "t1",
        user_id: null,
        customer_name: "X",
        customer_phone: "0",
        party_size: 2,
        starts_at: "2026-04-21T15:00:00Z",
        ends_at: "2026-04-21T16:30:00Z",
        status: "cancelled",
        notes: null,
        source: "web",
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-01-01T00:00:00Z",
      },
    ];
    const slots = computeAvailableSlots({
      date: "2026-04-21",
      partySize: 2,
      settings: { ...baseSettings, schedule: SCHEDULE_OPEN_TUE },
      tables: [makeTable({ id: "t1", seats: 4 })],
      reservations,
      timezone: TZ,
      now: new Date("2026-04-21T03:00:00Z"),
    });
    expect(slots.map((s) => s.slot)).toEqual([
      "12:00",
      "13:30",
      "20:30",
      "22:00",
    ]);
  });
});

/**
 * Spec 144 — el picker de mesa del formulario de reserva pinta el plano con
 * esto. Antes mostraba el `operational_status` (el estado del AHORA), que para
 * una reserva de mañana no significa nada.
 */
describe("computeAvailableSlots · mesas libres por slot (spec 144)", () => {
  const reservaEn = (tableId: string): Reservation => ({
    id: `r-${tableId}`,
    business_id: "b1",
    table_id: tableId,
    user_id: null,
    customer_name: "X",
    customer_phone: "0",
    party_size: 2,
    starts_at: "2026-04-21T15:00:00Z", // 12:00 ART
    ends_at: "2026-04-21T16:30:00Z", // 13:30 ART
    status: "confirmed",
    notes: null,
    source: "web",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  });

  it("cada slot dice qué mesas quedan libres en ÉL, no ahora", () => {
    const slots = computeAvailableSlots({
      date: "2026-04-21",
      partySize: 2,
      settings: { ...baseSettings, schedule: SCHEDULE_OPEN_TUE },
      tables: [makeTable({ id: "t1", seats: 4 }), makeTable({ id: "t2", seats: 4 })],
      reservations: [reservaEn("t1")],
      timezone: TZ,
      now: new Date("2026-04-21T03:00:00Z"),
    });

    const porSlot = Object.fromEntries(slots.map((s) => [s.slot, s.freeTableIds]));
    // A las 12:00 t1 está tomada; a la noche vuelve a estar libre.
    expect(porSlot["12:00"]).toEqual(["t2"]);
    expect(porSlot["20:30"]).toEqual(["t1", "t2"]);
  });

  it("no lista las mesas donde no entra el grupo ni las deshabilitadas", () => {
    const slots = computeAvailableSlots({
      date: "2026-04-21",
      partySize: 4,
      settings: { ...baseSettings, schedule: SCHEDULE_OPEN_TUE },
      tables: [
        makeTable({ id: "chica", seats: 2 }),
        makeTable({ id: "rota", seats: 8, status: "disabled" }),
        makeTable({ id: "ok", seats: 6 }),
      ],
      reservations: [],
      timezone: TZ,
      now: new Date("2026-04-21T03:00:00Z"),
    });

    expect(slots.every((s) => s.freeTableIds.join() === "ok")).toBe(true);
  });
});
