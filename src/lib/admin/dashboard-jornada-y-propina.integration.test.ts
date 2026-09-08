// @vitest-environment node
//
// P17 · issue #272 · hallazgos 1 y 7 — el dashboard tiene que medir la misma
// jornada, y con la misma regla de plata, que el resto de la pantalla.
//
// (1) El tile «Pedidos hoy» cortaba a medianoche calendario mientras la lista
//     de abajo, en la MISMA página, corta por jornada operativa (`business_day`,
//     corte 6 AM, migración 0049). A las 00:30 el tile arrancaba de cero y la
//     cena —que sigue viva, con mesas abiertas y sin cobrar— se caía a «ayer».
//     Es el mismo bug que ya se arregló en el board de pedidos (#259); acá
//     quedó sin arreglar.
//
// (2) El mapa de calor sumaba `total_cents` pelado, con la propina adentro,
//     mientras los tiles de arriba —170 líneas antes, en el mismo archivo—
//     usan `total_cents − tip_cents` (spec 098). Dos números de la misma
//     pantalla medían cosas distintas y los dos decían «facturación».
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";

config({ path: ".env.local" });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const dbAvailable = Boolean(supabaseUrl && serviceKey);

const TEST_TAG = `test-dash-jornada-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

vi.mock("@/lib/supabase/server", () => ({
  // Las lecturas del dashboard son agregados scopeados por `business_id`; acá
  // se leen con service porque el test no tiene sesión. La tenencia se prueba
  // igual: cada caso arma su propio negocio y sólo mira ese id.
  createSupabaseServerClient: async () =>
    createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    ),
}));

const { getDashboardOverview, getHourlyHeatmap } =
  await import("./dashboard-query");

const TZ = "America/Argentina/Buenos_Aires";

/** 00:30 del 7 de septiembre en Buenos Aires: la jornada abierta es la del 6. */
const AHORA = new Date("2026-09-07T03:30:00Z");

/** La cena: 23:40 del 6 (jornada del 6). Lleva $5.000 de propina adentro. */
const CENA = "2026-09-07T02:40:00Z";
const CENA_VENTA = 50_000;
const CENA_PROPINA = 5_000;

/** La cola de la misma cena: 00:10 del 7, todavía jornada del 6. */
const MADRUGADA = "2026-09-07T03:10:00Z";
const MADRUGADA_VENTA = 30_000;

describe.skipIf(!dbAvailable)(
  "dashboard · jornada operativa y propina (integration)",
  () => {
    const supabase = createClient(supabaseUrl!, serviceKey!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    let businessId: string;

    beforeAll(async () => {
      const { data: biz, error } = await supabase
        .from("businesses")
        .insert({
          slug: TEST_TAG,
          name: "Dashboard Jornada Test",
          is_active: true,
          timezone: TZ,
        })
        .select("id")
        .single();
      if (error) throw new Error(`seed business: ${error.message}`);
      businessId = biz!.id;

      const { error: ordersErr } = await supabase.from("orders").insert([
        {
          business_id: businessId,
          customer_name: "Mesa 4",
          customer_phone: "0",
          delivery_type: "dine_in",
          subtotal_cents: CENA_VENTA,
          tip_cents: CENA_PROPINA,
          total_cents: CENA_VENTA + CENA_PROPINA,
          created_at: CENA,
        },
        {
          business_id: businessId,
          customer_name: "Mesa 7",
          customer_phone: "0",
          delivery_type: "dine_in",
          subtotal_cents: MADRUGADA_VENTA,
          tip_cents: 0,
          total_cents: MADRUGADA_VENTA,
          created_at: MADRUGADA,
        },
      ]);
      if (ordersErr) throw new Error(`seed orders: ${ordersErr.message}`);
    });

    afterAll(async () => {
      if (businessId)
        await supabase.from("businesses").delete().eq("id", businessId);
    });

    it("la base ya los pone en la misma jornada: los dos son business_day del 6", async () => {
      // El contrato que el TS tiene que respetar no es una opinión: lo escribe
      // `public.operating_day()` en cada insert.
      const { data } = await supabase
        .from("orders")
        .select("business_day")
        .eq("business_id", businessId);
      expect(new Set((data ?? []).map((o) => o.business_day))).toEqual(
        new Set(["2026-09-06"]),
      );
    });

    it("a las 00:30 el tile cuenta la cena entera, no arranca de cero", async () => {
      const overview = await getDashboardOverview(businessId, TZ, AHORA);
      expect(overview.today.orderCount).toBe(2);
      expect(overview.today.revenueCents).toBe(CENA_VENTA + MADRUGADA_VENTA);
    });

    it("y «ayer» no se queda con la cena que todavía está abierta", async () => {
      const overview = await getDashboardOverview(businessId, TZ, AHORA);
      expect(overview.yesterday.orderCount).toBe(0);
      expect(overview.yesterday.revenueCents).toBe(0);
    });

    it("a las 07:00 la jornada ya cambió y lo de anoche pasa a «ayer»", async () => {
      const overview = await getDashboardOverview(
        businessId,
        TZ,
        new Date("2026-09-07T10:00:00Z"), // 07:00 AR del 7
      );
      expect(overview.today.orderCount).toBe(0);
      expect(overview.yesterday.orderCount).toBe(2);
      expect(overview.yesterday.revenueCents).toBe(
        CENA_VENTA + MADRUGADA_VENTA,
      );
    });

    it("el gráfico del mes agrupa por jornada: los dos pedidos caen en el mismo día", async () => {
      const overview = await getDashboardOverview(businessId, TZ, AHORA);
      const conVentas = overview.month.dailyRevenue.filter((d) => d.orders > 0);
      expect(conVentas).toHaveLength(1);
      expect(conVentas[0]).toMatchObject({
        date: "2026-09-06",
        orders: 2,
        revenueCents: CENA_VENTA + MADRUGADA_VENTA,
      });
    });

    it("el mapa de calor mide la venta con la misma regla que los tiles: sin propina", async () => {
      const heatmap = await getHourlyHeatmap(businessId, TZ, AHORA);
      const total = heatmap.cells.reduce((s, c) => s + c.revenueCents, 0);
      expect(heatmap.totalOrders).toBe(2);
      expect(total).toBe(CENA_VENTA + MADRUGADA_VENTA);
    });
  },
);
