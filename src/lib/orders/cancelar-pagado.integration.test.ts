// @vitest-environment node
//
// P06 · issue #259 — cancelar un pedido ya pagado no puede tragarse la plata.
//
// `anularMesa` pasaba por `bloqueoPorPlata` (spec 092) desde siempre; el board
// de pedidos online, nunca. Cancelar desde ahí un pedido pagado por Mercado
// Pago no devolvía nada, no avisaba, y dejaba el cobro adentro de la caja
// contra una venta que ya no existe: el cliente pagó, no recibe ni el pedido ni
// el reembolso, y el arqueo cuadra igual porque el pago sigue ahí.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";

config({ path: ".env.local" });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const dbAvailable = Boolean(supabaseUrl && serviceKey);

const TEST_TAG = `test-cancpago-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

const { bloqueoPorPlata } = await import("./cancel-guards");

describe.skipIf(!dbAvailable)("orders · bloqueo por plata en pedidos (integration)", () => {
  const supabase = createClient(supabaseUrl!, serviceKey!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  let businessId: string;
  let cajaId: string;
  let orderPagoId: string;
  let orderLimpioId: string;

  const nuevaOrden = async () => {
    const { data } = await supabase
      .from("orders")
      .insert({
        business_id: businessId, customer_name: "C", customer_phone: "0",
        delivery_type: "delivery", subtotal_cents: 25_000, total_cents: 25_000,
        lifecycle_status: "open",
      })
      .select("id").single();
    return data!.id as string;
  };

  beforeAll(async () => {
    const { data: biz } = await supabase
      .from("businesses")
      .insert({ slug: TEST_TAG, name: "Cancel Test", is_active: true })
      .select("id").single();
    businessId = biz!.id;

    const { data: caja } = await supabase
      .from("cajas")
      .insert({ business_id: businessId, name: "Caja1", is_default: true })
      .select("id").single();
    cajaId = caja!.id;

    orderPagoId = await nuevaOrden();
    orderLimpioId = await nuevaOrden();

    await supabase.from("payments").insert({
      order_id: orderPagoId, business_id: businessId, caja_id: cajaId,
      method: "mp_qr", amount_cents: 25_000, tip_cents: 0,
      payment_status: "paid",
    });
  });

  afterAll(async () => {
    if (businessId) await supabase.from("businesses").delete().eq("id", businessId);
  });

  it("un pedido con cobro vivo no se cancela: manda a anular el cobro primero", async () => {
    const bloqueo = await bloqueoPorPlata(
      supabase as never, [orderPagoId], "pedido",
    );
    expect(bloqueo).not.toBeNull();
    expect(bloqueo).toMatch(/Este pedido/);
    expect(bloqueo).toMatch(/Anulá el cobro primero/);
    // Y habla de un pedido, no de una mesa: acá no hay ninguna.
    expect(bloqueo).not.toMatch(/mesa/i);
  });

  it("un pedido sin cobro se cancela sin trabas", async () => {
    const bloqueo = await bloqueoPorPlata(
      supabase as never, [orderLimpioId], "pedido",
    );
    expect(bloqueo).toBeNull();
  });
});
