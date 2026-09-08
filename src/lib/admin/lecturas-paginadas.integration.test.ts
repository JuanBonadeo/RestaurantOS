// @vitest-environment node
//
// P17 · issue #272 · hallazgo 8 — el día que el local tenga volumen, los
// agregados del panel se calculan sobre las primeras 1.000 filas y nadie se
// entera.
//
// PostgREST corta la respuesta en `db-max-rows` (1.000, `supabase/config.toml`)
// y devuelve 206 SIN error: `(data ?? [])` recibe mil filas y sigue de largo.
// Ninguna de las lecturas del dashboard/reportes paginaba. A partir del umbral
// el número deja de crecer justo cuando el negocio empieza a crecer, que es el
// momento en que el dueño más lo mira — es el modo de falla de MaxiRest.
//
// En el margen bruto es doblemente venenoso: `netSales` (order_items) y
// `foodCost` (ingredient_consumptions) se truncan por separado, y como
// `ingredient_consumptions` emite una fila POR INSUMO de cada ítem vendido,
// cruza las 1.000 mucho antes: el CMV se congela mientras la venta sigue
// subiendo y el margen aparenta mejorar.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";

config({ path: ".env.local" });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const dbAvailable = Boolean(supabaseUrl && serviceKey);

const TEST_TAG = `test-paginado-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () =>
    createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    ),
}));

const { getProfitMetrics } = await import("./profit-query");
const { getPaymentMix } = await import("./dashboard-query");

const TZ = "America/Argentina/Buenos_Aires";
const AHORA = new Date("2026-09-07T20:00:00Z");

/** Una más que el corte de PostgREST: con 1.000 el bug no se ve. */
const FILAS = 1_001;
const PRECIO_ITEM = 1_000;
const COBRO = 100;

describe.skipIf(!dbAvailable)(
  "dashboard · lecturas que no se cortan en 1.000 (integration)",
  () => {
    const supabase = createClient(supabaseUrl!, serviceKey!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    let businessId: string;
    const startIso = new Date(AHORA.getTime() - 3_600_000).toISOString();
    const endIso = new Date(AHORA.getTime() + 3_600_000).toISOString();

    beforeAll(async () => {
      const { data: biz, error } = await supabase
        .from("businesses")
        .insert({
          slug: TEST_TAG,
          name: "Paginado Test",
          is_active: true,
          timezone: TZ,
        })
        .select("id")
        .single();
      if (error) throw new Error(`seed business: ${error.message}`);
      businessId = biz!.id;

      const { data: caja } = await supabase
        .from("cajas")
        .insert({
          business_id: businessId,
          name: "Caja Principal",
          is_default: true,
        })
        .select("id")
        .single();

      const { data: order } = await supabase
        .from("orders")
        .insert({
          business_id: businessId,
          customer_name: "Mesa 1",
          customer_phone: "0",
          delivery_type: "dine_in",
          subtotal_cents: FILAS * PRECIO_ITEM,
          total_cents: FILAS * PRECIO_ITEM,
          created_at: AHORA.toISOString(),
        })
        .select("id")
        .single();

      const items = Array.from({ length: FILAS }, (_, i) => ({
        order_id: order!.id,
        product_name: `Item ${i}`,
        unit_price_cents: PRECIO_ITEM,
        quantity: 1,
        subtotal_cents: PRECIO_ITEM,
      }));
      const { error: itemsErr } = await supabase
        .from("order_items")
        .insert(items);
      if (itemsErr) throw new Error(`seed items: ${itemsErr.message}`);

      const cobros = Array.from({ length: FILAS }, () => ({
        order_id: order!.id,
        business_id: businessId,
        caja_id: caja!.id,
        method: "cash",
        amount_cents: COBRO,
        tip_cents: 0,
        payment_status: "paid",
        created_at: AHORA.toISOString(),
      }));
      const { error: payErr } = await supabase.from("payments").insert(cobros);
      if (payErr) throw new Error(`seed payments: ${payErr.message}`);
    });

    afterAll(async () => {
      if (businessId)
        await supabase.from("businesses").delete().eq("id", businessId);
    });

    it("la base tiene las 1.001 filas: el truncado es de la lectura, no del dato", async () => {
      const { count } = await supabase
        .from("payments")
        .select("id", { count: "exact", head: true })
        .eq("business_id", businessId);
      expect(count).toBe(FILAS);
    });

    it("la venta neta suma todos los ítems del período, no los primeros 1.000", async () => {
      const m = await getProfitMetrics(businessId, startIso, endIso);
      expect(m.netSalesCents).toBe(FILAS * PRECIO_ITEM);
    });

    it("el mix de medios de pago tampoco se queda en 1.000 cobros", async () => {
      const mix = await getPaymentMix(businessId, TZ, AHORA);
      expect(mix.byMethod.cash.count).toBe(FILAS);
      expect(mix.totalCents).toBe(FILAS * COBRO);
    });
  },
);
