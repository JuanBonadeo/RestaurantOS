import { beforeEach, describe, expect, it, vi } from "vitest";

import type { BusinessRole } from "@/lib/admin/context";
import type { CreateOrderInput } from "./schema";

// Spec 054 — `cargarPedidoStaff`: gate del staff + mapeo de defaults de
// mostrador antes de delegar en `persistOrder`. Mockeamos las dependencias de
// borde (tenant, auth, persistOrder) para probar la lógica del wrapper sin DB.

let currentRole: BusinessRole;

const persistOrderMock = vi.fn(
  async (..._args: unknown[]) =>
    ({ ok: true, data: { order_id: "o1", order_number: 1 } }) as const,
);

vi.mock("@/lib/tenant", () => ({
  getBusiness: async (slug: string) =>
    slug === "nope" ? null : { id: "biz1", slug },
}));

vi.mock("@/lib/mozo/auth", () => ({
  requireMozoActionContext: async () => ({
    ok: true as const,
    data: { userId: "u1", role: currentRole, isPlatformAdmin: false },
  }),
}));

vi.mock("./persist-order", () => ({
  persistOrder: (...args: unknown[]) => persistOrderMock(...args),
}));

// Spec 085: el único uso del service client acá es avalar el programado
// (`update {status:'confirmed'} where id = …`). El mock devuelve la forma de
// Supabase —`{ error }`— para poder simular también el fallo.
const updateMock = vi.fn(
  async (_values: unknown, _orderId: string) =>
    ({ error: null }) as { error: { message: string } | null },
);

vi.mock("@/lib/supabase/service", () => ({
  createSupabaseServiceClient: () => ({
    from: () => ({
      update: (values: unknown) => ({
        eq: (_col: string, orderId: string) => updateMock(values, orderId),
      }),
    }),
  }),
}));

import { cargarPedidoStaff } from "./staff-order";

const UUID = "00000000-0000-4000-8000-000000000000";
const items = [{ product_id: UUID, quantity: 1, modifier_ids: [] }];

/** Última llamada a persistOrder, tipada para leer el input mapeado. */
function lastPersistCall() {
  const call = persistOrderMock.mock.calls.at(-1) as unknown as [
    CreateOrderInput,
    string | null | undefined,
    (
      | {
          mozoId?: string | null;
          priceOverrides?: ({ cents: number; reason: string } | null)[];
        }
      | undefined
    ),
  ];
  return { mapped: call[0], userId: call[1], options: call[2] };
}

beforeEach(() => {
  currentRole = "encargado";
  persistOrderMock.mockClear();
  updateMock.mockClear();
});

describe("cargarPedidoStaff — gate (canCargarPedido, fase 1)", () => {
  it("el encargado puede cargar", async () => {
    const res = await cargarPedidoStaff({
      business_slug: "golf",
      delivery_type: "pickup",
      items,
    });
    expect(res.ok).toBe(true);
    expect(persistOrderMock).toHaveBeenCalledTimes(1);
  });

  it("el mozo NO puede cargar pedidos del board (fase 1)", async () => {
    currentRole = "mozo";
    const res = await cargarPedidoStaff({
      business_slug: "golf",
      delivery_type: "pickup",
      items,
    });
    expect(res.ok).toBe(false);
    expect(persistOrderMock).not.toHaveBeenCalled();
  });

  it("negocio inexistente → error, sin persistir", async () => {
    const res = await cargarPedidoStaff({
      business_slug: "nope",
      delivery_type: "pickup",
      items,
    });
    expect(res.ok).toBe(false);
    expect(persistOrderMock).not.toHaveBeenCalled();
  });
});

describe("cargarPedidoStaff — defaults de mostrador y auditoría", () => {
  it("pickup sin nombre ni teléfono → 'Mostrador' y '-', pago efectivo", async () => {
    await cargarPedidoStaff({
      business_slug: "golf",
      delivery_type: "pickup",
      items,
    });
    const { mapped, userId, options } = lastPersistCall();
    expect(mapped).toMatchObject({
      delivery_type: "pickup",
      customer_name: "Mostrador",
      customer_phone: "-",
      payment_method: "cash",
    });
    // Auditoría: se registra quién cargó el pedido (userId + mozoId).
    expect(userId).toBe("u1");
    expect(options?.mozoId).toBe("u1");
  });

  it("respeta el nombre cargado por el encargado", async () => {
    await cargarPedidoStaff({
      business_slug: "golf",
      delivery_type: "pickup",
      customer_name: "Juan",
      items,
    });
    expect(lastPersistCall().mapped.customer_name).toBe("Juan");
  });

  it("delivery completo pasa dirección + teléfono", async () => {
    await cargarPedidoStaff({
      business_slug: "golf",
      delivery_type: "delivery",
      delivery_address: "Av. Golf 123",
      customer_phone: "1155551234",
      items,
    });
    expect(lastPersistCall().mapped).toMatchObject({
      delivery_type: "delivery",
      delivery_address: "Av. Golf 123",
      customer_phone: "1155551234",
    });
  });

  it("delivery sin dirección se rechaza antes de persistir", async () => {
    const res = await cargarPedidoStaff({
      business_slug: "golf",
      delivery_type: "delivery",
      customer_phone: "1155551234",
      items,
    });
    expect(res.ok).toBe(false);
    expect(persistOrderMock).not.toHaveBeenCalled();
  });

  it("carrito vacío se rechaza antes de persistir", async () => {
    const res = await cargarPedidoStaff({
      business_slug: "golf",
      delivery_type: "pickup",
      items: [],
    });
    expect(res.ok).toBe(false);
    expect(persistOrderMock).not.toHaveBeenCalled();
  });
});

// ── Spec 069 · precio por ítem con motivo ─────────────────────────────────

describe("cargarPedidoStaff — precio por ítem (spec 069)", () => {
  const conPrecio = (extra: Record<string, unknown>) => ({
    business_slug: "golf-jcr",
    delivery_type: "pickup" as const,
    items: [{ product_id: UUID, quantity: 1, modifier_ids: [], ...extra }],
  });

  it("el encargado pisa el precio y viaja por opciones, no en los items", async () => {
    const res = await cargarPedidoStaff(
      conPrecio({ price_override_cents: 0, price_override_reason: "  cortesía  " }),
    );
    expect(res.ok).toBe(true);

    const { mapped, options } = lastPersistCall();
    // El precio NO viaja dentro del input que persistOrder valida como público.
    expect(options?.priceOverrides).toEqual([{ cents: 0, reason: "cortesía" }]);
    expect(mapped.items[0]).not.toHaveProperty("price_override_cents");
  });

  it("acepta un precio por encima del de lista — no hay tope", async () => {
    const res = await cargarPedidoStaff(
      conPrecio({
        price_override_cents: 9_999_999,
        price_override_reason: "pescado del día",
      }),
    );
    expect(res.ok).toBe(true);
  });

  it("el mozo ni llega al precio — este camino ya es encargado/admin", async () => {
    // `canCargarPedido` corta antes que el gate de precio: en mostrador el mozo
    // no carga pedidos en absoluto. Su gate de precio se prueba donde sí opera
    // (`enviarComanda`, mesa) y en `price-override.test.ts`.
    currentRole = "mozo";
    const res = await cargarPedidoStaff(
      conPrecio({ price_override_cents: 500, price_override_reason: "x" }),
    );
    expect(res.ok).toBe(false);
    expect(persistOrderMock).not.toHaveBeenCalled();
  });

  it("sin motivo se rechaza y no persiste nada", async () => {
    const res = await cargarPedidoStaff(
      conPrecio({ price_override_cents: 500, price_override_reason: "   " }),
    );
    expect(res.ok).toBe(false);
    expect(res.ok === false && res.error).toMatch(/motivo/i);
    expect(persistOrderMock).not.toHaveBeenCalled();
  });

  it("sin override, priceOverrides queda todo en null", async () => {
    const res = await cargarPedidoStaff(conPrecio({}));
    expect(res.ok).toBe(true);
    expect(lastPersistCall().options?.priceOverrides).toEqual([null]);
  });
});

// ── Spec 085 · el encargado programa un pedido ────────────────────────────
//
// El motor del diferido no cambia: `persistOrder` valida `scheduled_at` (hoy,
// anticipación, chip de la grilla) igual que en el checkout público. Lo propio
// de este camino es el **aval**: el pedido que carga el encargado nace
// `confirmed`, así el cron lo marcha sin pedir un «Aceptar» redundante.

describe("cargarPedidoStaff — pedido programado (spec 085)", () => {
  const enTresHoras = () =>
    new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString();
  let pedido = "";
  /** Spec 127: la hora de cocina va con la del pedido, un rato antes. */
  const cocinaDe = (pedidoIso: string) =>
    new Date(new Date(pedidoIso).getTime() - 15 * 60 * 1000).toISOString();

  it("pasa scheduled_at a persistOrder tal cual", async () => {
    const scheduled = enTresHoras();
    const res = await cargarPedidoStaff({
      business_slug: "golf",
      delivery_type: "pickup",
      scheduled_at: scheduled,
      kitchen_at: cocinaDe(scheduled),
      items,
    });
    expect(res.ok).toBe(true);
    expect(lastPersistCall().mapped.scheduled_at).toBe(scheduled);
  });

  it("el programado queda avalado (status confirmed), sin gesto extra", async () => {
    const res = await cargarPedidoStaff({
      business_slug: "golf",
      delivery_type: "pickup",
      scheduled_at: (pedido = enTresHoras()),
      kitchen_at: cocinaDe(pedido),
      items,
    });
    expect(res.ok).toBe(true);
    expect(updateMock).toHaveBeenCalledWith({ status: "confirmed" }, "o1");
    expect(res.ok && res.data.needs_accept).toBeFalsy();
  });

  it("si el aval falla, el pedido queda creado y se pide aceptarlo a mano", async () => {
    // Degradación segura: la orden existe y cae en «Próximos» con su botón
    // «Aceptar». Devolver error haría creer que no se cargó nada.
    updateMock.mockResolvedValueOnce({ error: { message: "boom" } });
    const res = await cargarPedidoStaff({
      business_slug: "golf",
      delivery_type: "pickup",
      scheduled_at: (pedido = enTresHoras()),
      kitchen_at: cocinaDe(pedido),
      items,
    });
    expect(res.ok).toBe(true);
    expect(res.ok && res.data.needs_accept).toBe(true);
  });

  it("media hora cargada no entra: van las dos o ninguna (spec 127)", async () => {
    const res = await cargarPedidoStaff({
      business_slug: "golf",
      delivery_type: "pickup",
      scheduled_at: enTresHoras(),
      items,
    });
    expect(res.ok).toBe(false);
  });

  it("un pedido para ahora no toca el status (camino de siempre)", async () => {
    const res = await cargarPedidoStaff({
      business_slug: "golf",
      delivery_type: "pickup",
      items,
    });
    expect(res.ok).toBe(true);
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("una hora ya pasada no se avala: es un pedido para ahora", async () => {
    // El instante pasado lo rechaza `persistOrder` (mockeado acá), pero aunque
    // pasara, `confirmed` sólo aplica a lo que todavía no llegó.
    const res = await cargarPedidoStaff({
      business_slug: "golf",
      delivery_type: "pickup",
      scheduled_at: (pedido = new Date(Date.now() - 60_000).toISOString()),
      kitchen_at: cocinaDe(pedido),
      items,
    });
    expect(res.ok).toBe(true);
    expect(updateMock).not.toHaveBeenCalled();
  });
});
