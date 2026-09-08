// @vitest-environment node
//
// P17 · issue #272 · hallazgo 3 — «Performance de mozos» rankeaba con la
// propina adentro.
//
// La venta es `amount_cents − tip_cents` (spec 098): la propina viaja adentro
// de `amount_cents` porque es plata que entró por la caja, pero no es del
// negocio. El propio type lo decía —`salesCents: number; // monto cobrado
// atribuido (sin propina)`— y la query sumaba `amount_cents` pelado.
//
// El mismo cálculo ya se había arreglado en la liquidación del mozo
// (`caja/liquidacion-mozo.ts`), que es la pantalla del encargado. Acá, en la
// del dueño, quedó sin arreglar: dos mozos que vendieron lo mismo aparecían
// separados por la propina, y con ellos se corrían también el ticket promedio
// y el largo de la barra de la tarjeta.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";

config({ path: ".env.local" });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const dbAvailable = Boolean(supabaseUrl && serviceKey);

const TEST_TAG = `test-ranking-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () =>
    createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    ),
}));

const { getMozoPerformance } = await import("./staff-query");

const VENTA = 100_000;
const PROPINA_PEDRO = 20_000;
const AHORA = new Date("2026-09-07T20:00:00Z");

describe.skipIf(!dbAvailable)(
  "reportes · ranking de mozos (integration)",
  () => {
    const supabase = createClient(supabaseUrl!, serviceKey!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    let businessId: string;
    let pedroId: string;
    let luciaId: string;
    const startIso = new Date(AHORA.getTime() - 3_600_000).toISOString();
    const endIso = new Date(AHORA.getTime() + 3_600_000).toISOString();

    const altaMozo = async (nombre: string, alias: string) => {
      const email = `${TEST_TAG}-${alias}@example.test`;
      const { data: u, error } = await supabase.auth.admin.createUser({
        email,
        password: "test-pass-12345",
        email_confirm: true,
      });
      if (error) throw new Error(`alta ${alias}: ${error.message}`);
      const id = u!.user!.id;
      await supabase.from("users").upsert({ id, email, full_name: nombre });
      return id;
    };

    beforeAll(async () => {
      pedroId = await altaMozo("Pedro Mozo", "pedro");
      luciaId = await altaMozo("Lucia Moza", "lucia");

      const { data: biz, error } = await supabase
        .from("businesses")
        .insert({ slug: TEST_TAG, name: "Ranking Test", is_active: true })
        .select("id")
        .single();
      if (error) throw new Error(`seed business: ${error.message}`);
      businessId = biz!.id;

      await supabase.from("business_users").insert([
        {
          business_id: businessId,
          user_id: pedroId,
          role: "mozo",
          full_name: "Pedro Mozo",
        },
        {
          business_id: businessId,
          user_id: luciaId,
          role: "mozo",
          full_name: "Lucia Moza",
        },
      ]);

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
          subtotal_cents: VENTA * 2,
          total_cents: VENTA * 2,
          created_at: AHORA.toISOString(),
        })
        .select("id")
        .single();

      // Las dos mesas vendieron lo mismo. Lo único distinto es lo que dejaron
      // encima de la mesa.
      const { error: payErr } = await supabase.from("payments").insert([
        {
          order_id: order!.id,
          business_id: businessId,
          caja_id: caja!.id,
          attributed_mozo_id: pedroId,
          method: "cash",
          amount_cents: VENTA + PROPINA_PEDRO,
          tip_cents: PROPINA_PEDRO,
          payment_status: "paid",
          created_at: AHORA.toISOString(),
        },
        {
          order_id: order!.id,
          business_id: businessId,
          caja_id: caja!.id,
          attributed_mozo_id: luciaId,
          method: "cash",
          amount_cents: VENTA,
          tip_cents: 0,
          payment_status: "paid",
          created_at: AHORA.toISOString(),
        },
      ]);
      if (payErr) throw new Error(`seed payments: ${payErr.message}`);
    });

    afterAll(async () => {
      if (businessId)
        await supabase.from("businesses").delete().eq("id", businessId);
      for (const id of [pedroId, luciaId]) {
        if (!id) continue;
        await supabase.from("users").delete().eq("id", id);
        await supabase.auth.admin.deleteUser(id);
      }
    });

    it("la facturación de cada mozo es la venta, sin la propina", async () => {
      const { mozos } = await getMozoPerformance(businessId, startIso, endIso);
      const porId = new Map(mozos.map((m) => [m.mozoId, m]));
      expect(porId.get(pedroId)!.salesCents).toBe(VENTA);
      expect(porId.get(luciaId)!.salesCents).toBe(VENTA);
    });

    it("vendieron lo mismo: la propina no puede desempatar el ranking", async () => {
      const { mozos } = await getMozoPerformance(businessId, startIso, endIso);
      expect(mozos[0].salesCents).toBe(mozos[1].salesCents);
    });

    it("el total de ventas del período tampoco lleva propina adentro", async () => {
      const r = await getMozoPerformance(businessId, startIso, endIso);
      expect(r.totalSalesCents).toBe(VENTA * 2);
      expect(r.totalTipsCents).toBe(PROPINA_PEDRO);
    });

    it("la propina se sigue viendo, y el % se mide contra la venta neta", async () => {
      const { mozos } = await getMozoPerformance(businessId, startIso, endIso);
      const pedro = mozos.find((m) => m.mozoId === pedroId)!;
      expect(pedro.tipsCents).toBe(PROPINA_PEDRO);
      expect(pedro.tipRatePct).toBeCloseTo(20, 6);
    });
  },
);
