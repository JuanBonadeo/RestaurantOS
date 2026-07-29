// @vitest-environment node
//
// Cobro de una orden SIN mesa (pedido para llevar / delivery del board) contra
// la DB real. Cubre lo que los tests unitarios del formulario no pueden:
//
//  - que el pedido cobre **lo mismo** que la misma cuenta en una mesa cuando el
//    método tiene recargo (SC-005 de la spec 062 — la divergencia que arrastraba
//    desde la spec 054),
//  - que cobrar deje la orden `payment_status: paid` (#95: antes sólo lo escribía
//    el webhook, así que un delivery cobrado en efectivo figuraba impago para
//    siempre),
//  - que la guarda de efectivo viva **también en el server** (#93): la UI la
//    aplica, pero un cliente viejo o un request armado a mano no puede saltearla.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";

config({ path: ".env.local" });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const dbAvailable = Boolean(supabaseUrl && serviceKey);

const TEST_TAG = `test-sinmesa-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

let CURRENT_USER_ID = "";

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({
    auth: {
      getUser: async () => ({
        data: { user: { id: CURRENT_USER_ID } },
        error: null,
      }),
    },
  }),
}));

vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");
  return { ...actual, cache: <T>(fn: T) => fn };
});

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
}));

const { registrarPago } = await import("./cobro-actions");
const { ensureQaBusiness, setQaMethodAdjustment, cleanupQaData } = await import(
  "@/lib/testing/qa-fixture"
);

describe.skipIf(!dbAvailable)("cobro sin mesa (integration)", () => {
  const supabase = createClient(supabaseUrl!, serviceKey!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  let businessId: string;
  let businessSlug: string;
  let encargadoId: string;
  let cajaId: string;
  let floorPlanId: string;

  /** Orden sin `table_id` — el pedido del board. */
  const newPedido = async (total = 10_000) => {
    const { data: order } = await supabase
      .from("orders")
      .insert({
        business_id: businessId,
        customer_name: `${TEST_TAG}-pedido`,
        customer_phone: "-",
        delivery_type: "pickup",
        table_id: null,
        subtotal_cents: total,
        total_cents: total,
        lifecycle_status: "open",
        payment_status: "pending",
      })
      .select("id")
      .single();
    await supabase.from("order_items").insert({
      order_id: order!.id,
      product_name: "Item",
      unit_price_cents: total,
      quantity: 1,
      subtotal_cents: total,
      loaded_by: encargadoId,
    });
    return order!.id as string;
  };

  /** La misma cuenta, pero en una mesa. Sirve de referencia para la paridad. */
  const newMesa = async (label: string, total = 10_000) => {
    const { data: t } = await supabase
      .from("tables")
      .insert({
        floor_plan_id: floorPlanId,
        label: `${TEST_TAG}-${label}`,
        seats: 2,
        shape: "circle",
        x: 0, y: 0, width: 80, height: 80,
        operational_status: "pidio_cuenta",
        opened_at: new Date().toISOString(),
      })
      .select("id")
      .single();
    const { data: order } = await supabase
      .from("orders")
      .insert({
        business_id: businessId,
        customer_name: `${TEST_TAG}-mesa-${label}`,
        customer_phone: "0",
        delivery_type: "dine_in",
        table_id: t!.id,
        subtotal_cents: total,
        total_cents: total,
        lifecycle_status: "open",
        payment_status: "pending",
      })
      .select("id")
      .single();
    await supabase.from("order_items").insert({
      order_id: order!.id,
      product_name: "Item",
      unit_price_cents: total,
      quantity: 1,
      subtotal_cents: total,
      loaded_by: encargadoId,
    });
    return { tableId: t!.id as string, orderId: order!.id as string };
  };

  beforeAll(async () => {
    // Negocio fijo y persistente: se crea la primera vez y después se reutiliza.
    // Antes acá se sembraba un negocio nuevo por corrida — ese setup era el que
    // hacía que estos tests se cayeran por timeout cuando la cloud está lenta.
    const qa = await ensureQaBusiness(supabase);
    businessId = qa.businessId;
    businessSlug = qa.businessSlug;
    encargadoId = qa.encargadoId;
    cajaId = qa.cajaId;
    floorPlanId = qa.floorPlanId;

    // Tarjeta con +10%: es lo que hace visible si un flujo aplica el ajuste.
    await setQaMethodAdjustment(supabase, businessId, "card_manual", 10);
    await setQaMethodAdjustment(supabase, businessId, "cash", 0);

    CURRENT_USER_ID = encargadoId;
  }, 60_000);

  afterAll(async () => {
    // Se limpia lo que creó ESTE archivo; el negocio y sus usuarios quedan.
    await cleanupQaData(supabase, businessId, TEST_TAG);
  }, 60_000);

  it(
    "el pedido sin mesa cobra lo MISMO que la misma cuenta en una mesa (SC-005)",
    { timeout: 30_000 },
    async () => {
      const pedidoId = await newPedido(10_000);
      const { orderId: mesaOrderId } = await newMesa("P1", 10_000);

      // Lo que manda el formulario en ambos casos: el ajuste ya aplicado.
      const pago = {
        method: "card_manual" as const,
        amount_cents: 11_000,
        tip_cents: 0,
        caja_id: cajaId,
        adjustment_percent: 10,
        adjustment_cents: 1_000,
        slug: businessSlug,
      };

      const rPedido = await registrarPago({
        ...pago,
        orderId: pedidoId,
        splitId: null,
        requestId: crypto.randomUUID(),
      });
      const rMesa = await registrarPago({
        ...pago,
        orderId: mesaOrderId,
        splitId: null,
        requestId: crypto.randomUUID(),
      });

      expect(rPedido.ok).toBe(true);
      expect(rMesa.ok).toBe(true);
      if (!rPedido.ok || !rMesa.ok) return;

      const { data: rows } = await supabase
        .from("payments")
        .select("order_id, amount_cents, adjustment_percent, adjustment_cents")
        .in("order_id", [pedidoId, mesaOrderId]);

      const delPedido = rows!.find((r) => r.order_id === pedidoId)!;
      const deLaMesa = rows!.find((r) => r.order_id === mesaOrderId)!;

      expect(delPedido.amount_cents).toBe(deLaMesa.amount_cents);
      expect(Number(delPedido.adjustment_percent)).toBe(
        Number(deLaMesa.adjustment_percent),
      );
      expect(delPedido.adjustment_cents).toBe(deLaMesa.adjustment_cents);
      // Y el valor absoluto, por si ambos estuvieran mal por igual.
      expect(delPedido.amount_cents).toBe(11_000);
      expect(delPedido.adjustment_cents).toBe(1_000);
    },
  );

  it(
    "cobrar deja la orden cerrada Y marcada como pagada (#95)",
    { timeout: 30_000 },
    async () => {
      const pedidoId = await newPedido(8_000);

      const r = await registrarPago({
        orderId: pedidoId,
        splitId: null,
        method: "cash",
        amount_cents: 8_000,
        tip_cents: 0,
        caja_id: cajaId,
        slug: businessSlug,
        requestId: crypto.randomUUID(),
      });
      expect(r.ok).toBe(true);

      const { data: order } = await supabase
        .from("orders")
        .select("lifecycle_status, payment_status, total_paid_cents")
        .eq("id", pedidoId)
        .single();

      expect(order!.lifecycle_status).toBe("closed");
      // Antes de #95 esto quedaba en 'pending' para siempre: el board mostraba
      // "Paga en efectivo" en un pedido ya cobrado.
      expect(order!.payment_status).toBe("paid");
      expect(order!.total_paid_cents).toBe(8_000);
    },
  );

  it(
    "cobrar un pedido no toca ninguna mesa",
    { timeout: 30_000 },
    async () => {
      const { tableId } = await newMesa("P2", 5_000);
      const pedidoId = await newPedido(5_000);

      await registrarPago({
        orderId: pedidoId,
        splitId: null,
        method: "cash",
        amount_cents: 5_000,
        tip_cents: 0,
        caja_id: cajaId,
        slug: businessSlug,
        requestId: crypto.randomUUID(),
      });

      const { data: t } = await supabase
        .from("tables")
        .select("operational_status")
        .eq("id", tableId)
        .single();
      expect(t!.operational_status).toBe("pidio_cuenta");
    },
  );

  it(
    "en efectivo el SERVER rechaza cobrar de menos (#93)",
    { timeout: 30_000 },
    async () => {
      const pedidoId = await newPedido(10_000);

      const r = await registrarPago({
        orderId: pedidoId,
        splitId: null,
        method: "cash",
        amount_cents: 5_000, // falta la mitad
        tip_cents: 0,
        caja_id: cajaId,
        slug: businessSlug,
        requestId: crypto.randomUUID(),
      });

      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(r.error).toMatch(/no se puede cobrar menos/i);

      // Y no dejó rastro: ni pago, ni orden cerrada.
      const { count } = await supabase
        .from("payments")
        .select("id", { count: "exact", head: true })
        .eq("order_id", pedidoId);
      expect(count).toBe(0);
    },
  );

  it(
    "en efectivo de MÁS se acepta — es vuelto (#93)",
    { timeout: 30_000 },
    async () => {
      const pedidoId = await newPedido(10_000);

      const r = await registrarPago({
        orderId: pedidoId,
        splitId: null,
        method: "cash",
        amount_cents: 15_000,
        tip_cents: 0,
        caja_id: cajaId,
        slug: businessSlug,
        requestId: crypto.randomUUID(),
      });
      expect(r.ok).toBe(true);
    },
  );

  it(
    "con descuento por efectivo, pagar el neto NO es cobrar de menos (#93)",
    { timeout: 30_000 },
    async () => {
      // -10% en efectivo: una cuenta de 10.000 se salda con 9.000. La guarda
      // compara contra la base sin ajuste, así que esto tiene que pasar.
      await setQaMethodAdjustment(supabase, businessId, "cash", -10);

      const pedidoId = await newPedido(10_000);
      const r = await registrarPago({
        orderId: pedidoId,
        splitId: null,
        method: "cash",
        amount_cents: 9_000,
        tip_cents: 0,
        caja_id: cajaId,
        adjustment_percent: -10,
        adjustment_cents: -1_000,
        slug: businessSlug,
        requestId: crypto.randomUUID(),
      });

      expect(r.ok).toBe(true);

      await setQaMethodAdjustment(supabase, businessId, "cash", 0);
    },
  );
});
