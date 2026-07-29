import { describe, expect, it } from "vitest";

import type { BusinessHourSlot } from "@/lib/business-hours/schema";

import {
  DEFAULT_MARCH_LEAD_DELIVERY_MIN,
  DEFAULT_MARCH_LEAD_PICKUP_MIN,
  isScheduledForLater,
  marchLeadForOrder,
  SCHEDULED_MAX_WINDOW_DAYS,
  shouldMarchNow,
  validateScheduledOrder,
} from "./scheduled";

// Reloj de referencia: jueves 2026-06-25 12:00 hora AR (UTC-3).
const NOW = new Date("2026-06-25T12:00:00-03:00");
const TZ = "America/Argentina/Buenos_Aires";
// El local abre los viernes (dow=5) de 12:00 a 16:00.
const HOURS: BusinessHourSlot[] = [
  { day_of_week: 5, opens_at: "12:00", closes_at: "16:00" },
];

function base() {
  return {
    deliveryType: "pickup" as const,
    businessHours: HOURS,
    timezone: TZ,
    now: NOW,
  };
}

describe("validateScheduledOrder", () => {
  it("acepta un diferido válido (dentro de horario y ventana)", () => {
    // Viernes 13:00 AR → dow=5, dentro de 12–16.
    const scheduledAt = new Date("2026-06-26T13:00:00-03:00");
    expect(validateScheduledOrder({ ...base(), scheduledAt })).toEqual({
      ok: true,
    });
  });

  // ── Spec 061: delivery también, y sin exigir prepago ──────────────────────

  it("acepta delivery (programar dejó de ser sólo retiro)", () => {
    const scheduledAt = new Date("2026-06-26T13:00:00-03:00");
    expect(
      validateScheduledOrder({
        ...base(),
        deliveryType: "delivery",
        scheduledAt,
      }),
    ).toEqual({ ok: true });
  });

  it("el método de pago ya no es asunto del validador (ni retiro ni delivery)", () => {
    // Antes, un programado exigía MP adelantado. El resguardo pasó a ser que el
    // encargado acepte los impagos antes de que entren a cocina (spec 047), así
    // que acá no hay nada que chequear.
    const scheduledAt = new Date("2026-06-26T13:00:00-03:00");
    expect(validateScheduledOrder({ ...base(), scheduledAt })).toEqual({
      ok: true,
    });
    expect(
      validateScheduledOrder({
        ...base(),
        deliveryType: "delivery",
        scheduledAt,
      }),
    ).toEqual({ ok: true });
  });

  it("rechaza dine_in con su propio mensaje (no se cuela por el hueco que abre delivery)", () => {
    const scheduledAt = new Date("2026-06-26T13:00:00-03:00");
    const res = validateScheduledOrder({
      ...base(),
      deliveryType: "dine_in",
      scheduledAt,
    });
    expect(res).toEqual({
      ok: false,
      error: "Los pedidos en mesa no se programan.",
    });
  });

  it("las reglas de anticipación / ventana / horario también aplican a delivery", () => {
    const delivery = { ...base(), deliveryType: "delivery" as const };
    // Fuera de horario (viernes 18:00, el local cierra 16:00).
    expect(
      validateScheduledOrder({
        ...delivery,
        scheduledAt: new Date("2026-06-26T18:00:00-03:00"),
      }).ok,
    ).toBe(false);
    // Menos que la anticipación mínima.
    expect(
      validateScheduledOrder({
        ...delivery,
        scheduledAt: new Date(NOW.getTime() + 30 * 60_000),
      }).ok,
    ).toBe(false);
  });

  it("rechaza un horario fuera del horario de atención", () => {
    // Viernes 18:00 AR → hay franja ese día (12–16) pero 18:00 queda afuera.
    const scheduledAt = new Date("2026-06-26T18:00:00-03:00");
    const res = validateScheduledOrder({ ...base(), scheduledAt });
    expect(res.ok).toBe(false);
  });

  it("rechaza un día sin franja de atención", () => {
    // Jueves siguiente (dow=4): no hay slot configurado.
    const scheduledAt = new Date("2026-07-02T13:00:00-03:00");
    const res = validateScheduledOrder({ ...base(), scheduledAt });
    expect(res.ok).toBe(false);
  });

  it("rechaza menos que la anticipación mínima", () => {
    // 30 min después de NOW (< SCHEDULED_MIN_LEAD_MIN).
    const scheduledAt = new Date(NOW.getTime() + 30 * 60_000);
    const res = validateScheduledOrder({ ...base(), scheduledAt });
    expect(res.ok).toBe(false);
  });

  it("rechaza más allá de la ventana máxima", () => {
    const scheduledAt = new Date(
      NOW.getTime() + (SCHEDULED_MAX_WINDOW_DAYS + 1) * 24 * 60 * 60_000,
    );
    const res = validateScheduledOrder({ ...base(), scheduledAt });
    expect(res.ok).toBe(false);
  });
});

describe("isScheduledForLater", () => {
  const now = new Date("2026-06-25T12:00:00-03:00");

  it("es false sin scheduled_at (pedido para ahora)", () => {
    expect(isScheduledForLater(null, now)).toBe(false);
    expect(isScheduledForLater(undefined, now)).toBe(false);
  });

  it("es true si el instante es futuro", () => {
    expect(isScheduledForLater("2026-06-26T13:00:00-03:00", now)).toBe(true);
  });

  it("es false si el instante ya pasó", () => {
    expect(isScheduledForLater("2026-06-24T13:00:00-03:00", now)).toBe(false);
  });

  it("acepta tanto Date como string ISO", () => {
    expect(
      isScheduledForLater(new Date("2026-06-26T13:00:00-03:00"), now),
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
