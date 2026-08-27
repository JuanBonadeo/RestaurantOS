import { describe, it, expect } from "vitest";
import { CreateOrderInput, StaffOrderInput } from "./schema";

const UUID = "00000000-0000-4000-8000-000000000000";

const base = {
  business_slug: "pizzanapoli",
  delivery_type: "pickup" as const,
  customer_name: "Juan",
  customer_phone: "1155551234",
  items: [{ product_id: UUID, quantity: 1, modifier_ids: [] }],
};

describe("CreateOrderInput", () => {
  it("accepts a minimal pickup order", () => {
    expect(CreateOrderInput.safeParse(base).success).toBe(true);
  });

  it("rejects empty items", () => {
    const result = CreateOrderInput.safeParse({ ...base, items: [] });
    expect(result.success).toBe(false);
  });

  it("rejects quantity 0", () => {
    const result = CreateOrderInput.safeParse({
      ...base,
      items: [{ ...base.items[0], quantity: 0 }],
    });
    expect(result.success).toBe(false);
  });

  it("rejects empty phone", () => {
    const result = CreateOrderInput.safeParse({ ...base, customer_phone: "" });
    expect(result.success).toBe(false);
  });

  it("rejects delivery without address", () => {
    const result = CreateOrderInput.safeParse({
      ...base,
      delivery_type: "delivery",
    });
    expect(result.success).toBe(false);
  });

  it("accepts delivery with address", () => {
    const result = CreateOrderInput.safeParse({
      ...base,
      delivery_type: "delivery",
      delivery_address: "Calle 123",
    });
    expect(result.success).toBe(true);
  });

  it("accepts a scheduled pickup paid with MP", () => {
    const result = CreateOrderInput.safeParse({
      ...base,
      payment_method: "mp",
      scheduled_at: "2026-06-26T13:00:00-03:00",
    });
    expect(result.success).toBe(true);
  });

  // Spec 061: el delivery se programa, y puede pagarse al recibir.
  it("accepts a scheduled delivery paid with MP", () => {
    const result = CreateOrderInput.safeParse({
      ...base,
      delivery_type: "delivery",
      delivery_address: "Calle 123",
      payment_method: "mp",
      scheduled_at: "2026-06-26T13:00:00-03:00",
    });
    expect(result.success).toBe(true);
  });

  it("accepts a scheduled delivery paid with cash", () => {
    const result = CreateOrderInput.safeParse({
      ...base,
      delivery_type: "delivery",
      delivery_address: "Calle 123",
      payment_method: "cash",
      scheduled_at: "2026-06-26T13:00:00-03:00",
    });
    expect(result.success).toBe(true);
  });

  it("accepts a scheduled pickup paid with cash (el prepago dejó de ser obligatorio)", () => {
    const result = CreateOrderInput.safeParse({
      ...base,
      payment_method: "cash",
      scheduled_at: "2026-06-26T13:00:00-03:00",
    });
    expect(result.success).toBe(true);
  });

  it("rejects a malformed scheduled_at", () => {
    const result = CreateOrderInput.safeParse({
      ...base,
      payment_method: "mp",
      scheduled_at: "mañana a las 12",
    });
    expect(result.success).toBe(false);
  });
});

describe("StaffOrderInput (spec 054)", () => {
  const staffBase = {
    business_slug: "golf-jcr",
    delivery_type: "pickup" as const,
    items: [{ product_id: UUID, quantity: 1, modifier_ids: [] }],
  };

  it("acepta un pickup de mostrador sin nombre ni teléfono", () => {
    expect(StaffOrderInput.safeParse(staffBase).success).toBe(true);
  });

  it("acepta un pickup con nombre pero sin teléfono", () => {
    const result = StaffOrderInput.safeParse({
      ...staffBase,
      customer_name: "Juan",
    });
    expect(result.success).toBe(true);
  });

  it("rechaza items vacíos", () => {
    const result = StaffOrderInput.safeParse({ ...staffBase, items: [] });
    expect(result.success).toBe(false);
  });

  it("rechaza delivery sin dirección", () => {
    const result = StaffOrderInput.safeParse({
      ...staffBase,
      delivery_type: "delivery",
      customer_phone: "1155551234",
    });
    expect(result.success).toBe(false);
  });

  it("rechaza delivery sin teléfono", () => {
    const result = StaffOrderInput.safeParse({
      ...staffBase,
      delivery_type: "delivery",
      delivery_address: "Av. Golf 123",
    });
    expect(result.success).toBe(false);
  });

  it("acepta delivery con dirección + teléfono", () => {
    const result = StaffOrderInput.safeParse({
      ...staffBase,
      delivery_type: "delivery",
      delivery_address: "Av. Golf 123",
      customer_phone: "1155551234",
    });
    expect(result.success).toBe(true);
  });

  // ── Spec 085 · el encargado programa ────────────────────────────────────
  //
  // `scheduled_at` entró al schema staff (spec 054 lo había dejado afuera "fuera
  // de fase 1"). Acá sólo la forma: las reglas de negocio —hoy, anticipación,
  // chip de la grilla— dependen del negocio y las aplica `validateScheduledOrder`
  // dentro de `persistOrder`, igual que en el camino público.
  it("acepta las dos horas ISO con offset", () => {
    const result = StaffOrderInput.safeParse({
      ...staffBase,
      scheduled_at: "2026-08-01T13:00:00-03:00",
      kitchen_at: "2026-08-01T12:45:00-03:00",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.scheduled_at).toBe("2026-08-01T13:00:00-03:00");
      expect(result.data.kitchen_at).toBe("2026-08-01T12:45:00-03:00");
    }
  });

  // Spec 127 — las dos horas son un par: media hora cargada es un pedido del
  // que no se sabe si es para ahora. El orden entre ellas lo valida el server
  // (`validateScheduledOrder`), que sí sabe cuál es cuál.
  it("rechaza una sola de las dos horas", () => {
    expect(
      StaffOrderInput.safeParse({
        ...staffBase,
        scheduled_at: "2026-08-01T13:00:00-03:00",
      }).success,
    ).toBe(false);
    expect(
      StaffOrderInput.safeParse({
        ...staffBase,
        kitchen_at: "2026-08-01T12:45:00-03:00",
      }).success,
    ).toBe(false);
  });

  it("rechaza scheduled_at que no es un instante con offset", () => {
    // Sin offset no hay instante: "21:00" en qué zona. El público exige lo
    // mismo, así que el staff no puede ser la puerta de atrás.
    expect(
      StaffOrderInput.safeParse({
        ...staffBase,
        scheduled_at: "2026-08-01T13:00:00",
        kitchen_at: "2026-08-01T12:45:00-03:00",
      }).success,
    ).toBe(false);
    expect(
      StaffOrderInput.safeParse({
        ...staffBase,
        scheduled_at: "mañana 21hs",
        kitchen_at: "2026-08-01T12:45:00-03:00",
      }).success,
    ).toBe(false);
  });

  it("sin scheduled_at sigue siendo un pedido para ahora", () => {
    const result = StaffOrderInput.safeParse(staffBase);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.scheduled_at).toBeUndefined();
  });
});

// ── Spec 069 · precio por ítem sólo por el camino de staff ────────────────
//
// La defensa central de la spec es estructural: el override vive en el schema
// de staff y NO en el público. Si alguien agregara los campos a
// `OrderProductItem` "para reusar", estos tests se ponen rojos.

describe("precio por ítem (spec 069) — separación público / staff", () => {
  const staffBase = {
    business_slug: "golf-jcr",
    delivery_type: "pickup" as const,
  };
  const withOverride = {
    product_id: UUID,
    quantity: 1,
    modifier_ids: [],
    price_override_cents: 0,
    price_override_reason: "cortesía",
  };

  it("el checkout público DESCARTA el precio pisado del payload", () => {
    const result = CreateOrderInput.safeParse({ ...base, items: [withOverride] });
    expect(result.success).toBe(true);
    if (result.success) {
      const item = result.data.items[0];
      // El comensal no puede fijar el precio ni aunque lo mande: Zod lo strippea
      // y `persistOrder` cobra el de catálogo.
      expect("price_override_cents" in item).toBe(false);
      expect("price_override_reason" in item).toBe(false);
    }
  });

  it("el schema de staff SÍ lo conserva", () => {
    const result = StaffOrderInput.safeParse({
      ...staffBase,
      items: [withOverride],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      const item = result.data.items[0] as Record<string, unknown>;
      expect(item.price_override_cents).toBe(0);
      expect(item.price_override_reason).toBe("cortesía");
    }
  });

  it("el schema de staff rechaza precios negativos y no enteros", () => {
    for (const cents of [-1, 10.5]) {
      const result = StaffOrderInput.safeParse({
        ...staffBase,
        items: [{ ...withOverride, price_override_cents: cents }],
      });
      expect(result.success).toBe(false);
    }
  });
});
