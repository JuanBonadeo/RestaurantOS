import { describe, expect, it } from "vitest";

import type { WeeklySchedule } from "@/lib/reservations/types";

import {
  DEFAULT_MARCH_LEAD_DELIVERY_MIN,
  DEFAULT_MARCH_LEAD_PICKUP_MIN,
  filterSlotsByLead,
  isScheduledForLater,
  marchLeadForOrder,
  scheduleSlotsForDay,
  shouldMarchNow,
  validateScheduledOrder,
} from "./scheduled";

// Reloj de referencia: jueves 2026-06-25 12:00 hora AR (UTC-3).
const NOW = new Date("2026-06-25T12:00:00-03:00");
const TZ = "America/Argentina/Buenos_Aires";

// Grilla de reservas del negocio: jueves (dow=4) almuerzo y cena; viernes
// (dow=5) solo cena. Es la MISMA grilla que ven los que reservan (spec 064).
const SCHEDULE: WeeklySchedule = {
  "4": { open: true, slots: ["12:30", "13:00", "20:00", "21:00", "13:00"] },
  "5": { open: true, slots: ["20:00", "21:00"] },
  "6": { open: false, slots: ["20:00"] },
};

function base() {
  return {
    deliveryType: "pickup" as const,
    schedule: SCHEDULE,
    timezone: TZ,
    now: NOW,
  };
}

describe("validateScheduledOrder", () => {
  it("acepta un horario de hoy que está en la grilla y cumple la anticipación", () => {
    // Jueves 20:00 AR: está en la grilla del dow=4 y falta más de 1 h.
    const scheduledAt = new Date("2026-06-25T20:00:00-03:00");
    expect(validateScheduledOrder({ ...base(), scheduledAt })).toEqual({
      ok: true,
    });
  });

  it("acepta delivery (programar dejó de ser sólo retiro — spec 061)", () => {
    const scheduledAt = new Date("2026-06-25T20:00:00-03:00");
    expect(
      validateScheduledOrder({
        ...base(),
        deliveryType: "delivery",
        scheduledAt,
      }),
    ).toEqual({ ok: true });
  });

  it("rechaza dine_in con su propio mensaje", () => {
    const scheduledAt = new Date("2026-06-25T20:00:00-03:00");
    expect(
      validateScheduledOrder({
        ...base(),
        deliveryType: "dine_in",
        scheduledAt,
      }),
    ).toEqual({ ok: false, error: "Los pedidos en mesa no se programan." });
  });

  // ── Spec 064 — solo hoy ───────────────────────────────────────────────────

  it("rechaza programar para mañana, aunque el horario esté en la grilla", () => {
    // Viernes 20:00: la grilla del dow=5 lo tiene, pero ya no es hoy.
    const scheduledAt = new Date("2026-06-26T20:00:00-03:00");
    expect(validateScheduledOrder({ ...base(), scheduledAt })).toEqual({
      ok: false,
      error: "Los pedidos programados son solo para hoy.",
    });
  });

  it("rechaza un instante pasado (ayer) con el mismo mensaje de 'solo hoy'", () => {
    const scheduledAt = new Date("2026-06-24T20:00:00-03:00");
    expect(validateScheduledOrder({ ...base(), scheduledAt }).ok).toBe(false);
  });

  it("el día se compara en el TZ del local, no en UTC", () => {
    // 2026-06-25T23:00-03:00 = 2026-06-26T02:00Z. En UTC es otro día; en AR es
    // hoy. Rechaza por no estar en la grilla, NO por "solo para hoy".
    const scheduledAt = new Date("2026-06-25T23:00:00-03:00");
    expect(validateScheduledOrder({ ...base(), scheduledAt })).toEqual({
      ok: false,
      error: "Elegí uno de los horarios disponibles del local.",
    });
  });

  // ── Spec 064 — solo horarios de la grilla ─────────────────────────────────

  it("rechaza una hora que no está en la grilla", () => {
    // Hoy 20:15: dentro del servicio, pero no es un chip.
    const scheduledAt = new Date("2026-06-25T20:15:00-03:00");
    expect(validateScheduledOrder({ ...base(), scheduledAt })).toEqual({
      ok: false,
      error: "Elegí uno de los horarios disponibles del local.",
    });
  });

  it("rechaza todo si el negocio no tiene grilla cargada", () => {
    const scheduledAt = new Date("2026-06-25T20:00:00-03:00");
    expect(
      validateScheduledOrder({ ...base(), schedule: {}, scheduledAt }).ok,
    ).toBe(false);
    expect(
      validateScheduledOrder({ ...base(), schedule: null, scheduledAt }).ok,
    ).toBe(false);
  });

  it("rechaza menos que la anticipación mínima aunque el horario esté en la grilla", () => {
    // Hoy 12:30 está en la grilla, pero faltan 30 min (< 60).
    const scheduledAt = new Date("2026-06-25T12:30:00-03:00");
    const res = validateScheduledOrder({ ...base(), scheduledAt });
    expect(res.ok).toBe(false);
    expect(res).toMatchObject({
      error: expect.stringContaining("anticipación"),
    });
  });
});

describe("scheduleSlotsForDay", () => {
  it("devuelve los slots del día, ordenados y sin repetidos", () => {
    expect(scheduleSlotsForDay(SCHEDULE, NOW, TZ)).toEqual([
      "12:30",
      "13:00",
      "20:00",
      "21:00",
    ]);
  });

  it("un día cerrado no ofrece nada, aunque tenga slots cargados", () => {
    // Sábado 2026-06-27 → dow=6, open: false.
    const sat = new Date("2026-06-27T12:00:00-03:00");
    expect(scheduleSlotsForDay(SCHEDULE, sat, TZ)).toEqual([]);
  });

  it("sin grilla devuelve vacío", () => {
    expect(scheduleSlotsForDay(null, NOW, TZ)).toEqual([]);
    expect(scheduleSlotsForDay({}, NOW, TZ)).toEqual([]);
  });
});

describe("filterSlotsByLead", () => {
  it("descarta los horarios que ya no cumplen la anticipación mínima", () => {
    // NOW = 12:00 → el corte es 13:00. 12:30 se cae, 13:00 entra (>=).
    expect(
      filterSlotsByLead(["12:30", "13:00", "20:00"], TZ, NOW),
    ).toEqual(["13:00", "20:00"]);
  });

  it("respeta un lead custom", () => {
    expect(filterSlotsByLead(["12:30", "13:00"], TZ, NOW, 15)).toEqual([
      "12:30",
      "13:00",
    ]);
  });
});

describe("isScheduledForLater", () => {
  const now = new Date("2026-06-25T12:00:00-03:00");

  it("es false sin scheduled_at (pedido para ahora)", () => {
    expect(isScheduledForLater(null, now)).toBe(false);
    expect(isScheduledForLater(undefined, now)).toBe(false);
  });

  it("es true si el instante es futuro", () => {
    expect(isScheduledForLater("2026-06-25T20:00:00-03:00", now)).toBe(true);
  });

  it("es false si el instante ya pasó", () => {
    expect(isScheduledForLater("2026-06-24T13:00:00-03:00", now)).toBe(false);
  });

  it("acepta tanto Date como string ISO", () => {
    expect(
      isScheduledForLater(new Date("2026-06-25T20:00:00-03:00"), now),
    ).toBe(true);
  });
});

describe("shouldMarchNow", () => {
  const scheduledAt = new Date("2026-06-26T13:00:00-03:00");

  it("no marcha mientras falte más que el lead", () => {
    // Falta 41 min (> 40): todavía no.
    const now = new Date("2026-06-26T12:19:00-03:00");
    expect(shouldMarchNow(scheduledAt, now)).toBe(false);
  });

  it("marcha cuando falta exactamente el lead", () => {
    const now = new Date("2026-06-26T12:20:00-03:00");
    expect(shouldMarchNow(scheduledAt, now)).toBe(true);
  });

  it("marcha si ya pasó la hora", () => {
    const now = new Date("2026-06-26T13:30:00-03:00");
    expect(shouldMarchNow(scheduledAt, now)).toBe(true);
  });

  it("respeta un lead custom", () => {
    const now = new Date("2026-06-26T12:30:00-03:00");
    expect(shouldMarchNow(scheduledAt, now, DEFAULT_MARCH_LEAD_PICKUP_MIN)).toBe(
      true,
    );
    expect(shouldMarchNow(scheduledAt, now, 20)).toBe(false);
  });
});

describe("marchLeadForOrder", () => {
  it("usa el lead de delivery para un delivery y el de retiro para un pickup", () => {
    const business = {
      scheduled_march_lead_pickup_min: 30,
      scheduled_march_lead_delivery_min: 90,
    };
    expect(marchLeadForOrder("delivery", business)).toBe(90);
    expect(marchLeadForOrder("pickup", business)).toBe(30);
  });

  it("cae a los defaults si la fila del negocio no trae el valor", () => {
    expect(marchLeadForOrder("delivery", null)).toBe(
      DEFAULT_MARCH_LEAD_DELIVERY_MIN,
    );
    expect(marchLeadForOrder("pickup", null)).toBe(
      DEFAULT_MARCH_LEAD_PICKUP_MIN,
    );
    expect(
      marchLeadForOrder("delivery", {
        scheduled_march_lead_pickup_min: 30,
        scheduled_march_lead_delivery_min: null,
      }),
    ).toBe(DEFAULT_MARCH_LEAD_DELIVERY_MIN);
  });

  it("un lead de 0 se respeta (no lo pisa el default)", () => {
    expect(
      marchLeadForOrder("delivery", {
        scheduled_march_lead_pickup_min: 0,
        scheduled_march_lead_delivery_min: 0,
      }),
    ).toBe(0);
  });
});
