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
