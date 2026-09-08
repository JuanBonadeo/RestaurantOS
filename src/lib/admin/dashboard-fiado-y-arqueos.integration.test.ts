// @vitest-environment node
//
// P17 · issue #272 · hallazgos 2 y 5 — dos lecturas del panel del dueño que
// cuentan plata que no está.
//
// (2) El fiado (`payments.method = 'cuenta_corriente'`, spec 141) es venta pero
//     NO es plata cobrada: la caja lo separa en `total_fiado_cents` desde la
//     141 · D3. El donut «Cómo te pagan» lo metía en el balde «Otros», lo
//     sumaba a `totalCents` y con eso bajaba el «% efectivo» del centro del
//     gráfico. La única pantalla que decía la verdad era el arqueo, que mira el
//     encargado y no el dueño.
//
// (5) «Control de arqueos → Sangrías» sumaba los movimientos ANULADOS (spec 070)
//     y, encima, el retiro que escribe el propio cierre de caja (`corte_id`,
//     spec 130) — que es todo el efectivo contado del turno, no plata que
//     alguien sacó del cajón. El número quedaba tan grande que parecía
//     plausible, y es justo el que responde «¿cuánta plata se está sacando?».
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";

config({ path: ".env.local" });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const dbAvailable = Boolean(supabaseUrl && serviceKey);

const TEST_TAG = `test-dash-fiado-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () =>
    createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    ),
}));

const { getPaymentMix, getCashControl } = await import("./dashboard-query");

const TZ = "America/Argentina/Buenos_Aires";
const AHORA = new Date("2026-09-07T20:00:00Z");

const COBRADO_EFECTIVO = 40_000;
const FIADO = 100_000;

const SANGRIA_VIVA = 3_500;
const SANGRIA_ANULADA = 80_000;
const RETIRO_DEL_CIERRE = 500_000;
const INGRESO_ANULADO = 10_000;

describe.skipIf(!dbAvailable)(
  "dashboard · fiado y control de arqueos (integration)",
  () => {
    const supabase = createClient(supabaseUrl!, serviceKey!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    let businessId: string;
    let encargadoId: string;

    beforeAll(async () => {
      const email = `${TEST_TAG}@example.test`;
      const { data: u } = await supabase.auth.admin.createUser({
        email,
        password: "test-pass-12345",
        email_confirm: true,
      });
      encargadoId = u!.user!.id;
      await supabase
        .from("users")
        .upsert({ id: encargadoId, email, full_name: "Encargada" });

      const { data: biz, error } = await supabase
        .from("businesses")
        .insert({
          slug: TEST_TAG,
          name: "Fiado Test",
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
      const cajaId = caja!.id;

      // El habitué que firma: el fiado necesita cliente (constraint
      // `payments_credit_customer_coherente`).
      const { data: cliente } = await supabase
        .from("customers")
        .insert({
          business_id: businessId,
          phone: "1122334455",
          name: "El socio",
          credit_enabled: true,
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
          subtotal_cents: COBRADO_EFECTIVO + FIADO,
          total_cents: COBRADO_EFECTIVO + FIADO,
          created_at: AHORA.toISOString(),
        })
        .select("id")
        .single();

      const { error: payErr } = await supabase.from("payments").insert([
        {
          order_id: order!.id,
          business_id: businessId,
          caja_id: cajaId,
          method: "cash",
          amount_cents: COBRADO_EFECTIVO,
          tip_cents: 0,
          payment_status: "paid",
          created_at: AHORA.toISOString(),
        },
        {
          order_id: order!.id,
          business_id: businessId,
          caja_id: cajaId,
          method: "cuenta_corriente",
          credit_customer_id: cliente!.id,
          amount_cents: FIADO,
          tip_cents: 0,
          payment_status: "paid",
          created_at: AHORA.toISOString(),
        },
      ]);
      if (payErr) throw new Error(`seed payments: ${payErr.message}`);

      // Un cierre de caja, con su retiro asociado.
      const { data: corte } = await supabase
        .from("caja_cortes")
        .insert({
          caja_id: cajaId,
          business_id: businessId,
          encargado_id: encargadoId,
          expected_cash_cents: RETIRO_DEL_CIERRE,
          closing_cash_cents: RETIRO_DEL_CIERRE,
          difference_cents: 0,
          created_at: AHORA.toISOString(),
        })
        .select("id")
        .single();

      const { error: movErr } = await supabase.from("caja_movimientos").insert([
        {
          business_id: businessId,
          caja_id: cajaId,
          kind: "sangria",
          amount_cents: SANGRIA_VIVA,
          reason: "Propina al delivery",
          created_at: AHORA.toISOString(),
        },
        {
          business_id: businessId,
          caja_id: cajaId,
          kind: "sangria",
          amount_cents: SANGRIA_ANULADA,
          reason: "Cargada mal",
          cancelled_at: AHORA.toISOString(),
          cancelled_reason: "Me equivoqué de monto",
          created_at: AHORA.toISOString(),
        },
        {
          business_id: businessId,
          caja_id: cajaId,
          kind: "sangria",
          amount_cents: RETIRO_DEL_CIERRE,
          reason: "Retiro del cierre de caja",
          corte_id: corte!.id,
          created_at: AHORA.toISOString(),
        },
        {
          business_id: businessId,
          caja_id: cajaId,
          kind: "ingreso",
          amount_cents: INGRESO_ANULADO,
          reason: "Cambio, cargado dos veces",
          cancelled_at: AHORA.toISOString(),
          cancelled_reason: "Duplicado",
          created_at: AHORA.toISOString(),
        },
      ]);
      if (movErr) throw new Error(`seed movimientos: ${movErr.message}`);
    });

    afterAll(async () => {
      if (businessId)
        await supabase.from("businesses").delete().eq("id", businessId);
      if (encargadoId) {
        await supabase.from("users").delete().eq("id", encargadoId);
        await supabase.auth.admin.deleteUser(encargadoId);
      }
    });

    it("el fiado no entra al total del donut: no es plata que entró", async () => {
      const mix = await getPaymentMix(businessId, TZ, AHORA);
      expect(mix.totalCents).toBe(COBRADO_EFECTIVO);
      expect(mix.cashCents).toBe(COBRADO_EFECTIVO);
    });

    it("tampoco se disfraza de «Otros»", async () => {
      const mix = await getPaymentMix(businessId, TZ, AHORA);
      expect(mix.byMethod.other.count).toBe(0);
      expect(mix.byMethod.other.amountCents).toBe(0);
    });

    it("pero no desaparece: sale aparte, para poder cobrarlo", async () => {
      const mix = await getPaymentMix(businessId, TZ, AHORA);
      expect(mix.fiadoCents).toBe(FIADO);
    });

    it("el «% efectivo» del centro del gráfico deja de estar diluido", async () => {
      const mix = await getPaymentMix(businessId, TZ, AHORA);
      const pct = (mix.cashCents / mix.totalCents) * 100;
      expect(pct).toBe(100);
    });

    it("«Sangrías» cuenta sólo las vivas del turno", async () => {
      const start = new Date(AHORA.getTime() - 60 * 60 * 1000).toISOString();
      const end = new Date(AHORA.getTime() + 60 * 60 * 1000).toISOString();
      const control = await getCashControl(businessId, start, end);
      expect(control.sangriaCents).toBe(SANGRIA_VIVA);
    });

    it("y los ingresos anulados tampoco suman", async () => {
      const start = new Date(AHORA.getTime() - 60 * 60 * 1000).toISOString();
      const end = new Date(AHORA.getTime() + 60 * 60 * 1000).toISOString();
      const control = await getCashControl(businessId, start, end);
      expect(control.ingresoCents).toBe(0);
    });

    it("el cierre se sigue contando como corte (eso no cambia)", async () => {
      const start = new Date(AHORA.getTime() - 60 * 60 * 1000).toISOString();
      const end = new Date(AHORA.getTime() + 60 * 60 * 1000).toISOString();
      const control = await getCashControl(businessId, start, end);
      expect(control.corteCount).toBe(1);
    });
  },
);
