import { beforeEach, describe, expect, it, vi } from "vitest";

// El GET hace pull de comandas `pendiente` con su `printer_ip` por sector (spec
// 28). El POST confirma la impresión (`ok` → en_preparacion) o reporta un fallo
// (`failed` → setea print_failed_at + notifica, una sola vez — spec 33).
// Mockeamos el service client (query-builder + update) y `notifyPrintFailed`.

type Row = Record<string, unknown>;
let rows: Row[]; // filas del GET
let itemRows: Row[]; // `order_items` del pedido → bloque «COMBINA CON» del ticket
let postRow: Row | null; // fila del select del POST (maybeSingle)
let captured: { updates: Record<string, unknown>[]; orFilters: string[] };
let notifyCalls: { businessId: string; comandaId: string }[];

vi.mock("@/lib/notifications/events", () => ({
  notifyPrintFailed: async (p: { businessId: string; comandaId: string }) => {
    notifyCalls.push(p);
  },
}));

// Key por-negocio (la global se retiró, security review #4): biz1 usa "test-key".
vi.mock("@/lib/print-agent/credentials", () => ({
  getPrintAgentKey: async (businessId: string) =>
    ((({ biz1: "test-key", biz2: "key-biz2" }) as Record<string, string>)[
      businessId
    ]) ?? null,
}));

vi.mock("@/lib/supabase/service", () => ({
  createSupabaseServiceClient: () => ({
    from: (table: string) => ({
      select: () => {
        const b = {
          eq: () => b,
          in: () => b,
          is: () => b,
          not: () => b,
          neq: () => b,
          or: (filter: string) => {
            captured.orFilters.push(filter);
            return b;
          },
          order: () => b,
          maybeSingle: async () => ({ data: postRow }),
          then: (resolve: (v: { data: Row[]; error: null }) => unknown) =>
            resolve({
              data: table === "order_items" ? itemRows : rows,
              error: null,
            }),
        };
        return b;
      },
      update: (vals: Record<string, unknown>) => ({
        eq: () => {
          captured.updates.push(vals);
          return Promise.resolve({ error: null });
        },
      }),
    }),
  }),
}));

const { GET, POST } = await import("./route");

/**
 * Una comanda real SIEMPRE viaja con al menos un item (`createComandasForItems`
 * no crea comandas vacías). El fixture lo refleja; una fila con
 * `comanda_items: []` representa una comanda a medio crear — ver el test de la
 * ventana de carrera con el print-agent.
 */
const unItem = () => [
  {
    order_item_id: "oi-1",
    order_items: {
      id: "oi-1",
      quantity: 2,
      notes: null,
      unit_price_cents: 1000,
      products: { name: "Ensalada Queso Azul" },
      order_item_modifiers: [],
    },
  },
];

function makeRow(
  name: string,
  printerIp: string | null,
  extra: Partial<Row> = {},
): Row {
  return {
    id: `c-${name}`,
    station_id: `st-${name}`,
    batch: 1,
    status: "pendiente",
    emitted_at: "2026-01-01T00:00:00Z",
    cancelled_at: null,
    cancelled_reason: null,
    ...extra,
    stations: {
      name,
      printer_ip: printerIp,
      printer_port: 9100,
      printer_enabled: true,
    },
    orders: extra.orders ?? {
      id: "o1",
      business_id: "biz1",
      table_id: "t1",
      delivery_type: "dine_in",
      tables: { label: "Mesa 1" },
    },
    comanda_items: extra.comanda_items ?? unItem(),
  };
}

function getReq(auth = "Bearer test-key") {
  return new Request("http://localhost/api/print-agent?business_id=biz1", {
    headers: auth ? { authorization: auth } : {},
  });
}

function postReq(body: unknown, auth = "Bearer test-key") {
  // `business_id` es obligatorio en el POST; los tests operan sobre biz1, así que
  // lo inyectamos por defecto cuando el body no lo trae. Un test que necesite
  // probar mismatch/ausencia pasa el `business_id` explícito (o arma su Request).
  const merged =
    body && typeof body === "object" && !Array.isArray(body) && !("business_id" in body)
      ? { business_id: "biz1", ...(body as object) }
      : body;
  return new Request("http://localhost/api/print-agent", {
    method: "POST",
    headers: auth
      ? { authorization: auth, "content-type": "application/json" }
      : { "content-type": "application/json" },
    body: JSON.stringify(merged),
  });
}

beforeEach(() => {
  process.env.PRINT_AGENT_KEY = "test-key";
  rows = [makeRow("Cocina", "192.168.10.50"), makeRow("Bar", null)];
  itemRows = [];
  postRow = null;
  captured = { updates: [], orFilters: [] };
  notifyCalls = [];
});

describe("GET /api/print-agent — printer_ip por comanda (spec 28)", () => {
  it("incluye printer_ip/printer_port del sector en cada comanda", async () => {
    const res = await GET(getReq());
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      comandas: { station_name: string; printer_ip: string | null; printer_port: number }[];
    };
    const cocina = body.comandas.find((c) => c.station_name === "Cocina");
    expect(cocina?.printer_ip).toBe("192.168.10.50");
    expect(cocina?.printer_port).toBe(9100);
  });

  it("sector sin IP configurada → printer_ip null (no se pierde la comanda)", async () => {
    const res = await GET(getReq());
    const body = (await res.json()) as {
      comandas: { station_name: string; printer_ip: string | null }[];
    };
    const bar = body.comandas.find((c) => c.station_name === "Bar");
    expect(bar?.printer_ip).toBeNull();
  });

  it("incluye las comandas con reimpresión pedida, no solo las pendiente (spec 35)", async () => {
    // El filtro del GET debe ser `status=pendiente OR reprint_requested_at not null`
    // para que una comanda ya avanzada con reimpresión pedida llegue al agente.
    await GET(getReq());
    expect(captured.orFilters).toHaveLength(1);
    expect(captured.orFilters[0]).toContain("status.eq.pendiente");
    expect(captured.orFilters[0]).toContain("reprint_requested_at.not.is.null");
  });

  it("comanda anulada → payload con cancelled:true + motivo (spec 049)", async () => {
    rows = [
      makeRow("Cocina", "192.168.10.50", {
        cancelled_at: "2026-07-17T00:00:00Z",
        cancelled_reason: "Mesa se levantó",
      }),
      makeRow("Bar", null),
    ];
    const res = await GET(getReq());
    const body = (await res.json()) as {
      comandas: {
        station_name: string;
        cancelled: boolean;
        cancelled_reason: string | null;
      }[];
    };
    const cocina = body.comandas.find((c) => c.station_name === "Cocina");
    expect(cocina?.cancelled).toBe(true);
    expect(cocina?.cancelled_reason).toBe("Mesa se levantó");
    const bar = body.comandas.find((c) => c.station_name === "Bar");
    expect(bar?.cancelled).toBe(false);
  });

  it("sanea bytes de control ESC/POS del texto del ticket (security review #8)", async () => {
    rows = [
      makeRow("Cocina", "192.168.10.50", {
        cancelled_at: "2026-07-17T00:00:00Z",
        cancelled_reason: "corte\x1b\x1d\x00papel",
      }),
    ];
    const res = await GET(getReq());
    const body = (await res.json()) as {
      comandas: { cancelled_reason: string | null }[];
    };
    expect(body.comandas[0]?.cancelled_reason).toBe("cortepapel");
  });

  it("comanda con reimpresión pedida → payload con reprint:true (spec 35)", async () => {
    rows = [
      makeRow("Cocina", "192.168.10.50", {
        status: "en_preparacion",
        reprint_requested_at: "2026-07-20T00:00:00Z",
      }),
      makeRow("Bar", null),
    ];
    const res = await GET(getReq());
    const body = (await res.json()) as {
      comandas: { station_name: string; reprint: boolean }[];
    };
    const cocina = body.comandas.find((c) => c.station_name === "Cocina");
    expect(cocina?.reprint).toBe(true);
    const bar = body.comandas.find((c) => c.station_name === "Bar");
    expect(bar?.reprint).toBe(false);
  });

  it("incluye el ticket pre-renderizado por el server (spec 051): content_escpos_b64 + content_plain, aditivo", async () => {
    const res = await GET(getReq());
    const body = (await res.json()) as {
      comandas: {
        station_name: string;
        items: unknown[];
        cancelled: boolean;
        reprint: boolean;
        content_escpos_b64: string;
        content_plain: string;
      }[];
    };
    const cocina = body.comandas.find((c) => c.station_name === "Cocina");
    // Campos nuevos presentes...
    expect(typeof cocina?.content_escpos_b64).toBe("string");
    expect(cocina!.content_escpos_b64.length).toBeGreaterThan(0);
    // ...y el base64 decodifica (latin1) a un stream ESC/POS con el contenido.
    const escpos = Buffer.from(cocina!.content_escpos_b64, "base64").toString("latin1");
    expect(escpos.startsWith("\x1b@")).toBe(true); // init ESC @
    expect(escpos).toContain("COCINA");
    expect(cocina?.content_plain).toContain("COCINA");
    // El nombre se corta por palabra a 11 col (doble ancho), así que se busca
    // el arranque de la línea del item, no el nombre entero.
    expect(cocina?.content_plain).toContain("2x Ensalada");
    // El payload estructurado viejo sigue intacto (aditivo → un agente viejo lo usa).
    expect(cocina?.station_name).toBe("Cocina");
    expect(cocina?.items).toHaveLength(1);
    expect(cocina?.cancelled).toBe(false);
    expect(cocina?.reprint).toBe(false);
  });

  it("con qué combina: lista los items del MISMO pedido que salen de otros sectores", async () => {
    rows = [makeRow("Cocina", "192.168.10.50")];
    itemRows = [
      // El item propio del sector no se repite en el bloque.
      {
        order_id: "o1",
        quantity: 2,
        product_name: "Ensalada Queso Azul",
        station_id: "st-Cocina",
        stations: { name: "Cocina" },
      },
      {
        order_id: "o1",
        quantity: 1,
        product_name: "Entrecot",
        station_id: "st-Parrilla",
        stations: { name: "Parrilla" },
      },
      {
        order_id: "o1",
        quantity: 1,
        product_name: "Papas Rejilla",
        station_id: "st-Fritera",
        stations: { name: "Fritera" },
      },
    ];
    const res = await GET(getReq());
    const body = (await res.json()) as {
      comandas: {
        otros_sectores: { station_name: string; items: { product_name: string }[] }[];
        content_plain: string;
      }[];
    };
    const cocina = body.comandas[0]!;
    expect(cocina.otros_sectores.map((s) => s.station_name)).toEqual([
      "Parrilla",
      "Fritera",
    ]);
    expect(cocina.content_plain).toContain("COMBINA CON");
    expect(cocina.content_plain).toContain("PARRILLA");
    expect(cocina.content_plain).toContain("- 1x Entrecot");
    // Lo propio del sector no se duplica abajo.
    expect(cocina.otros_sectores.flatMap((s) => s.items.map((i) => i.product_name)))
      .not.toContain("Ensalada Queso Azul");
  });

  it("comanda de delivery → el ticket dice DELIVERY y el repartidor, no «MESA —»", async () => {
    rows = [
      makeRow("Cocina", "192.168.10.50", {
        orders: {
          id: "o1",
          business_id: "biz1",
          table_id: null,
          delivery_type: "delivery",
          tables: null,
        },
      }),
    ];
    const res = await GET(getReq());
    const body = (await res.json()) as {
      comandas: { delivery_type: string; content_plain: string }[];
    };
    const c = body.comandas[0]!;
    expect(c.delivery_type).toBe("delivery");
    expect(c.content_plain).toContain("DELIVERY");
    expect(c.content_plain).toContain("repartidor");
    expect(c.content_plain).not.toContain("MESA");
  });

  it("comanda a medio crear (todavía sin comanda_items) NO se entrega al agente", async () => {
    // `enviarComanda` inserta la comanda y sus links en dos viajes separados; el
    // agente pollea cada 1s y puede levantarla en el medio. Si se la damos, sale
    // un ticket «(sin items)» y el ACK la pasa a `en_preparacion` → cocina nunca
    // ve el pedido. Se saltea: en el próximo poll ya está completa.
    rows = [
      makeRow("Cocina", "192.168.10.50", { comanda_items: [] }),
      makeRow("Bar", "192.168.10.51"),
    ];
    const res = await GET(getReq());
    const body = (await res.json()) as { comandas: { station_name: string }[] };
    expect(body.comandas.map((c) => c.station_name)).toEqual(["Bar"]);
  });

  it("sin Bearer válido → 401", async () => {
    const res = await GET(getReq(""));
    expect(res.status).toBe(401);
  });
});

describe("POST /api/print-agent — confirmación y reporte de fallo (spec 33)", () => {
  it("result:failed sin flag previo → setea print_failed_at, notifica, NO cambia estado", async () => {
    postRow = {
      id: "c1",
      status: "pendiente",
      print_failed_at: null,
      orders: { business_id: "biz1" },
    };
    const res = await POST(postReq({ comanda_id: "c1", result: "failed" }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { notified: boolean };
    expect(body.notified).toBe(true);
    expect(notifyCalls).toEqual([{ businessId: "biz1", comandaId: "c1" }]);
    // setea print_failed_at, no toca status
    expect(captured.updates).toHaveLength(1);
    expect(captured.updates[0]).toHaveProperty("print_failed_at");
    expect(captured.updates[0]).not.toHaveProperty("status");
  });

  it("result:failed con flag ya seteado → dedup, NO re-notifica ni actualiza", async () => {
    postRow = {
      id: "c1",
      status: "pendiente",
      print_failed_at: "2026-01-01T00:00:00Z",
      orders: { business_id: "biz1" },
    };
    const res = await POST(postReq({ comanda_id: "c1", result: "failed" }));
    const body = (await res.json()) as { notified: boolean; alreadyFlagged: boolean };
    expect(body.notified).toBe(false);
    expect(body.alreadyFlagged).toBe(true);
    expect(notifyCalls).toHaveLength(0);
    expect(captured.updates).toHaveLength(0);
  });

  it("result:ok (default) → pendiente → en_preparacion + limpia los flags", async () => {
    postRow = {
      id: "c1",
      status: "pendiente",
      print_failed_at: null,
      reprint_requested_at: null,
      orders: { business_id: "biz1" },
    };
    const res = await POST(postReq({ comanda_id: "c1" }));
    const body = (await res.json()) as { status: string; changed: boolean };
    expect(body.status).toBe("en_preparacion");
    expect(body.changed).toBe(true);
    expect(captured.updates[0]).toMatchObject({
      status: "en_preparacion",
      print_failed_at: null,
      reprint_requested_at: null,
    });
    expect(notifyCalls).toHaveLength(0);
  });

  it("result:ok sobre una comanda `entregado` reimpresa → limpia reprint sin regresar estado (spec 35, R1.3)", async () => {
    postRow = {
      id: "c1",
      status: "entregado",
      print_failed_at: null,
      reprint_requested_at: "2026-07-06T00:00:00Z",
      orders: { business_id: "biz1" },
    };
    const res = await POST(postReq({ comanda_id: "c1" }));
    const body = (await res.json()) as { status: string; changed: boolean };
    // Sigue `entregado`, no vuelve a `en_preparacion`.
    expect(body.status).toBe("entregado");
    expect(body.changed).toBe(false);
    // Limpia el flag de reimpresión (y no toca el status).
    expect(captured.updates).toHaveLength(1);
    expect(captured.updates[0]).toMatchObject({ reprint_requested_at: null });
    expect(captured.updates[0]).not.toHaveProperty("status");
  });

  it("comanda inexistente → 404", async () => {
    postRow = null;
    const res = await POST(postReq({ comanda_id: "nope", result: "failed" }));
    expect(res.status).toBe(404);
  });

  it("sin Bearer válido → 401", async () => {
    const res = await POST(postReq({ comanda_id: "c1" }, ""));
    expect(res.status).toBe(401);
  });

  it("comanda de OTRO negocio → 404 (con key válida de biz2, no toca comanda ajena; security review #4)", async () => {
    // biz2 se autentica con SU key, pero la comanda es de biz1 → ownership 404.
    postRow = {
      id: "c1",
      status: "pendiente",
      print_failed_at: null,
      reprint_requested_at: null,
      orders: { business_id: "biz1" },
    };
    const res = await POST(
      postReq({ comanda_id: "c1", business_id: "biz2" }, "Bearer key-biz2"),
    );
    expect(res.status).toBe(404);
    expect(captured.updates).toHaveLength(0);
  });

  it("sin business_id → 401 (sin negocio no se puede autenticar la key; security review #4)", async () => {
    postRow = {
      id: "c1",
      status: "pendiente",
      print_failed_at: null,
      reprint_requested_at: null,
      orders: { business_id: "biz1" },
    };
    const req = new Request("http://localhost/api/print-agent", {
      method: "POST",
      headers: { authorization: "Bearer test-key", "content-type": "application/json" },
      body: JSON.stringify({ comanda_id: "c1" }),
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
    expect(captured.updates).toHaveLength(0);
  });
});
