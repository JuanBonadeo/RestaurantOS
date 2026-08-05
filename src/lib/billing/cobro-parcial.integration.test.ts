// @vitest-environment node
//
// Spec 094 — el cobro parcial deja rastro, y borrar splits no borra la plata.
//
// Los dos invariantes viven en la base (la RPC `registrar_pago_tx` y el FK
// `ON DELETE SET NULL` de `payments.split_id`), así que se prueban contra
// Postgres real. Un fake no puede fallar en ninguno de los dos.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";

config({ path: ".env.local" });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const dbAvailable = Boolean(supabaseUrl && serviceKey);

const TEST_TAG = `test-parcial-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

describe.skipIf(!dbAvailable)("cobro parcial (integration · spec 094)", () => {
  const supabase = createClient(supabaseUrl!, serviceKey!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  let businessId: string;
  let cajaId: string;

  const seedOrder = async (totalCents: number): Promise<string> => {
    const { data, error } = await supabase
      .from("orders")
      .insert({
        order_number: 0,
        business_id: businessId,
        customer_name: "Parcial test",
        customer_phone: "-",
        delivery_type: "dine_in",
        lifecycle_status: "open",
        subtotal_cents: totalCents,
        delivery_fee_cents: 0,
        total_cents: totalCents,
        payment_method: "cash",
      })
      .select("id")
      .single();
    if (error) throw error;
    return data!.id as string;
  };

  beforeAll(async () => {
    const { data: biz, error } = await supabase
      .from("businesses")
      .insert({ slug: TEST_TAG, name: "Parcial Test", is_active: true })
      .select("id")
      .single();
    if (error) throw error;
    businessId = biz!.id as string;

    const { data: caja } = await supabase
      .from("cajas")
      .insert({ business_id: businessId, name: "Principal", is_active: true })
      .select("id")
      .single();
    cajaId = caja!.id as string;
  }, 60_000);

  afterAll(async () => {
    if (businessId) {
      await supabase.from("businesses").delete().eq("id", businessId);
    }
  }, 60_000);

  it("H-07 · un pago parcial persiste en orders.total_paid_cents", async () => {
    // Sin esto, el mozo cambiaba de pantalla y volvía: «Falta $20.000» sobre una
    // cuenta donde ya habían entrado $12.000. Cobraba de nuevo → $32.000.
    const orderId = await seedOrder(20000);

    const { error } = await supabase.rpc("registrar_pago_tx", {
      p_order_id: orderId,
      p_business_id: businessId,
      p_split_id: null,
      p_caja_id: cajaId,
      p_operated_by: null,
      p_attributed_mozo_id: null,
      p_method: "card_manual",
      p_amount_cents: 12000,
      p_tip_cents: 0,
      p_last_four: null,
      p_card_brand: null,
      p_notes: null,
      p_adjustment_percent: 0,
      p_adjustment_cents: 0,
      p_request_id: crypto.randomUUID(),
    });
    expect(error).toBeNull();

    const { data: order } = await supabase
      .from("orders")
      .select("total_paid_cents")
      .eq("id", orderId)
      .single();
    expect(order!.total_paid_cents).toBe(12000);
  });

  it("H-07 · dos parciales acumulan", async () => {
    const orderId = await seedOrder(20000);
    for (const monto of [8000, 5000]) {
      await supabase.rpc("registrar_pago_tx", {
        p_order_id: orderId,
        p_business_id: businessId,
        p_split_id: null,
        p_caja_id: cajaId,
        p_operated_by: null,
        p_attributed_mozo_id: null,
        p_method: "transfer",
        p_amount_cents: monto,
        p_tip_cents: 0,
        p_last_four: null,
        p_card_brand: null,
        p_notes: null,
        p_adjustment_percent: 0,
        p_adjustment_cents: 0,
        p_request_id: crypto.randomUUID(),
      });
    }

    const { data: order } = await supabase
      .from("orders")
      .select("total_paid_cents")
      .eq("id", orderId)
      .single();
    expect(order!.total_paid_cents).toBe(13000);
  });

  it("H-10 · un split ya cobrado no se borra: queda cancelled con su pago", async () => {
    // El FK es ON DELETE SET NULL, así que el borrado no fallaba: los pagos
    // sobrevivían huérfanos y el que ya había pagado pagaba dos veces.
    const orderId = await seedOrder(20000);

    const { data: splits } = await supabase
      .from("order_splits")
      .insert([
        {
          order_id: orderId,
          business_id: businessId,
          split_mode: "por_personas",
          split_index: 1,
          expected_amount_cents: 10000,
        },
        {
          order_id: orderId,
          business_id: businessId,
          split_mode: "por_personas",
          split_index: 2,
          expected_amount_cents: 10000,
        },
      ])
      .select("id");
    const [pagado, sinPagar] = splits as { id: string }[];

    await supabase.rpc("registrar_pago_tx", {
      p_order_id: orderId,
      p_business_id: businessId,
      p_split_id: pagado.id,
      p_caja_id: cajaId,
      p_operated_by: null,
      p_attributed_mozo_id: null,
      p_method: "cash",
      p_amount_cents: 10000,
      p_tip_cents: 0,
      p_last_four: null,
      p_card_brand: null,
      p_notes: null,
      p_adjustment_percent: 0,
      p_adjustment_cents: 0,
      p_request_id: crypto.randomUUID(),
    });

    // Reproducimos lo que hace `deleteSplitsAndItems` hoy.
    const { data: paySplits } = await supabase
      .from("payments")
      .select("split_id")
      .eq("order_id", orderId);
    const conPagos = [
      ...new Set(
        (paySplits ?? [])
          .map((p) => (p as { split_id: string | null }).split_id)
          .filter((s): s is string => s !== null),
      ),
    ];
    expect(conPagos).toEqual([pagado.id]);

    await supabase
      .from("order_splits")
      .update({ status: "cancelled" })
      .eq("order_id", orderId)
      .in("id", conPagos);
    await supabase
      .from("order_splits")
      .delete()
      .eq("order_id", orderId)
      .not("id", "in", `(${conPagos.map((id) => `"${id}"`).join(",")})`);

    // El cobrado sobrevive, y el pago sigue apuntando a él.
    const { data: quedan } = await supabase
      .from("order_splits")
      .select("id, status")
      .eq("order_id", orderId);
    expect(quedan).toHaveLength(1);
    expect(quedan![0].id).toBe(pagado.id);
    expect(quedan![0].status).toBe("cancelled");

    const { data: pago } = await supabase
      .from("payments")
      .select("split_id, amount_cents")
      .eq("order_id", orderId)
      .single();
    expect(pago!.split_id).toBe(pagado.id); // NO quedó huérfano
    expect(pago!.amount_cents).toBe(10000);

    // Y el que no tenía plata sí se fue.
    expect(quedan!.find((s) => s.id === sinPagar.id)).toBeUndefined();
  });
});
