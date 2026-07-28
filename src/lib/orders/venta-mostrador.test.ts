import { beforeEach, describe, expect, it, vi } from "vitest";

import type { BusinessRole } from "@/lib/admin/context";

// Spec 058 — `venderMostrador`: gate del staff + encadenado
// crear → cobrar → cerrar → rutear. Mockeamos las dependencias de borde
// (tenant, auth, persistOrder, registrarPago, ruteo, service client) para
// probar la orquestación y, sobre todo, el rescate de la orden cuando el cobro
// falla — que es donde vive el riesgo de plata fantasma (FR-007).

const UUID = "00000000-0000-4000-8000-000000000000";
const CAJA = "11111111-1111-4111-8111-111111111111";

let currentRole: BusinessRole;
let orderTotalCents: number;
let adjustmentPercent: number;
/** Updates a `orders` capturados del service client, en orden. */
let orderUpdates: Record<string, unknown>[];

const persistOrderMock = vi.fn(
  async (..._args: unknown[]) =>
    ({ ok: true, data: { order_id: "o1", order_number: 42 } }) as const,
);

const registrarPagoMock = vi.fn(async (..._args: unknown[]) => ({
  ok: true as const,
  data: { payment: { id: "p1" }, splitDone: false, orderClosed: true },
}));

const routeOrderToCocinaMock = vi.fn(async (..._args: unknown[]) => ({
  ok: true as const,
  data: { order_id: "o1", comanda_ids: ["c1"], items_without_station: 1 },
}));

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

vi.mock("./route-to-cocina", () => ({
  routeOrderToCocina: (...args: unknown[]) => routeOrderToCocinaMock(...args),
}));

vi.mock("@/lib/billing/cobro-actions", () => ({
  registrarPago: (...args: unknown[]) => registrarPagoMock(...args),
}));

vi.mock("@/lib/caja/queries", () => ({
  getPaymentMethodConfigs: async () => [
    { method: "card_manual", adjustment_percent: adjustmentPercent },
    { method: "cash", adjustment_percent: 0 },
  ],
}));

/**
 * Service client mínimo: resuelve el `select` del total y acumula los `update`
 * sobre `orders` para poder afirmar sobre el rescate y el cierre.
 */
vi.mock("@/lib/supabase/service", () => ({
  createSupabaseServiceClient: () => ({
    from: () => {
      const chain = {
        select: () => chain,
        update: (patch: Record<string, unknown>) => {
          orderUpdates.push(patch);
          return chain;
        },
        eq: () => chain,
        maybeSingle: async () => ({ data: { total_cents: orderTotalCents } }),
        then: undefined,
      };
      return chain;
    },
  }),
}));

import { venderMostrador } from "./venta-mostrador";

const items = [{ product_id: UUID, quantity: 1, modifier_ids: [] }];

function ventaValida(overrides: Record<string, unknown> = {}) {
  return {
    business_slug: "golf",
    items,
    method: "cash",
    caja_id: CAJA,
    ...overrides,
  };
}

/** Última llamada a registrarPago, tipada para leer el input del cobro. */
function lastPagoInput() {
  return registrarPagoMock.mock.calls.at(-1)?.[0] as {
    orderId: string;
    splitId: string | null;
    amount_cents: number;
    adjustment_percent: number;
    adjustment_cents: number;
    caja_id: string;
    tip_cents: number;
  };
}

beforeEach(() => {
  currentRole = "encargado";
  orderTotalCents = 10_000;
  adjustmentPercent = 0;
  orderUpdates = [];
  persistOrderMock.mockClear();
  registrarPagoMock.mockClear();
  routeOrderToCocinaMock.mockClear();
  registrarPagoMock.mockResolvedValue({
    ok: true as const,
    data: { payment: { id: "p1" }, splitDone: false, orderClosed: true },
  });
});

describe("venderMostrador — gate y validación", () => {
  it("el encargado puede vender", async () => {
    const res = await venderMostrador(ventaValida());
    expect(res.ok).toBe(true);
    expect(persistOrderMock).toHaveBeenCalledTimes(1);
    expect(registrarPagoMock).toHaveBeenCalledTimes(1);
  });

  it("el admin puede vender", async () => {
    currentRole = "admin";
    const res = await venderMostrador(ventaValida());
    expect(res.ok).toBe(true);
  });

  it("el mozo NO puede vender de mostrador", async () => {
    currentRole = "mozo";
    const res = await venderMostrador(ventaValida());
    expect(res.ok).toBe(false);
    expect(persistOrderMock).not.toHaveBeenCalled();
  });

  it("el personal de cocina NO puede vender de mostrador", async () => {
    currentRole = "personal";
    const res = await venderMostrador(ventaValida());
    expect(res.ok).toBe(false);
    expect(persistOrderMock).not.toHaveBeenCalled();
  });

  it("carrito vacío se rechaza antes de crear nada", async () => {
    const res = await venderMostrador(ventaValida({ items: [] }));
    expect(res.ok).toBe(false);
    expect(persistOrderMock).not.toHaveBeenCalled();
  });

  it("sin caja se rechaza antes de crear nada", async () => {
    const res = await venderMostrador(ventaValida({ caja_id: undefined }));
    expect(res.ok).toBe(false);
    expect(persistOrderMock).not.toHaveBeenCalled();
  });

  it("negocio inexistente → error, sin persistir", async () => {
    const res = await venderMostrador(ventaValida({ business_slug: "nope" }));
    expect(res.ok).toBe(false);
    expect(persistOrderMock).not.toHaveBeenCalled();
  });
});

describe("venderMostrador — la orden nace fuera del board y del plano", () => {
  it("crea la orden dine_in, sin mesa, a nombre de Mostrador", async () => {
    await venderMostrador(ventaValida());
    const [mapped, userId, options] = persistOrderMock.mock.calls[0] as [
      { delivery_type: string; customer_name: string; customer_phone: string },
      string,
      { mozoId: string },
    ];
    // `dine_in` la deja fuera del board (que filtra dine_in) y, sin table_id,
    // fuera del plano del salón (que lista por table_id).
    expect(mapped.delivery_type).toBe("dine_in");
    expect(mapped.customer_name).toBe("Mostrador");
    expect(mapped.customer_phone).toBe("-");
    // Auditoría: queda registrado quién vendió.
    expect(userId).toBe("u1");
    expect(options).toEqual({ mozoId: "u1" });
  });

  it("nunca manda table_id", async () => {
    await venderMostrador(ventaValida());
    const mapped = persistOrderMock.mock.calls[0]?.[0] as Record<
      string,
      unknown
    >;
    expect(mapped).not.toHaveProperty("table_id");
  });
});

describe("venderMostrador — el cobro", () => {
  it("cobra el total entero, sin split", async () => {
    await venderMostrador(ventaValida());
    const pago = lastPagoInput();
    expect(pago.splitId).toBeNull();
    expect(pago.amount_cents).toBe(10_000);
    expect(pago.caja_id).toBe(CAJA);
    expect(pago.tip_cents).toBe(0);
  });

  it("aplica el recargo del método configurado (server-side)", async () => {
    adjustmentPercent = 10;
    const res = await venderMostrador(ventaValida({ method: "card_manual" }));
    const pago = lastPagoInput();
    expect(pago.adjustment_percent).toBe(10);
    expect(pago.adjustment_cents).toBe(1_000);
    expect(pago.amount_cents).toBe(11_000);
    expect(res.ok && res.data.cobrado_cents).toBe(11_000);
  });

  it("aplica el descuento del método configurado", async () => {
    adjustmentPercent = -10;
    await venderMostrador(ventaValida({ method: "card_manual" }));
    expect(lastPagoInput().amount_cents).toBe(9_000);
  });

  it("con descuento la orden igual queda cerrada (no queda abierta e invisible)", async () => {
    adjustmentPercent = -10;
    // Con total_paid < total_cents la RPC no la da por saldada.
    registrarPagoMock.mockResolvedValue({
      ok: true as const,
      data: { payment: { id: "p1" }, splitDone: false, orderClosed: false },
    });
    const res = await venderMostrador(ventaValida({ method: "card_manual" }));
    expect(res.ok).toBe(true);
    expect(orderUpdates.at(-1)).toMatchObject({ lifecycle_status: "closed" });
  });

  it("si ya cerró por la RPC, no la vuelve a cerrar", async () => {
    await venderMostrador(ventaValida());
    expect(orderUpdates).toHaveLength(0);
  });

  it("propaga el requestId de idempotencia al cobro", async () => {
    const requestId = "22222222-2222-4222-8222-222222222222";
    await venderMostrador(ventaValida({ request_id: requestId }));
    expect(
      (lastPagoInput() as unknown as { requestId: string }).requestId,
    ).toBe(requestId);
  });
});

describe("venderMostrador — rescate si el cobro falla (FR-007)", () => {
  beforeEach(() => {
    registrarPagoMock.mockResolvedValue({
      ok: false as const,
      error: "La caja está inactiva.",
    } as never);
  });

  it("devuelve el error del cobro", async () => {
    const res = await venderMostrador(ventaValida());
    expect(res.ok).toBe(false);
    expect(res.ok === false && res.error).toBe("La caja está inactiva.");
  });

  it("cancela la orden para que no quede abierta e invisible", async () => {
    await venderMostrador(ventaValida());
    expect(orderUpdates.at(-1)).toMatchObject({
      lifecycle_status: "cancelled",
      cancelled_by: "u1",
      cancelled_reason: "Venta de mostrador no cobrada",
    });
  });

  it("no manda nada a cocina si no se cobró", async () => {
    await venderMostrador(ventaValida());
    expect(routeOrderToCocinaMock).not.toHaveBeenCalled();
  });
});

describe("venderMostrador — la cocina va después de la plata", () => {
  it("reporta las comandas creadas y los ítems sin sector", async () => {
    const res = await venderMostrador(ventaValida());
    expect(res.ok && res.data.comandas_creadas).toBe(1);
    expect(res.ok && res.data.items_sin_sector).toBe(1);
    expect(res.ok && res.data.ruteo_error).toBeNull();
  });

  it("kiosco puro (nada con sector) → cero comandas, venta igual de válida", async () => {
    routeOrderToCocinaMock.mockResolvedValue({
      ok: true as const,
      data: { order_id: "o1", comanda_ids: [], items_without_station: 2 },
    });
    const res = await venderMostrador(ventaValida());
    expect(res.ok).toBe(true);
    expect(res.ok && res.data.comandas_creadas).toBe(0);
  });

  it("si el ruteo falla, la venta NO se revierte — la plata ya entró", async () => {
    routeOrderToCocinaMock.mockResolvedValue({
      ok: false as const,
      error: "El pedido no tiene items.",
    } as never);
    const res = await venderMostrador(ventaValida());
    expect(res.ok).toBe(true);
    expect(res.ok && res.data.ruteo_error).toBe("El pedido no tiene items.");
    // Nada de cancelaciones: la orden quedó cobrada y cerrada.
    expect(
      orderUpdates.some((u) => u.lifecycle_status === "cancelled"),
    ).toBe(false);
  });

  it("si el ruteo explota, la venta tampoco se revierte", async () => {
    routeOrderToCocinaMock.mockRejectedValue(new Error("printer on fire"));
    const res = await venderMostrador(ventaValida());
    expect(res.ok).toBe(true);
    expect(res.ok && res.data.ruteo_error).toBeTruthy();
  });
});
