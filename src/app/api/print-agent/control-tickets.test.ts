import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Spec 063 — el control de pedido viajando por el endpoint del print-agent.
 *
 * Lo que se protege acá es el contrato con el agente **instalado en el local**:
 * los controles salen en el mismo array `comandas` y se confirman con el mismo
 * `comanda_id`, para que no haya que recompilar ni reinstalar el .exe.
 */

type Row = Record<string, unknown>;

let businessRow: Row | null;
let controlRows: Row[];
let controlPostRow: Row | null;
let captured: { updates: { table: string; vals: Record<string, unknown> }[] };

vi.mock("@/lib/notifications/events", () => ({
  notifyPrintFailed: async () => {},
}));

vi.mock("@/lib/print-agent/credentials", () => ({
  getPrintAgentKey: async (businessId: string) =>
    businessId === "biz1" ? "test-key" : null,
}));

// Mock consciente de la tabla: las comandas de cocina quedan vacías para aislar
// el camino del control.
vi.mock("@/lib/supabase/service", () => ({
  createSupabaseServiceClient: () => ({
    from: (table: string) => ({
      select: () => {
        // El mock tiene que distinguir por `kind`: desde spec 084 el GET
        // consulta `print_jobs` tres veces (control / cuenta / factura) y sin
        // esto las filas de control se colarían por las otras dos ramas.
        let kind: string | null = null;
        const b = {
          eq: (col: string, val: unknown) => {
            if (col === "kind") kind = String(val);
            return b;
          },
          or: () => b,
          order: () => b,
          maybeSingle: async () => ({
            data:
              table === "businesses"
                ? businessRow
                : table === "print_jobs"
                  ? controlPostRow
                  : // `comandas` siempre vacía: el POST tiene que caer al
                    // camino de print_jobs, que es lo que se está probando.
                    null,
          }),
          then: (resolve: (v: { data: Row[]; error: null }) => unknown) =>
            resolve({
              data:
                table === "print_jobs" && kind === "control" ? controlRows : [],
              error: null,
            }),
        };
        return b;
      },
      update: (vals: Record<string, unknown>) => ({
        eq: () => {
          captured.updates.push({ table, vals });
          return Promise.resolve({ error: null });
        },
      }),
    }),
  }),
}));

const { GET, POST } = await import("./route");

const AUTH = { authorization: "Bearer test-key" };

function getReq() {
  return new Request("http://x/api/print-agent?business_id=biz1", {
    headers: AUTH,
  });
}

function postReq(body: Record<string, unknown>) {
  return new Request("http://x/api/print-agent", {
    method: "POST",
    headers: { ...AUTH, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function ticket(over: Row = {}): Row {
  return {
    id: "ct1",
    status: "pendiente",
    emitted_at: "2026-07-28T19:16:00-03:00",
    reprint_requested_at: null,
    orders: {
      order_number: 123,
      delivery_type: "delivery",
      customer_name: "Rodrigo",
      customer_phone: "341 555 1234",
      delivery_address: "Oroño 1234",
      delivery_notes: null,
      subtotal_cents: 11050000,
      delivery_fee_cents: 150000,
      discount_cents: 0,
      total_cents: 11200000,
      payment_method: "cash",
      payment_status: "pending",
      scheduled_at: null,
      order_items: [
        {
          quantity: 2,
          unit_price_cents: 3300000,
          notes: null,
          cancelled_at: null,
          products: { name: "Brochette de lomo" },
          order_item_modifiers: [],
        },
      ],
    },
    ...over,
  };
}

beforeEach(() => {
  businessRow = {
    name: "Restaurant del Golf",
    address: "Bv. Wilde",
    phone: "0341-15",
    control_printer_ip: "192.168.10.60",
    control_printer_port: 9100,
    control_printer_enabled: true,
  };
  controlRows = [ticket()];
  controlPostRow = null;
  captured = { updates: [] };
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("GET · controles de pedido", () => {
  it("sale en el mismo array que las comandas, con la IP de control", async () => {
    const body = await (await GET(getReq())).json();
    expect(body.comandas).toHaveLength(1);
    const c = body.comandas[0];
    expect(c.comanda_id).toBe("ct1");
    expect(c.station_name).toBe("CONTROL");
    expect(c.printer_ip).toBe("192.168.10.60");
    expect(c.printer_port).toBe(9100);
    // El agente imprime bytes pre-renderizados: si faltan, no imprime nada.
    expect(typeof c.content_escpos_b64).toBe("string");
    expect(c.content_escpos_b64.length).toBeGreaterThan(0);
  });

  it("el contenido dice cuánto cobrar", async () => {
    const body = await (await GET(getReq())).json();
    expect(body.comandas[0].content_plain).toContain("A COBRAR:");
    expect(body.comandas[0].content_plain).toContain("112000.00");
  });

  it("no sale si el negocio no tiene comandera de control", async () => {
    businessRow = { ...businessRow!, control_printer_ip: null };
    const body = await (await GET(getReq())).json();
    expect(body.comandas).toEqual([]);
  });

  it("no sale si la comandera está apagada", async () => {
    businessRow = { ...businessRow!, control_printer_enabled: false };
    const body = await (await GET(getReq())).json();
    expect(body.comandas).toEqual([]);
  });

  it("no imprime ítems anulados", async () => {
    const t = ticket();
    (t.orders as Row).order_items = [
      {
        quantity: 1,
        unit_price_cents: 100000,
        notes: null,
        cancelled_at: "2026-07-28T19:20:00-03:00",
        products: { name: "Anulado" },
        order_item_modifiers: [],
      },
    ];
    controlRows = [t];
    const body = await (await GET(getReq())).json();
    expect(body.comandas[0].content_plain).not.toContain("Anulado");
    expect(body.comandas[0].content_plain).toContain("(sin items)");
  });
});

describe("POST · confirmación de un control", () => {
  it("`ok` lo marca impreso y limpia los flags", async () => {
    controlPostRow = {
      business_id: "biz1",
      status: "pendiente",
      print_failed_at: null,
      reprint_requested_at: null,
    };
    const res = await POST(postReq({ comanda_id: "ct1", business_id: "biz1" }));
    expect(await res.json()).toEqual({ status: "impreso", changed: true });
    const upd = captured.updates.find((u) => u.table === "print_jobs");
    expect(upd?.vals).toMatchObject({
      status: "impreso",
      print_failed_at: null,
      reprint_requested_at: null,
    });
  });

  it("`failed` marca el fallo sin cambiar el estado (se reintenta)", async () => {
    controlPostRow = {
      business_id: "biz1",
      status: "pendiente",
      print_failed_at: null,
      reprint_requested_at: null,
    };
    const res = await POST(
      postReq({ comanda_id: "ct1", business_id: "biz1", result: "failed" }),
    );
    expect(await res.json()).toMatchObject({ status: "pendiente" });
    const upd = captured.updates.find((u) => u.table === "print_jobs");
    expect(Object.keys(upd!.vals)).toEqual(["print_failed_at"]);
  });

  it("un `failed` repetido no vuelve a marcar (dedup)", async () => {
    controlPostRow = {
      business_id: "biz1",
      status: "pendiente",
      print_failed_at: "2026-07-28T19:20:00-03:00",
      reprint_requested_at: null,
    };
    const res = await POST(
      postReq({ comanda_id: "ct1", business_id: "biz1", result: "failed" }),
    );
    expect(await res.json()).toMatchObject({ alreadyFlagged: true });
    expect(captured.updates).toEqual([]);
  });

  it("un control de OTRO negocio da 404 y no se toca", async () => {
    controlPostRow = {
      business_id: "biz2",
      status: "pendiente",
      print_failed_at: null,
      reprint_requested_at: null,
    };
    const res = await POST(postReq({ comanda_id: "ct1", business_id: "biz1" }));
    expect(res.status).toBe(404);
    expect(captured.updates).toEqual([]);
  });

  it("un id que no es ni comanda ni control da 404", async () => {
    controlPostRow = null;
    const res = await POST(postReq({ comanda_id: "nope", business_id: "biz1" }));
    expect(res.status).toBe(404);
  });
});
