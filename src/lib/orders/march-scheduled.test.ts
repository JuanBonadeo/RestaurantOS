import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Spec 061 — la marcha automática con lead por negocio.
 *
 * Dos cosas que este test protege y que no se ven a simple vista:
 *  1. **Qué trae la query.** El `.or()` es la traducción literal de la política
 *     de spec 047 ("imprime solo lo que el local ya avaló"). Si alguien lo
 *     ablanda, un pedido en efectivo sin aceptar entra a cocina solo.
 *  2. **Qué se marcha de lo que trajo.** El `lte` del SQL es a propósito ancho
 *     (el techo del lead configurable); el corte fino es en TS, por pedido.
 */

type DueRow = {
  id: string;
  business_id: string;
  delivery_type: string;
  scheduled_at: string;
  business: {
    scheduled_march_lead_pickup_min: number | null;
    scheduled_march_lead_delivery_min: number | null;
  } | null;
};

type Captured = {
  select?: string;
  or?: string;
  lte?: [string, string];
  in?: [string, string[]];
};

let rows: DueRow[] = [];
let captured: Captured = {};
const routed: string[] = [];

function makeFakeService() {
  return {
    from() {
      const builder = {
        select(cols: string) {
          captured.select = cols;
          return builder;
        },
        not() {
          return builder;
        },
        in(col: string, vals: string[]) {
          captured.in = [col, vals];
          return builder;
        },
        or(expr: string) {
          captured.or = expr;
          return builder;
        },
        lte(col: string, val: string) {
          captured.lte = [col, val];
          return builder;
        },
        then(resolve: (v: { data: unknown }) => void) {
          resolve({ data: rows });
        },
      };
      return builder;
    },
  };
}

vi.mock("@/lib/supabase/service", () => ({
  createSupabaseServiceClient: () => makeFakeService(),
}));

vi.mock("./route-to-cocina", () => ({
  routeOrderToCocina: async (orderId: string) => {
    routed.push(orderId);
    return { ok: true, data: { order_id: orderId, comanda_ids: ["c1"], items_without_station: 0 } };
  },
}));

const { marchDueScheduledOrders } = await import("./march-scheduled");

// Reloj de referencia: 2026-06-26 20:00 AR.
const NOW = new Date("2026-06-26T20:00:00-03:00");

function row(o: Partial<DueRow> & Pick<DueRow, "id" | "scheduled_at">): DueRow {
  return {
    business_id: "b1",
    delivery_type: "delivery",
    business: {
      scheduled_march_lead_pickup_min: 40,
      scheduled_march_lead_delivery_min: 60,
    },
    ...o,
  };
}

describe("marchDueScheduledOrders", () => {
  beforeEach(() => {
    rows = [];
    captured = {};
    routed.length = 0;
  });

  it("solo pide pagados-sin-tocar o aceptados (política de spec 047)", async () => {
    await marchDueScheduledOrders(NOW);
    expect(captured.or).toBe(
      "and(status.eq.pending,payment_status.eq.paid),status.eq.confirmed",
    );
    // Un `pending` impago no matchea ninguna de las dos ramas.
    expect(captured.or).not.toContain("status.eq.pending,payment_status.eq.pending");
  });

  it("no trae pedidos en mesa y acota la ventana con el techo del lead", async () => {
    await marchDueScheduledOrders(NOW);
    expect(captured.in).toEqual(["delivery_type", ["pickup", "delivery"]]);
    const [col, cutoff] = captured.lte!;
    expect(col).toBe("scheduled_at");
    // 240 min = MAX_MARCH_LEAD_MIN.
    expect(new Date(cutoff).getTime() - NOW.getTime()).toBe(240 * 60_000);
  });

  it("trae los dos leads del negocio en el join", async () => {
    await marchDueScheduledOrders(NOW);
    expect(captured.select).toContain("scheduled_march_lead_pickup_min");
    expect(captured.select).toContain("scheduled_march_lead_delivery_min");
  });

  it("un delivery con lead 60 marcha a T−60 pero no a T−61", async () => {
    // T = 21:00. A las 20:00 faltan exactamente 60 → marcha.
    rows = [row({ id: "justo", scheduled_at: "2026-06-26T21:00:00-03:00" })];
    expect((await marchDueScheduledOrders(NOW)).marched).toBe(1);

    routed.length = 0;
    // T = 21:01 → faltan 61 → todavía no.
    rows = [row({ id: "temprano", scheduled_at: "2026-06-26T21:01:00-03:00" })];
    const res = await marchDueScheduledOrders(NOW);
    expect(res.marched).toBe(0);
    expect(res.considered).toBe(0);
  });

  it("en el mismo tick, retiro y delivery cortan distinto", async () => {
    // Los dos para las 20:50 (faltan 50 min). Delivery (lead 60) entra; retiro
    // (lead 40) todavía no.
    rows = [
      row({ id: "del", scheduled_at: "2026-06-26T20:50:00-03:00" }),
      row({
        id: "pick",
        delivery_type: "pickup",
        scheduled_at: "2026-06-26T20:50:00-03:00",
      }),
    ];
    await marchDueScheduledOrders(NOW);
    expect(routed).toEqual(["del"]);
  });

  it("dos negocios con leads distintos se resuelven cada uno con el suyo", async () => {
    rows = [
      row({
        id: "house",
        scheduled_at: "2026-06-26T21:30:00-03:00",
        business: {
          scheduled_march_lead_pickup_min: 40,
          scheduled_march_lead_delivery_min: 90, // faltan 90 → justo entra
        },
      }),
      row({
        id: "golf",
        business_id: "b2",
        scheduled_at: "2026-06-26T21:30:00-03:00",
        business: {
          scheduled_march_lead_pickup_min: 40,
          scheduled_march_lead_delivery_min: 60, // faltan 90 > 60 → no
        },
      }),
    ];
    await marchDueScheduledOrders(NOW);
    expect(routed).toEqual(["house"]);
  });

  it("`considered` cuenta los que entraron en ventana, no los que trajo la query", async () => {
    rows = [
      row({ id: "entra", scheduled_at: "2026-06-26T20:30:00-03:00" }),
      row({ id: "no-entra", scheduled_at: "2026-06-26T23:00:00-03:00" }),
    ];
    const res = await marchDueScheduledOrders(NOW);
    expect(res).toEqual({ considered: 1, marched: 1, failed: 0 });
  });
});
