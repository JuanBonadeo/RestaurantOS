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
 *
 * Distingue por tabla porque la venta ahora consulta `payments` antes de crear
 * nada (issue #263, idempotencia de la venta y no sólo del cobro). Un mock que
 * devuelve la misma fila para cualquier tabla haría creer que la venta ya
 * ocurrió, y no se cobraría nunca.
 */
let pagoPrevio: { id: string; order_id: string; amount_cents: number } | null =
  null;

vi.mock("@/lib/supabase/service", () => ({
  createSupabaseServiceClient: () => ({
    from: (tabla: string) => {
      const chain = {
        select: () => chain,
        update: (patch: Record<string, unknown>) => {
          orderUpdates.push(patch);
          return chain;
        },
        eq: () => chain,
        maybeSingle: async () =>
          tabla === "payments"
            ? { data: pagoPrevio }
            : { data: { total_cents: orderTotalCents, order_number: 1, daily_number: 1 } },
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
  pagoPrevio = null;
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
    // `allowFreeLines` + `role`: el mostrador puede cargar el «no existe»
    // (spec 174) y el gate de rol lo aplica `persistOrder`.
    expect(options).toEqual({
      mozoId: "u1",
      allowFreeLines: true,
      role: "encargado",
    });
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

  it("con descuento cierra por el camino normal, sin escribir la orden a mano", async () => {
    // Antes, con descuento, la RPC no daba la orden por saldada (issue #253) y
    // acá se la cerraba a mano. Ese rescate salteaba `closeOrderIfFullyPaid`,
    // que es quien emite el comprobante: el negocio con descuento configurado no
    // facturaba nunca en el mostrador (issue #263).
    //
    // Con la migración 0076 la RPC compara en base y cierra sola. Lo que se
    // afirma acá es que `venderMostrador` **no vuelve a tocar la orden**: si
    // escribiera, estaría de nuevo salteando la emisión.
    adjustmentPercent = -10;
    const res = await venderMostrador(ventaValida({ method: "card_manual" }));
    expect(res.ok).toBe(true);
    expect(orderUpdates).toHaveLength(0);
  });

  it("si el pago entró pero la orden no cerró, no la cierra en silencio", async () => {
    // Ese estado ya no debería pasar. Si pasa, es un síntoma de algo roto y hay
    // que verlo — no taparlo cerrando la orden por afuera, que es como se
    // escondió la falta de comprobante durante meses.
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    registrarPagoMock.mockResolvedValue({
      ok: true as const,
      data: { payment: { id: "p1" }, splitDone: false, orderClosed: false },
    });

    const res = await venderMostrador(ventaValida());

    expect(res.ok).toBe(true);
    expect(orderUpdates).toHaveLength(0);
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it("si ya cerró por la RPC, no la vuelve a cerrar", async () => {
    await venderMostrador(ventaValida());
    expect(orderUpdates).toHaveLength(0);
  });

  it("si ya hay un pago con ese requestId, no crea una segunda venta", async () => {
    // issue #263 — el doble «Confirmar». `request_id` hacía idempotente el
    // COBRO pero no la VENTA: se creaba una orden nueva con sus ítems y su
    // stock descontado, y recién la RPC devolvía el pago viejo. Esa segunda
    // orden quedaba `dine_in` sin mesa: invisible en el board, en el plano y en
    // las cuentas abiertas, y contada igual en la analítica.
    pagoPrevio = { id: "pago-viejo", order_id: "orden-vieja", amount_cents: 10_000 };

    const res = await venderMostrador(
      ventaValida({ request_id: "22222222-2222-4222-8222-222222222222" }),
    );

    expect(res.ok).toBe(true);
    expect(res.ok && res.data.order_id).toBe("orden-vieja");
    expect(res.ok && res.data.cobrado_cents).toBe(10_000);
    // Lo que importa: no se creó nada nuevo ni se volvió a cobrar.
    expect(persistOrderMock).not.toHaveBeenCalled();
    expect(registrarPagoMock).not.toHaveBeenCalled();
  });

  it("si no se puede leer el total, no cobra $0: cancela y avisa", async () => {
    // issue #263 — el error del SELECT se descartaba y el `?? 0` convertía «no
    // pude leer» en «no se debe nada»: se cobraba $0, la venta se cerraba, la
    // mercadería salía y el stock quedaba descontado.
    orderTotalCents = null as unknown as number;

    const res = await venderMostrador(ventaValida());

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/no se cobró nada/i);
    expect(registrarPagoMock).not.toHaveBeenCalled();
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
