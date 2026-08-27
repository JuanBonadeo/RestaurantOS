import { describe, expect, it } from "vitest";

import type { WeeklySchedule } from "@/lib/reservations/types";

import {
  DEFAULT_MARCH_LEAD_DELIVERY_MIN,
  DEFAULT_MARCH_LEAD_KITCHEN_MIN,
  DEFAULT_MARCH_LEAD_PICKUP_MIN,
  esperaSuHoraDeMarcha,
  filterSlotsByLead,
  isScheduledForLater,
  marchAtForOrder,
  marchLeadForOrder,
  operatingDay,
  orderSlotsForDay,
  shouldMarchNow,
  validateScheduledOrder,
} from "./scheduled";

// Reloj de referencia: jueves 2026-06-25 12:00 hora AR (UTC-3).
const NOW = new Date("2026-06-25T12:00:00-03:00");
const TZ = "America/Argentina/Buenos_Aires";

// Grilla del modo ESTRICTO: jueves (dow=4) almuerzo y cena; viernes (dow=5)
// solo cena; sábado cerrado. Es la MISMA grilla que ven los que reservan.
const SCHEDULE: WeeklySchedule = {
  "4": { open: true, slots: ["12:30", "13:00", "20:00", "21:00", "13:00"] },
  "5": { open: true, slots: ["20:00", "21:00"] },
  "6": { open: false, slots: ["20:00"] },
};

// Servicios del modo FLEXIBLE (spec 059) — el caso de golf-house. Los chips
// se derivan cada 15 min de la ventana del servicio, y el mismo servicio puede
// venir duplicado por salón.
const SERVICES = [
  { day_of_week: 4, opens_at: "12:00:00", closes_at: "13:00:00" },
  { day_of_week: 4, opens_at: "12:00:00", closes_at: "13:00:00" }, // otro salón
  { day_of_week: 4, opens_at: "20:00:00", closes_at: "20:30:00" },
  { day_of_week: 5, opens_at: "20:00:00", closes_at: "21:00:00" },
];

/** Los chips de hoy (jueves) en modo estricto. */
const TODAY_SLOTS = orderSlotsForDay({ schedule: SCHEDULE }, NOW, TZ);

function base() {
  return {
    deliveryType: "pickup" as const,
    daySlots: TODAY_SLOTS,
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

  it("rechaza todo si el negocio no ofrece chips hoy", () => {
    const scheduledAt = new Date("2026-06-25T20:00:00-03:00");
    expect(
      validateScheduledOrder({ ...base(), daySlots: [], scheduledAt }).ok,
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

describe("orderSlotsForDay — modo estricto", () => {
  it("devuelve los slots del día, ordenados y sin repetidos", () => {
    expect(orderSlotsForDay({ schedule: SCHEDULE }, NOW, TZ)).toEqual([
      "12:30",
      "13:00",
      "20:00",
      "21:00",
    ]);
  });

  it("un día cerrado no ofrece nada, aunque tenga slots cargados", () => {
    // Sábado 2026-06-27 → dow=6, open: false.
    const sat = new Date("2026-06-27T12:00:00-03:00");
    expect(orderSlotsForDay({ schedule: SCHEDULE }, sat, TZ)).toEqual([]);
  });

  it("sin grilla devuelve vacío", () => {
    expect(orderSlotsForDay({ schedule: null }, NOW, TZ)).toEqual([]);
    expect(orderSlotsForDay({}, NOW, TZ)).toEqual([]);
  });
});

describe("orderSlotsForDay — modo flexible (spec 059)", () => {
  const flexible = { mode: "flexible" as const, services: SERVICES };

  it("deriva los chips de los servicios del día, cada 15 min", () => {
    // Jueves: almuerzo 12:00–13:00 y cena 20:00–20:30. El cierre no se incluye.
    expect(orderSlotsForDay(flexible, NOW, TZ)).toEqual([
      "12:00",
      "12:15",
      "12:30",
      "12:45",
      "20:00",
      "20:15",
    ]);
  });

  it("el mismo servicio duplicado por salón no duplica chips", () => {
    const slots = orderSlotsForDay(flexible, NOW, TZ);
    expect(new Set(slots).size).toBe(slots.length);
  });

  it("ignora los servicios de otro día y toma los de `day_of_week: null`", () => {
    expect(
      orderSlotsForDay(
        {
          mode: "flexible",
          services: [
            { day_of_week: 5, opens_at: "20:00:00", closes_at: "20:30:00" },
            { day_of_week: null, opens_at: "10:00:00", closes_at: "10:30:00" },
          ],
        },
        NOW,
        TZ,
      ),
    ).toEqual(["10:00", "10:15"]);
  });

  it("en flexible NO mira `schedule` (la grilla vieja del estricto)", () => {
    expect(
      orderSlotsForDay(
        { mode: "flexible", schedule: SCHEDULE, services: [] },
        NOW,
        TZ,
      ),
    ).toEqual([]);
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

// ── Spec 127 · las dos horas del pedido ─────────────────────────────────────

describe("marchAtForOrder (spec 127)", () => {
  const BUSINESS = {
    scheduled_march_lead_pickup_min: 40,
    scheduled_march_lead_delivery_min: 60,
    scheduled_march_lead_kitchen_min: 30,
  };
  // Encargue de hoy: listo 21:15, el cliente lo retira 21:30.
  const KITCHEN_AT = new Date("2026-06-25T21:15:00-03:00");
  const SCHEDULED_AT = new Date("2026-06-25T21:30:00-03:00");

  it("con hora de cocina, cuenta hacia atrás desde ella", () => {
    expect(
      marchAtForOrder(
        { kitchen_at: KITCHEN_AT.toISOString(), scheduled_at: SCHEDULED_AT.toISOString(), delivery_type: "pickup" },
        BUSINESS,
      ),
    ).toEqual(new Date("2026-06-25T20:45:00-03:00"));
  });

  it("el lead de cocina no depende del tipo de entrega", () => {
    // El viaje ya está dicho en la diferencia entre las dos horas, así que un
    // delivery con hora de cocina usa el MISMO lead que un retiro.
    const pickup = marchAtForOrder(
      { kitchen_at: KITCHEN_AT.toISOString(), scheduled_at: SCHEDULED_AT.toISOString(), delivery_type: "pickup" },
      BUSINESS,
    );
    const delivery = marchAtForOrder(
      { kitchen_at: KITCHEN_AT.toISOString(), scheduled_at: SCHEDULED_AT.toISOString(), delivery_type: "delivery" },
      BUSINESS,
    );
    expect(delivery).toEqual(pickup);
  });

  it("sin hora de cocina, el canal web queda intacto: lead por tipo", () => {
    expect(
      marchAtForOrder(
        { kitchen_at: null, scheduled_at: SCHEDULED_AT.toISOString(), delivery_type: "pickup" },
        BUSINESS,
      ),
    ).toEqual(new Date("2026-06-25T20:50:00-03:00")); // −40
    expect(
      marchAtForOrder(
        { kitchen_at: null, scheduled_at: SCHEDULED_AT.toISOString(), delivery_type: "delivery" },
        BUSINESS,
      ),
    ).toEqual(new Date("2026-06-25T20:30:00-03:00")); // −60
  });

  it("sin ninguna hora, no hay momento de marcha", () => {
    expect(
      marchAtForOrder(
        { kitchen_at: null, scheduled_at: null, delivery_type: "pickup" },
        BUSINESS,
      ),
    ).toBeNull();
  });

  it("cae al default si la fila del negocio viene incompleta", () => {
    expect(
      marchAtForOrder(
        { kitchen_at: KITCHEN_AT.toISOString(), scheduled_at: null, delivery_type: "pickup" },
        null,
      ),
    ).toEqual(
      new Date(KITCHEN_AT.getTime() - DEFAULT_MARCH_LEAD_KITCHEN_MIN * 60_000),
    );
  });
});

describe("validateScheduledOrder · source staff (spec 127)", () => {
  const base = {
    deliveryType: "pickup" as const,
    daySlots: TODAY_SLOTS,
    timezone: TZ,
    now: NOW, // jueves 12:00
  };

  it("acepta una hora que NO está en la grilla", () => {
    // 21:20 no es chip de nada; es el encargue telefónico real.
    const at = new Date("2026-06-25T21:20:00-03:00");
    expect(
      validateScheduledOrder({ ...base, scheduledAt: at, source: "staff" }).ok,
    ).toBe(true);
    expect(
      validateScheduledOrder({ ...base, scheduledAt: at, source: "public" }).ok,
    ).toBe(false);
  });

  it("acepta menos de 60 minutos de anticipación", () => {
    const at = new Date("2026-06-25T12:25:00-03:00"); // 25 min
    expect(
      validateScheduledOrder({ ...base, scheduledAt: at, source: "staff" }).ok,
    ).toBe(true);
    expect(
      validateScheduledOrder({ ...base, scheduledAt: at, source: "public" }).ok,
    ).toBe(false);
  });

  it("acepta otro día — el encargue programado (D6)", () => {
    const manana = new Date("2026-06-26T21:00:00-03:00");
    expect(
      validateScheduledOrder({ ...base, scheduledAt: manana, source: "staff" }).ok,
    ).toBe(true);
    expect(
      validateScheduledOrder({ ...base, scheduledAt: manana, source: "public" }).ok,
    ).toBe(false);
  });

  it("rechaza una hora que ya pasó", () => {
    const ayer = new Date("2026-06-25T11:00:00-03:00");
    expect(
      validateScheduledOrder({ ...base, scheduledAt: ayer, source: "staff" }).ok,
    ).toBe(false);
  });

  it("rechaza la mesa, igual que el público", () => {
    expect(
      validateScheduledOrder({
        ...base,
        deliveryType: "dine_in",
        scheduledAt: new Date("2026-06-25T21:20:00-03:00"),
        source: "staff",
      }).ok,
    ).toBe(false);
  });

  it("rechaza una hora de cocina posterior a la del pedido", () => {
    // El plato no puede estar listo DESPUÉS de que el cliente se lo lleve.
    expect(
      validateScheduledOrder({
        ...base,
        scheduledAt: new Date("2026-06-25T21:00:00-03:00"),
        kitchenAt: new Date("2026-06-25T21:30:00-03:00"),
        source: "staff",
      }).ok,
    ).toBe(false);
  });

  it("acepta la hora de cocina igual a la del pedido", () => {
    const at = new Date("2026-06-25T21:00:00-03:00");
    expect(
      validateScheduledOrder({
        ...base,
        scheduledAt: at,
        kitchenAt: at,
        source: "staff",
      }).ok,
    ).toBe(true);
  });

  it("sin source explícito se comporta como el público (back-compat)", () => {
    const at = new Date("2026-06-25T21:20:00-03:00");
    expect(validateScheduledOrder({ ...base, scheduledAt: at }).ok).toBe(false);
  });
});

describe("operatingDay (spec 127 · espejo TS de public.operating_day)", () => {
  it("una cena normal cae en su propio día", () => {
    expect(operatingDay(new Date("2026-06-25T21:30:00-03:00"), TZ)).toBe(
      "2026-06-25",
    );
  });

  it("la madrugada pertenece a la jornada del día anterior (corte 6 AM)", () => {
    expect(operatingDay(new Date("2026-06-26T02:00:00-03:00"), TZ)).toBe(
      "2026-06-25",
    );
    expect(operatingDay(new Date("2026-06-26T05:59:00-03:00"), TZ)).toBe(
      "2026-06-25",
    );
  });

  it("a las 6 AM arranca la jornada nueva", () => {
    expect(operatingDay(new Date("2026-06-26T06:00:00-03:00"), TZ)).toBe(
      "2026-06-26",
    );
  });

  it("el encargue de mañana a la noche cae en la jornada de mañana", () => {
    expect(operatingDay(new Date("2026-06-26T21:15:00-03:00"), TZ)).toBe(
      "2026-06-26",
    );
  });
});

describe("esperaSuHoraDeMarcha (spec 127)", () => {
  const BUSINESS = { scheduled_march_lead_kitchen_min: 40 };
  const NOW_ = new Date("2026-06-25T18:00:00-03:00");

  it("el encargue de las 21:15 todavía espera a las 18:00", () => {
    expect(
      esperaSuHoraDeMarcha(
        {
          kitchen_at: "2026-06-25T21:15:00-03:00",
          scheduled_at: "2026-06-25T21:30:00-03:00",
          delivery_type: "pickup",
        },
        BUSINESS,
        NOW_,
      ),
    ).toBe(true);
  });

  it("pasada la hora de marcha, ya no espera", () => {
    expect(
      esperaSuHoraDeMarcha(
        {
          kitchen_at: "2026-06-25T21:15:00-03:00",
          scheduled_at: "2026-06-25T21:30:00-03:00",
          delivery_type: "pickup",
        },
        BUSINESS,
        new Date("2026-06-25T20:36:00-03:00"),
      ),
    ).toBe(false);
  });

  it("un pedido sin horas no espera nada: marcha cuando lo mandan", () => {
    expect(
      esperaSuHoraDeMarcha(
        { kitchen_at: null, scheduled_at: null, delivery_type: "pickup" },
        BUSINESS,
        NOW_,
      ),
    ).toBe(false);
  });
});
