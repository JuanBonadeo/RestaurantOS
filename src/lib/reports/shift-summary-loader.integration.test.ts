// @vitest-environment node
//
// P17 · issue #272 · hallazgos 1, 2 y 4 — el mail de cierre, que es la única
// pantalla que el dueño lee sin entrar al sistema.
//
// (1) El loader cortaba el día a medianoche calendario. Golf cierra 01:00–02:00:
//     el mail que sale al cierre partía la noche en dos y mandaba la cola de la
//     jornada al resumen del día siguiente. La jornada es `operating_day()`
//     (corte 6 AM, migración 0049), el mismo corte que numera la comanda.
//
// (2) El fiado (`cuenta_corriente`, spec 141) se sumaba a `total_cents` y se
//     imprimía bajo el título «Recaudación», pero NO aparecía en el desglose por
//     método (`METHOD_ORDER` no lo incluye): los renglones no sumaban al KPI y
//     nadie podía notar la diferencia.
//
// (4) El bloque «Operación» sumaba `orders.total_cents` con la propina adentro
//     —`total = subtotal + tip + fee − discount`— mientras el bloque
//     «Recaudación», 55 líneas más arriba en el mismo archivo, sí la restaba. El
//     ticket promedio impreso salía inflado por la propina, y es el número con
//     el que se deciden los precios de la carta.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";

config({ path: ".env.local" });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const dbAvailable = Boolean(supabaseUrl && serviceKey);

const TEST_TAG = `test-cierre-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

const { loadShiftSummaryData } = await import("./shift-summary-loader");
const { buildShiftSummary } = await import("./shift-summary");
const { formatCurrency } = await import("@/lib/currency");

const TZ = "America/Argentina/Buenos_Aires";

/** 00:30 del 7 de septiembre en Buenos Aires: la jornada abierta es la del 6. */
const AHORA = new Date("2026-09-07T03:30:00Z");

const CENA_VENTA = 100_000;
const CENA_PROPINA = 10_000;
const FIADO = 60_000;

describe.skipIf(!dbAvailable)(
  "mail de cierre · jornada, fiado y propina (integration)",
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
          name: "Cierre Test",
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

      // La cena: 23:40 del 6. Deja $10.000 de propina.
      const { data: cena } = await supabase
        .from("orders")
        .insert({
          business_id: businessId,
          customer_name: "Mesa 4",
          customer_phone: "0",
          delivery_type: "dine_in",
          subtotal_cents: CENA_VENTA,
          tip_cents: CENA_PROPINA,
          total_cents: CENA_VENTA + CENA_PROPINA,
          created_at: "2026-09-07T02:40:00Z",
        })
        .select("id")
        .single();

      // La cola de la misma noche: 00:10 del 7, se la lleva fiada el socio.
      const { data: tarde } = await supabase
        .from("orders")
        .insert({
          business_id: businessId,
          customer_name: "Mesa 9",
          customer_phone: "0",
          delivery_type: "dine_in",
          subtotal_cents: FIADO,
          tip_cents: 0,
          total_cents: FIADO,
          created_at: "2026-09-07T03:10:00Z",
        })
        .select("id")
        .single();

      const { error: payErr } = await supabase.from("payments").insert([
        {
          order_id: cena!.id,
          business_id: businessId,
          caja_id: caja!.id,
          method: "cash",
          amount_cents: CENA_VENTA + CENA_PROPINA,
          tip_cents: CENA_PROPINA,
          payment_status: "paid",
          created_at: "2026-09-07T02:45:00Z",
        },
        {
          order_id: tarde!.id,
          business_id: businessId,
          caja_id: caja!.id,
          method: "cuenta_corriente",
          credit_customer_id: cliente!.id,
          amount_cents: FIADO,
          tip_cents: 0,
          payment_status: "paid",
          created_at: "2026-09-07T03:15:00Z",
        },
      ]);
      if (payErr) throw new Error(`seed payments: ${payErr.message}`);
    });

    afterAll(async () => {
      if (businessId)
        await supabase.from("businesses").delete().eq("id", businessId);
    });

    it("el mail de las 00:30 cubre la jornada entera, no los últimos 30 minutos", async () => {
      const data = (await loadShiftSummaryData(businessId, AHORA))!;
      expect(data.recaudacion.cobros_count).toBe(2);
      expect(data.operacion.orderCount).toBe(2);
    });

    it("y dice de qué jornada habla: la del 6, no la del 7", async () => {
      const data = (await loadShiftSummaryData(businessId, AHORA))!;
      expect(data.rangeLabel).toContain("06/09/2026");
    });

    it("«Recaudación» es lo que entró al cajón: el fiado no entró", async () => {
      const data = (await loadShiftSummaryData(businessId, AHORA))!;
      expect(data.recaudacion.total_cents).toBe(CENA_VENTA);
      expect(data.recaudacion.fiado_cents).toBe(FIADO);
    });

    it("el fiado no desaparece: sale con su propio renglón", async () => {
      const data = (await loadShiftSummaryData(businessId, AHORA))!;
      expect(data.recaudacion.por_metodo.cuenta_corriente).toBe(FIADO);

      const vista = buildShiftSummary(data);
      // Sólo efectivo: el fiado dejó de ser un «método cobrado» y por eso la
      // tabla de métodos vuelve a sumar el KPI «Ventas» de arriba.
      expect(vista.recaudacion.porMetodo).toHaveLength(1);
      expect(vista.recaudacion.porMetodo[0].value).toBe(
        formatCurrency(CENA_VENTA),
      );
      expect(vista.recaudacion.tieneFiado).toBe(true);
      expect(vista.recaudacion.fiado).toBe(formatCurrency(FIADO));
    });

    it("el ticket promedio se mide sin propina, igual que la recaudación", async () => {
      const data = (await loadShiftSummaryData(businessId, AHORA))!;
      expect(data.operacion.revenueCents).toBe(CENA_VENTA + FIADO);
      expect(data.operacion.averageTicketCents).toBe((CENA_VENTA + FIADO) / 2);
    });

    it("la propina se sigue reportando aparte", async () => {
      const data = (await loadShiftSummaryData(businessId, AHORA))!;
      expect(data.recaudacion.propinas_cents).toBe(CENA_PROPINA);
    });
  },
);
