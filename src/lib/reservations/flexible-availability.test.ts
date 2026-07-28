import { describe, expect, it } from "vitest";

import {
  arrivalSlots,
  computeFlexibleAvailability,
  flexibleServiceWindow,
  isTableFreeForService,
  reservedCovers,
  type ReservationForFlexible,
} from "./flexible-availability";
import type { FloorTable } from "./types";

const TZ = "America/Argentina/Buenos_Aires"; // UTC-3 todo el año

const CENA = { opens_at: "20:00", closes_at: "00:30", soft_capacity: null };
const MEDIODIA = { opens_at: "12:00", closes_at: "16:00", soft_capacity: null };
const DATE = "2026-08-04";

// Instantes UTC de referencia (AR = UTC-3):
const CENA_2100 = "2026-08-05T00:00:00.000Z"; // 21:00 AR → dentro de la cena
const MEDIODIA_1300 = "2026-08-04T16:00:00.000Z"; // 13:00 AR → mediodía, NO cena

function makeTable(over: Partial<FloorTable> & { id: string; seats: number }): FloorTable {
  return {
    id: over.id,
    floor_plan_id: over.floor_plan_id ?? "adentro",
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

function makeRes(over: Partial<ReservationForFlexible>): ReservationForFlexible {
  return {
    table_id: over.table_id ?? null,
    starts_at: over.starts_at ?? CENA_2100,
    party_size: over.party_size ?? 2,
    status: over.status ?? "confirmed",
    floor_plan_id: over.floor_plan_id ?? null,
  };
}

describe("flexibleServiceWindow", () => {
  it("servicio normal (mediodía 12–16, AR UTC-3)", () => {
    const w = flexibleServiceWindow(DATE, MEDIODIA, TZ);
    expect(w).not.toBeNull();
    expect(w!.starts.toISOString()).toBe("2026-08-04T15:00:00.000Z");
    expect(w!.ends.toISOString()).toBe("2026-08-04T19:00:00.000Z");
  });

  it("servicio que cruza medianoche (cena 20:00→00:30) cierra al día siguiente", () => {
    const w = flexibleServiceWindow(DATE, CENA, TZ);
    expect(w!.starts.toISOString()).toBe("2026-08-04T23:00:00.000Z");
    expect(w!.ends.toISOString()).toBe("2026-08-05T03:30:00.000Z");
    expect(w!.ends.getTime()).toBeGreaterThan(w!.starts.getTime());
  });

  it("horas inválidas → null", () => {
    expect(flexibleServiceWindow(DATE, { opens_at: "25:00", closes_at: "26:00" }, TZ)).toBeNull();
  });
});

describe("arrivalSlots", () => {
  it("genera horarios cada 15 min hasta el cierre (excluido)", () => {
    const s = arrivalSlots("12:00", "16:00");
    expect(s[0]).toBe("12:00");
    expect(s[s.length - 1]).toBe("15:45");
    expect(s).toHaveLength(16);
    expect(s).not.toContain("16:00");
  });

  it("cruza medianoche (cena 20:00→00:30)", () => {
    const s = arrivalSlots("20:00", "00:30");
    expect(s[0]).toBe("20:00");
    expect(s).toContain("23:45");
    expect(s).toContain("00:00");
    expect(s).toContain("00:15");
    expect(s).not.toContain("00:30");
    expect(s).toHaveLength(18);
  });

  it("acepta formato HH:MM:SS de la DB y rechaza inválidos", () => {
    expect(arrivalSlots("12:00:00", "13:00:00")).toEqual(["12:00", "12:15", "12:30", "12:45"]);
    expect(arrivalSlots("99:99", "10:00")).toEqual([]);
  });
});

describe("isTableFreeForService", () => {
  const w = flexibleServiceWindow(DATE, CENA, TZ)!;

  it("sin reservas → libre", () => {
    expect(isTableFreeForService([], "T1", w)).toBe(true);
  });

  it("una reserva viva de ese servicio sobre la mesa → ocupada (mata el desalojo)", () => {
    const res = [makeRes({ table_id: "T1", starts_at: CENA_2100 })];
    expect(isTableFreeForService(res, "T1", w)).toBe(false);
  });

  it("reserva cancelada NO ocupa", () => {
    const res = [makeRes({ table_id: "T1", starts_at: CENA_2100, status: "cancelled" })];
    expect(isTableFreeForService(res, "T1", w)).toBe(true);
  });

  it("reserva en OTRA mesa no afecta", () => {
    const res = [makeRes({ table_id: "T2", starts_at: CENA_2100 })];
    expect(isTableFreeForService(res, "T1", w)).toBe(true);
  });

  it("reserva de OTRO servicio (mediodía) no ocupa la mesa en la cena", () => {
    const res = [makeRes({ table_id: "T1", starts_at: MEDIODIA_1300 })];
    expect(isTableFreeForService(res, "T1", w)).toBe(true);
  });

  it("una-por-mesa/servicio: ocupa a cualquier hora del servicio, no sólo a la hora exacta", () => {
    // 20:15 AR (2026-08-04T23:15Z) sigue dentro de la cena.
    const res = [makeRes({ table_id: "T1", starts_at: "2026-08-04T23:15:00.000Z" })];
    expect(isTableFreeForService(res, "T1", w)).toBe(false);
  });
});

describe("reservedCovers", () => {
  const w = flexibleServiceWindow(DATE, CENA, TZ)!;

  it("suma party_size de las vivas en ventana", () => {
    const res = [
      makeRes({ starts_at: CENA_2100, party_size: 4 }),
      makeRes({ starts_at: CENA_2100, party_size: 2 }),
      makeRes({ starts_at: MEDIODIA_1300, party_size: 8 }), // otro servicio, no cuenta
    ];
    expect(reservedCovers(res, w)).toBe(6);
  });

  it("ignora canceladas / no-show", () => {
    const res = [
      makeRes({ starts_at: CENA_2100, party_size: 4, status: "cancelled" }),
      makeRes({ starts_at: CENA_2100, party_size: 3, status: "no_show" }),
      makeRes({ starts_at: CENA_2100, party_size: 5, status: "seated" }),
    ];
    expect(reservedCovers(res, w)).toBe(5);
  });

  it("filtra por zona cuando se pasa floorPlanId", () => {
    const res = [
      makeRes({ starts_at: CENA_2100, party_size: 4, floor_plan_id: "adentro" }),
      makeRes({ starts_at: CENA_2100, party_size: 6, floor_plan_id: "afuera" }),
    ];
    expect(reservedCovers(res, w, "adentro")).toBe(4);
    expect(reservedCovers(res, w, "afuera")).toBe(6);
    expect(reservedCovers(res, w)).toBe(10);
  });
});

describe("computeFlexibleAvailability", () => {
  const tables = [
    makeTable({ id: "T1", seats: 4, floor_plan_id: "adentro" }),
    makeTable({ id: "T2", seats: 2, floor_plan_id: "adentro" }),
    makeTable({ id: "T3", seats: 6, floor_plan_id: "afuera" }),
  ];

  it("genérica siempre disponible (capacidad blanda) y lista las mesas libres del party", () => {
    const out = computeFlexibleAvailability({
      date: DATE,
      service: CENA,
      partySize: 4,
      tables,
      reservations: [],
      timezone: TZ,
    })!;
    expect(out.available).toBe(true);
    expect(out.warning).toBeUndefined();
    // T2 (2 asientos) queda afuera por chica; T1 y T3 entran.
    expect(out.freeTables.map((t) => t.id).sort()).toEqual(["T1", "T3"]);
  });

  it("genérica: avisa (no bloquea) al superar la capacidad blanda", () => {
    const out = computeFlexibleAvailability({
      date: DATE,
      service: { ...CENA, soft_capacity: 5 },
      partySize: 4,
      tables,
      reservations: [makeRes({ starts_at: CENA_2100, party_size: 3 })],
      timezone: TZ,
    })!;
    // 3 reservados + 4 nuevos = 7 > 5 → avisa, pero sigue disponible.
    expect(out.available).toBe(true);
    expect(out.overCapacity).toBe(true);
    expect(out.warning).toBe("sobre-capacidad");
  });

  it("mesa puntual libre → disponible", () => {
    const out = computeFlexibleAvailability({
      date: DATE,
      service: CENA,
      partySize: 4,
      tables,
      reservations: [],
      timezone: TZ,
      tableId: "T1",
    })!;
    expect(out.available).toBe(true);
    expect(out.reason).toBeUndefined();
  });

  it("mesa puntual ya reservada ese servicio → no disponible (mesa-ocupada)", () => {
    const out = computeFlexibleAvailability({
      date: DATE,
      service: CENA,
      partySize: 4,
      tables,
      reservations: [makeRes({ table_id: "T1", starts_at: CENA_2100 })],
      timezone: TZ,
      tableId: "T1",
    })!;
    expect(out.available).toBe(false);
    expect(out.reason).toBe("mesa-ocupada");
  });

  it("mesa puntual chica para el party → mesa-chica", () => {
    const out = computeFlexibleAvailability({
      date: DATE,
      service: CENA,
      partySize: 4,
      tables,
      reservations: [],
      timezone: TZ,
      tableId: "T2", // 2 asientos
    })!;
    expect(out.available).toBe(false);
    expect(out.reason).toBe("mesa-chica");
  });

  it("mesa puntual inexistente/deshabilitada → mesa-inexistente", () => {
    const out = computeFlexibleAvailability({
      date: DATE,
      service: CENA,
      partySize: 2,
      tables,
      reservations: [],
      timezone: TZ,
      tableId: "NOPE",
    })!;
    expect(out.available).toBe(false);
    expect(out.reason).toBe("mesa-inexistente");
  });

  it("filtra freeTables y cubiertos por zona (floorPlanId)", () => {
    const out = computeFlexibleAvailability({
      date: DATE,
      service: CENA,
      partySize: 2,
      tables,
      reservations: [makeRes({ starts_at: CENA_2100, party_size: 3, floor_plan_id: "afuera" })],
      timezone: TZ,
      floorPlanId: "adentro",
    })!;
    expect(out.freeTables.map((t) => t.id).sort()).toEqual(["T1", "T2"]);
    expect(out.reservedCovers).toBe(0); // el reservado está en 'afuera'
  });

  it("ventana inválida → null", () => {
    const out = computeFlexibleAvailability({
      date: DATE,
      service: { opens_at: "99:99", closes_at: "00:00", soft_capacity: null },
      partySize: 2,
      tables,
      reservations: [],
      timezone: TZ,
    });
    expect(out).toBeNull();
  });
});
