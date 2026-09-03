import { beforeEach, describe, expect, it, vi } from "vitest";

// Spec 147 (#223) — cobrar una mesa emite el comprobante. Lo que se fija acá
// son los gates: automatizar la emisión es exactamente donde un descuido se
// multiplica por mesa, así que cada "no emitir" tiene su test.
const emitInvoiceCore = vi.fn();
vi.mock("./emit-core", () => ({
  emitInvoiceCore: (...args: unknown[]) => emitInvoiceCore(...args),
}));

import { autoEmitInvoiceForOrder } from "./auto-emit";

type BizRow = {
  afip_auto_emit: boolean;
  afip_cuit: string | null;
  afip_punto_venta: number | null;
};

const BIZ_OK: BizRow = {
  afip_auto_emit: true,
  afip_cuit: "30712345678",
  afip_punto_venta: 1,
};

/** Service client de mentira: una fila de `businesses`, N de `invoices`. */
function fakeService(opts: { biz: BizRow | null; invoicesVivas?: number }) {
  const service = {
    from(table: string) {
      const chain: Record<string, unknown> = {
        select: () => chain,
        eq: () => chain,
        in: () => chain,
        maybeSingle: () =>
          Promise.resolve({
            data: table === "businesses" ? opts.biz : null,
            error: null,
          }),
        limit: () =>
          Promise.resolve({
            data: Array.from({ length: opts.invoicesVivas ?? 0 }, (_, i) => ({
              id: `inv-${i}`,
            })),
            error: null,
          }),
      };
      return chain;
    },
  };
  return service as never;
}

const ORDER = { id: "ord-1", total_cents: 350_000, tip_cents: 0 };

function run(service: never, order = ORDER) {
  return autoEmitInvoiceForOrder({
    service,
    businessId: "biz-1",
    slug: "demo",
    order,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  emitInvoiceCore.mockResolvedValue({ ok: true, data: { invoice: { id: "i" } } });
});

describe("autoEmitInvoiceForOrder", () => {
  it("con el flag apagado no encola nada — todo funciona como hoy", async () => {
    const service = fakeService({ biz: { ...BIZ_OK, afip_auto_emit: false } });

    expect(await run(service)).toBe("off");
    expect(emitInvoiceCore).not.toHaveBeenCalled();
  });

  it("sin AFIP configurado el flag no hace nada", async () => {
    const service = fakeService({
      biz: { afip_auto_emit: true, afip_cuit: null, afip_punto_venta: null },
    });

    expect(await run(service)).toBe("sin-afip");
    expect(emitInvoiceCore).not.toHaveBeenCalled();
  });

  it("una cuenta que es toda propina no tiene base imponible que declarar", async () => {
    const service = fakeService({ biz: BIZ_OK });

    const r = await run(service, {
      id: "ord-1",
      total_cents: 5_000,
      tip_cents: 5_000,
    });

    expect(r).toBe("sin-base");
    expect(emitInvoiceCore).not.toHaveBeenCalled();
  });

  it("una orden que ya tiene comprobante vivo no encola una segunda (D5)", async () => {
    const service = fakeService({ biz: BIZ_OK, invoicesVivas: 1 });

    expect(await run(service)).toBe("ya-tiene");
    expect(emitInvoiceCore).not.toHaveBeenCalled();
  });

  it("encola una Factura B marcada como automática, con la clave del motor", async () => {
    const service = fakeService({ biz: BIZ_OK });

    expect(await run(service)).toBe("encolada");
    expect(emitInvoiceCore).toHaveBeenCalledTimes(1);
    const [businessId, input, opts] = emitInvoiceCore.mock.calls[0];
    expect(businessId).toBe("biz-1");
    expect(input).toEqual({
      orderId: "ord-1",
      slug: "demo",
      tipoComprobante: "factura_b",
    });
    // Sin CUIT ni condición: la A necesita datos que nadie tipeó (D4).
    expect(input.cuitReceptor).toBeUndefined();
    // Sin `idempotencyKey` propia: el default del motor la deriva del order_id,
    // que es lo que impide el duplicado (la del gateway es por job, spec 088).
    expect(input.idempotencyKey).toBeUndefined();
    expect(opts).toEqual({ auto: true });
  });

  it("un rechazo del gateway se reporta, no se traga", async () => {
    emitInvoiceCore.mockResolvedValue({ ok: false, error: "PV no dado de alta" });
    const service = fakeService({ biz: BIZ_OK });

    expect(await run(service)).toBe("rechazada");
  });
});
