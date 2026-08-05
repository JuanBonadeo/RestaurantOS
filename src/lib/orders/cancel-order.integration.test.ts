// @vitest-environment node
//
// Spec 090 — `cancelarOrden` como único write-site de muerte de un pedido.
//
// Contra Postgres real a propósito: lo que se prueba acá son invariantes que
// sólo existen en la base (el trigger de reversión de la 089, los filtros
// `is null` de las escrituras guardadas, el recompute de totales). Un fake los
// daría todos por buenos.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";

import { cancelarOrden } from "./cancel-order";

config({ path: ".env.local" });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const dbAvailable = Boolean(supabaseUrl && serviceKey);

const TEST_TAG = `test-cancelord-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

describe.skipIf(!dbAvailable)("cancelarOrden (integration · spec 090)", () => {
  const supabase = createClient(supabaseUrl!, serviceKey!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  let businessId: string;
  let stationId: string;

  const seedOrder = async (): Promise<string> => {
    const { data, error } = await supabase
      .from("orders")
      .insert({
        order_number: 0,
        business_id: businessId,
        customer_name: "Cancel test",
        customer_phone: "-",
        delivery_type: "dine_in",
        lifecycle_status: "open",
        subtotal_cents: 0,
        delivery_fee_cents: 0,
        total_cents: 0,
        payment_method: "cash",
      })
      .select("id")
      .single();
    if (error) throw error;
    return data!.id as string;
  };

  /** Ítem suelto, sin comanda: el caso de la bebida que el mozo lleva a mano. */
  const seedItem = async (
    orderId: string,
    cents: number,
    withStation: boolean,
  ): Promise<string> => {
    const { data, error } = await supabase
      .from("order_items")
      .insert({
        order_id: orderId,
        product_name: withStation ? "Milanesa" : "Cerveza",
        unit_price_cents: cents,
        quantity: 1,
        subtotal_cents: cents,
        station_id: withStation ? stationId : null,
        kitchen_status: "pending",
      })
      .select("id")
      .single();
    if (error) throw error;
    return data!.id as string;
  };

  const seedComanda = async (
    orderId: string,
    itemId: string,
    status: "pendiente" | "entregado",
    batch = 1,
  ): Promise<string> => {
    const { data, error } = await supabase
      .from("comandas")
      .insert({
        order_id: orderId,
        station_id: stationId,
        batch,
        status,
        delivered_at: status === "entregado" ? new Date().toISOString() : null,
      })
      .select("id")
      .single();
    if (error) throw error;
    const comandaId = data!.id as string;
    await supabase
      .from("comanda_items")
      .insert({ comanda_id: comandaId, order_item_id: itemId });
    return comandaId;
  };

  beforeAll(async () => {
    const { data: biz, error } = await supabase
      .from("businesses")
      .insert({ slug: TEST_TAG, name: "Cancel Test", is_active: true })
      .select("id")
      .single();
    if (error) throw error;
    businessId = biz!.id as string;

    const { data: st } = await supabase
      .from("stations")
      .insert({ business_id: businessId, name: "Cocina" })
      .select("id")
      .single();
    stationId = st!.id as string;
  }, 60_000);

  afterAll(async () => {
    if (businessId) {
      await supabase.from("businesses").delete().eq("id", businessId);
    }
  }, 60_000);

  it("escribe los DOS ejes de estado, no uno solo", async () => {
    // El corazón de la spec: el salón escribía `lifecycle_status` y nunca
    // `status`, el canal online al revés. En el cloud eso dejó 23 mesas
    // anuladas que la analítica seguía contando como venta.
    const orderId = await seedOrder();

    const res = await cancelarOrden(supabase, {
      orderId,
      businessId,
      motivo: "test",
      actorUserId: null,
    });
    expect(res.cancelled).toBe(true);

    const { data: order } = await supabase
      .from("orders")
      .select("status, lifecycle_status, cancelled_at, cancelled_reason")
      .eq("id", orderId)
      .single();
    expect(order!.status).toBe("cancelled");
    expect(order!.lifecycle_status).toBe("cancelled");
    expect(order!.cancelled_at).not.toBeNull();
    expect(order!.cancelled_reason).toBe("test");
  });

  it("cancela los ítems que NUNCA pasaron por una comanda", async () => {
    // El agujero de `anularMesa`: derivaba los ítems a cancelar desde las
    // comandas activas, así que las bebidas (`station_id` null, nunca entran a
    // `comanda_items`) y lo cargado-sin-enviar quedaban vivos. En el cloud
    // quedaron 29 ítems por $606.200 colgando de órdenes canceladas.
    const orderId = await seedOrder();
    const bebida = await seedItem(orderId, 5000, false);
    const plato = await seedItem(orderId, 12000, true);
    await seedComanda(orderId, plato, "pendiente");

    const res = await cancelarOrden(supabase, {
      orderId,
      businessId,
      motivo: "test",
      actorUserId: null,
    });
    expect(res.itemsCancelled).toBe(2);

    const { data: items } = await supabase
      .from("order_items")
      .select("id, cancelled_at")
      .eq("order_id", orderId);
    for (const it of items!) expect(it.cancelled_at).not.toBeNull();
    expect(items!.find((i) => i.id === bebida)!.cancelled_at).not.toBeNull();
  });

  it("anula las comandas activas y encola el ticket ANULADA; respeta las entregadas", async () => {
    const orderId = await seedOrder();
    const itemA = await seedItem(orderId, 1000, true);
    const itemB = await seedItem(orderId, 2000, true);
    const activa = await seedComanda(orderId, itemA, "pendiente");
    const entregada = await seedComanda(orderId, itemB, "entregado", 2);

    const res = await cancelarOrden(supabase, {
      orderId,
      businessId,
      motivo: "test",
      actorUserId: null,
    });
    expect(res.comandasCancelled).toBe(1);

    const { data: cActiva } = await supabase
      .from("comandas")
      .select("cancelled_at, reprint_requested_at")
      .eq("id", activa)
      .single();
    expect(cActiva!.cancelled_at).not.toBeNull();
    expect(cActiva!.reprint_requested_at).not.toBeNull();

    // La comida ya salió: la comanda se respeta (la orden cancelada ya
    // garantiza que no se cobra).
    const { data: cEntregada } = await supabase
      .from("comandas")
      .select("cancelled_at")
      .eq("id", entregada)
      .single();
    expect(cEntregada!.cancelled_at).toBeNull();
  });

  it("recalcula el total: una orden anulada no conserva su importe", async () => {
    // `anularMesa` no recalculaba —a diferencia de `cancelarItem`— así que el
    // `total_cents` completo sobrevivía. Es el número con el que `emitInvoice`
    // facturaba y el que inflaba el denominador del reporte fiscal.
    const orderId = await seedOrder();
    await seedItem(orderId, 8000, false);
    await supabase
      .from("orders")
      .update({ subtotal_cents: 8000, total_cents: 8000 })
      .eq("id", orderId);

    await cancelarOrden(supabase, {
      orderId,
      businessId,
      motivo: "test",
      actorUserId: null,
    });

    const { data: order } = await supabase
      .from("orders")
      .select("subtotal_cents, total_cents")
      .eq("id", orderId)
      .single();
    expect(order!.subtotal_cents).toBe(0);
    expect(order!.total_cents).toBe(0);
  });

  it("es idempotente: la segunda llamada no vuelve a escribir nada", async () => {
    const orderId = await seedOrder();
    await seedItem(orderId, 3000, false);

    const first = await cancelarOrden(supabase, {
      orderId,
      businessId,
      motivo: "primera",
      actorUserId: null,
    });
    const second = await cancelarOrden(supabase, {
      orderId,
      businessId,
      motivo: "segunda",
      actorUserId: null,
    });

    expect(first.cancelled).toBe(true);
    expect(second.cancelled).toBe(false);
    expect(second.itemsCancelled).toBe(0);

    // El motivo de la primera sobrevive: la segunda no pisó nada.
    const { data: order } = await supabase
      .from("orders")
      .select("cancelled_reason")
      .eq("id", orderId)
      .single();
    expect(order!.cancelled_reason).toBe("primera");
  });

  it("NO toca una orden que ya se cobró (la carrera del cobro)", async () => {
    // El mozo cobra la mesa mientras el encargado la anula. Sin la guarda, la
    // cascada cancelaría los ítems de una orden pagada y el recompute le
    // bajaría el total por debajo de lo que el cliente ya puso.
    const orderId = await seedOrder();
    const itemId = await seedItem(orderId, 9000, false);
    await supabase
      .from("orders")
      .update({
        lifecycle_status: "closed",
        subtotal_cents: 9000,
        total_cents: 9000,
      })
      .eq("id", orderId);

    const res = await cancelarOrden(supabase, {
      orderId,
      businessId,
      motivo: "tarde",
      actorUserId: null,
    });

    expect(res.cancelled).toBe(false);
    expect(res.itemsCancelled).toBe(0);

    const { data: item } = await supabase
      .from("order_items")
      .select("cancelled_at")
      .eq("id", itemId)
      .single();
    expect(item!.cancelled_at).toBeNull();

    const { data: order } = await supabase
      .from("orders")
      .select("lifecycle_status, total_cents")
      .eq("id", orderId)
      .single();
    expect(order!.lifecycle_status).toBe("closed");
    expect(order!.total_cents).toBe(9000);
  });
});
