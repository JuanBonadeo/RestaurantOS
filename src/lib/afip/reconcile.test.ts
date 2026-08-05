import { beforeEach, describe, expect, it, vi } from "vitest";

import { applyGatewayStatus, reconcilePendingInvoices } from "./reconcile";
import type { AFIPProviderClient } from "./provider";
import type { Invoice, ProviderResult } from "./types";

// Spec 088 (#140) — el cron cierra facturas contra ARCA: toca dinero y estados,
// así que todo lo que sigue fija comportamiento observable, no implementación.
const notifyInvoiceIssued = vi.fn();
vi.mock("@/lib/notifications/invoice-notify", () => ({
  notifyInvoiceIssued: (...args: unknown[]) => notifyInvoiceIssued(...args),
}));
vi.mock("@/lib/supabase/service", () => ({
  createSupabaseServiceClient: () => {
    throw new Error("los tests inyectan el service client");
  },
}));

function invoice(over: Partial<Invoice> = {}): Invoice {
  return {
    id: "inv-1",
    business_id: "biz-1",
    order_id: "ord-1",
    payment_id: null,
    tipo_comprobante: "factura_b",
    punto_venta: 1,
    numero: null,
    cae: null,
    cae_vencimiento: null,
    cuit_receptor: null,
    razon_social_receptor: null,
    condicion_iva_receptor: null,
    total_cents: 350_000,
    neto_cents: 289_256,
    iva_cents: 60_744,
    iva_rate: 21,
    status: "pending",
    error_message: null,
    idempotency_key: "ord-1:factura_b",
    pdf_url: null,
    qr_url: null,
    provider: "gateway",
    provider_job_id: "job-1",
    provider_response: null,
    created_at: "2026-08-04T23:00:00Z",
    cancelled_reason: null,
    ...over,
  } as Invoice;
}

function providerWith(result: ProviderResult | Error): AFIPProviderClient {
  return {
    enqueue: vi.fn(),
    getStatus: vi.fn(async () => {
      if (result instanceof Error) throw result;
      return result;
    }),
  } as unknown as AFIPProviderClient;
}

const AUTHORIZED: ProviderResult = {
  success: true,
  state: "authorized",
  cae: "75123456789012",
  caeVencimiento: "2026-08-20",
  numero: 42,
  qrUrl: "https://arca/qr",
  jobId: "job-1",
} as ProviderResult;

const FAILED: ProviderResult = {
  success: false,
  state: "failed",
  errorType: "validation",
  error: "El certificado no está autorizado para el servicio wsfe en ARCA.",
  jobId: "job-1",
} as ProviderResult;

const PENDING: ProviderResult = {
  success: true,
  state: "pending",
  jobId: "job-1",
} as ProviderResult;

/** Lo que devuelve `gateway.ts` ante un 404: `failed` pero con errorType
 *  `not_found`. NO es un desenlace fiscal — ver el test de abajo. */
const NOT_FOUND: ProviderResult = {
  success: false,
  state: "failed",
  errorType: "not_found",
  error: "HTTP 404 consultando el estado.",
} as ProviderResult;

/** Service client de mentira: registra los updates y devuelve lo que se le diga. */
function fakeService(opts: {
  updateReturns?: Invoice | null;
  fresh?: Invoice;
  fresh_?: never;
  rows?: { fresh: Invoice[]; stale: Invoice[] };
}) {
  const updates: Record<string, unknown>[] = [];
  const selects: { table: string; filters: Record<string, unknown> }[] = [];
  let selectCall = 0;
  // El resultado del UPDATE se consume una sola vez: la relectura posterior
  // (cuando el update no devolvió fila) tiene que ver la fila fresca.
  let updatePendiente = false;

  const service = {
    from(table: string) {
      const filters: Record<string, unknown> = {};
      const chain: Record<string, unknown> = {
        select() {
          selects.push({ table, filters });
          return chain;
        },
        update(patch: Record<string, unknown>) {
          updates.push(patch);
          updatePendiente = true;
          return chain;
        },
        eq(col: string, val: unknown) {
          filters[col] = val;
          return chain;
        },
        not() {
          return chain;
        },
        gte() {
          return chain;
        },
        lt() {
          return chain;
        },
        order() {
          return chain;
        },
        limit() {
          // Barrido: primer llamada = lote fresco, segunda = lote viejo.
          const batch = selectCall === 0 ? opts.rows?.fresh : opts.rows?.stale;
          selectCall += 1;
          return Promise.resolve({ data: batch ?? [], error: null });
        },
        maybeSingle() {
          // Un update encadenado devuelve `updateReturns`; la relectura, `fresh`.
          if (updatePendiente) {
            updatePendiente = false;
            return Promise.resolve({
              data: opts.updateReturns ?? null,
              error: null,
            });
          }
          return Promise.resolve({ data: opts.fresh ?? null, error: null });
        },
        single() {
          return Promise.resolve({ data: opts.fresh ?? null, error: null });
        },
      };
      return chain;
    },
  };
  return { service: service as never, updates, selects };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("applyGatewayStatus", () => {
  it("un job autorizado cierra la factura con su CAE y avisa al cliente", async () => {
    const closed = invoice({
      status: "authorized",
      cae: "75123456789012",
      numero: 42,
    });
    const { service, updates } = fakeService({ updateReturns: closed });

    const r = await applyGatewayStatus(
      service,
      invoice(),
      providerWith(AUTHORIZED),
    );

    expect(r.outcome).toBe("authorized");
    expect(updates[0]).toMatchObject({
      status: "authorized",
      cae: "75123456789012",
      numero: 42,
      cae_vencimiento: "2026-08-20",
      qr_url: "https://arca/qr",
    });
    expect(notifyInvoiceIssued).toHaveBeenCalledWith({ invoiceId: "inv-1" });
  });

  it("un job rechazado por ARCA queda failed con el motivo, sin avisar al cliente", async () => {
    const failed = invoice({
      status: "failed",
      error_message: FAILED.error ?? null,
    });
    const { service, updates } = fakeService({ updateReturns: failed });

    const r = await applyGatewayStatus(service, invoice(), providerWith(FAILED));

    expect(r.outcome).toBe("failed");
    expect(updates[0]).toMatchObject({
      status: "failed",
      error_message: FAILED.error,
    });
    expect(notifyInvoiceIssued).not.toHaveBeenCalled();
  });

  it("mientras el gateway sigue encolando NO se toca la fila", async () => {
    const { service, updates } = fakeService({});

    const r = await applyGatewayStatus(service, invoice(), providerWith(PENDING));

    expect(r.outcome).toBe("pending");
    expect(updates).toHaveLength(0);
  });

  // Lo importante acá: un gateway caído o una credencial rota NO puede
  // convertir facturas vivas en `failed`.
  it("un error de red deja la factura pending, sin escribir nada", async () => {
    const { service, updates } = fakeService({});

    const r = await applyGatewayStatus(
      service,
      invoice(),
      providerWith(new Error("ECONNRESET")),
    );

    expect(r.outcome).toBe("pending");
    expect(updates).toHaveLength(0);
  });

  it("si el poller de la pantalla ganó la carrera, no se pisa ni se avisa dos veces", async () => {
    // El UPDATE condicional no devuelve fila → la cerró el otro camino.
    const yaCerrada = invoice({ status: "authorized", cae: "999" });
    const { service } = fakeService({ updateReturns: null, fresh: yaCerrada });

    const r = await applyGatewayStatus(
      service,
      invoice(),
      providerWith(AUTHORIZED),
    );

    expect(r.invoice.status).toBe("authorized");
    expect(notifyInvoiceIssued).not.toHaveBeenCalled();
  });

  // Un `base_url`/`tenant_slug` desactualizado devuelve 404 en TODA ruta. Si
  // eso cerrara la factura, un backlog entero pasaría a `failed` aunque ARCA
  // le hubiera dado CAE — y `failed` habilita «Reintentar», que reemite con
  // clave nueva: comprobante duplicado.
  it("un 404 del gateway NO cierra la factura: queda pending para revisar", async () => {
    const { service, updates } = fakeService({});

    const r = await applyGatewayStatus(
      service,
      invoice(),
      providerWith(NOT_FOUND),
    );

    expect(r.outcome).toBe("unknown_job");
    expect(r.invoice.status).toBe("pending");
    expect(updates).toHaveLength(0);
  });

  it("una factura sin job del gateway (sandbox) no se consulta", async () => {
    const sinJob = invoice({ provider_job_id: null });
    const provider = providerWith(AUTHORIZED);
    const { service } = fakeService({});

    const r = await applyGatewayStatus(service, sinJob, provider);

    expect(r.outcome).toBe("pending");
    expect(provider.getStatus).not.toHaveBeenCalled();
  });

  it("una factura ya terminal no se vuelve a consultar", async () => {
    const provider = providerWith(AUTHORIZED);
    const { service } = fakeService({});

    await applyGatewayStatus(service, invoice({ status: "failed" }), provider);

    expect(provider.getStatus).not.toHaveBeenCalled();
  });
});

describe("reconcilePendingInvoices", () => {
  it("sin pendientes no consulta al gateway", async () => {
    const { service } = fakeService({ rows: { fresh: [], stale: [] } });
    const resolveProvider = vi.fn();

    const r = await reconcilePendingInvoices({ service, resolveProvider });

    expect(r.considered).toBe(0);
    expect(resolveProvider).not.toHaveBeenCalled();
  });

  it("resuelve el provider UNA vez por negocio, no por factura", async () => {
    const fresh = [
      invoice({ id: "a", business_id: "biz-1" }),
      invoice({ id: "b", business_id: "biz-1" }),
      invoice({ id: "c", business_id: "biz-2" }),
    ];
    const { service } = fakeService({
      rows: { fresh, stale: [] },
      updateReturns: invoice({ status: "authorized" }),
    });
    const resolveProvider = vi.fn(async () => providerWith(AUTHORIZED));

    const r = await reconcilePendingInvoices({ service, resolveProvider });

    expect(r.considered).toBe(3);
    expect(resolveProvider).toHaveBeenCalledTimes(2); // dos negocios
  });

  it("un negocio sin credencial (o sandbox) se saltea sin llamar al gateway", async () => {
    const { service } = fakeService({
      rows: { fresh: [invoice()], stale: [] },
    });
    const resolveProvider = vi.fn(async () => null);

    const r = await reconcilePendingInvoices({ service, resolveProvider });

    expect(r.skipped).toBe(1);
    expect(r.authorized + r.failed + r.stillPending).toBe(0);
  });

  it("cuenta authorized, failed y las que siguen en proceso", async () => {
    const { service } = fakeService({
      rows: { fresh: [invoice()], stale: [] },
      updateReturns: invoice({ status: "authorized" }),
    });
    const r = await reconcilePendingInvoices({
      service,
      resolveProvider: async () => providerWith(AUTHORIZED),
    });
    expect(r).toMatchObject({ considered: 1, authorized: 1, failed: 0 });

    const b = fakeService({
      rows: { fresh: [invoice()], stale: [] },
    });
    const r2 = await reconcilePendingInvoices({
      service: b.service,
      resolveProvider: async () => providerWith(PENDING),
    });
    expect(r2).toMatchObject({ considered: 1, stillPending: 1 });
  });

  // Una pendiente vieja se MIRA pero no se cierra por antigüedad: sin respuesta
  // del gateway no sabemos si tiene CAE, y darla por perdida invita a
  // re-facturarla → comprobante duplicado.
  it("cuenta los 404 aparte, sin tocar las filas", async () => {
    const { service, updates } = fakeService({
      rows: { fresh: [invoice()], stale: [] },
    });

    const r = await reconcilePendingInvoices({
      service,
      resolveProvider: async () => providerWith(NOT_FOUND),
    });

    expect(r.unknownJob).toBe(1);
    expect(r.failed).toBe(0);
    expect(updates).toHaveLength(0);
  });

  it("las viejas se cuentan aparte y no se marcan failed por antigüedad", async () => {
    const vieja = invoice({ id: "old", created_at: "2026-08-01T00:00:00Z" });
    const { service, updates } = fakeService({
      rows: { fresh: [], stale: [vieja] },
    });

    const r = await reconcilePendingInvoices({
      service,
      resolveProvider: async () => providerWith(PENDING),
    });

    expect(r.stale).toBe(1);
    expect(r.considered).toBe(1);
    expect(r.failed).toBe(0);
    expect(updates).toHaveLength(0);
  });
});
