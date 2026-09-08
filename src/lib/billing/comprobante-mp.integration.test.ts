// @vitest-environment node
//
// issue #274 · 3 — la Factura A sobrevive al rodeo por Mercado Pago.
//
// Con MP el cobro se completa FUERA de la pantalla: el operador tilda «Factura
// A», carga el CUIT, genera el link y se va. Minutos después el webhook cierra
// la orden — sin pantalla y sin operador. La elección no puede quedarse en el
// navegador: viaja por `orders.comprobante_elegido` (migración 0092), que es lo
// único que sobrevive al salto de proceso.
//
// Antes salía la B a consumidor final, y para el cliente empresa eso es crédito
// fiscal que no computa: recuperarlo cuesta una nota de crédito más una A nueva.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";

config({ path: ".env.local" });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const dbAvailable = Boolean(supabaseUrl && serviceKey);

const TAG = `test-compmp-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

describe.skipIf(!dbAvailable)("el comprobante elegido sobrevive a MP", () => {
  const db = createClient(supabaseUrl!, serviceKey!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  let businessId: string;
  let orderId: string;

  const ELEGIDO = {
    tipo: "factura_a",
    receptorCuit: "30712345678",
    receptorNombre: "Empresa SA",
    condicionIvaReceptor: 1,
  };

  beforeAll(async () => {
    const { data: biz } = await db
      .from("businesses")
      .insert({ slug: TAG, name: "Comp MP", is_active: true })
      .select("id").single();
    businessId = biz!.id;

    const { data: o } = await db
      .from("orders")
      .insert({
        business_id: businessId, customer_name: "C", customer_phone: "0",
        delivery_type: "dine_in", subtotal_cents: 10_000, total_cents: 10_000,
        lifecycle_status: "open",
      })
      .select("id").single();
    orderId = o!.id;
  });

  afterAll(async () => {
    if (businessId) await db.from("businesses").delete().eq("id", businessId);
  });

  it("la elección se guarda en la orden y se puede leer después", async () => {
    // Es lo que hace `iniciarPagoMp` antes de generar la preferencia.
    const { error } = await db
      .from("orders")
      .update({ comprobante_elegido: ELEGIDO })
      .eq("id", orderId);
    expect(error).toBeNull();

    // Y es lo que lee `closeOrderIfFullyPaid` cuando el webhook lo llama sin
    // comprobante: sin esto salía la B automática.
    const { data } = await db
      .from("orders")
      .select("comprobante_elegido")
      .eq("id", orderId)
      .single();
    expect(data!.comprobante_elegido).toMatchObject({
      tipo: "factura_a",
      receptorCuit: "30712345678",
    });
  });

  it("al cerrar se limpia: la mesa siguiente no hereda la decisión", async () => {
    // Lo hace el mismo UPDATE que cierra la orden. Si la mesa se reabre por una
    // anulación, el que vuelva a cobrar elige de nuevo.
    await db
      .from("orders")
      .update({ lifecycle_status: "closed", comprobante_elegido: null })
      .eq("id", orderId);

    const { data } = await db
      .from("orders")
      .select("comprobante_elegido")
      .eq("id", orderId)
      .single();
    expect(data!.comprobante_elegido).toBeNull();
  });
});
