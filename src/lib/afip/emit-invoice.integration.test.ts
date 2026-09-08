// @vitest-environment node
import { beforeAll, afterAll, describe, expect, it, vi } from "vitest";
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";

config({ path: ".env.local" });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const dbAvailable = Boolean(supabaseUrl && serviceKey);

const TEST_TAG = `test-afip-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

let CURRENT_USER_ID = "";

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({
    auth: {
      // Identidad de las actions del salón: `getClaims` (spec 106).
      // `getUser` queda para el código que todavía lo llama.
      getClaims: async () => ({
        data: { claims: { sub: CURRENT_USER_ID } },
        error: null,
      }),
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

const { emitInvoice, anularFactura, retryInvoice } =
  await import("./emit-invoice");

describe.skipIf(!dbAvailable)(
  "afip/emitInvoice idempotencia (integration)",
  () => {
    const supabase = createClient(supabaseUrl!, serviceKey!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    let businessId: string;
    let businessSlug: string;
    let mozoId: string;

    const newOrder = async (total = 12_100) => {
      const { data: order } = await supabase
        .from("orders")
        .insert({
          business_id: businessId,
          customer_name: "AFIP",
          customer_phone: "0",
          delivery_type: "dine_in",
          subtotal_cents: total,
          total_cents: total,
          lifecycle_status: "open",
        })
        .select("id")
        .single();
      return order!.id as string;
    };

    beforeAll(async () => {
      const email = `${TEST_TAG}@example.test`;
      const { data: created } = await supabase.auth.admin.createUser({
        email,
        password: "test-pass-12345",
        email_confirm: true,
      });
      mozoId = created!.user!.id;
      await supabase
        .from("users")
        .upsert({ id: mozoId, email, full_name: "Mozo" });

      const { data: biz } = await supabase
        .from("businesses")
        .insert({
          slug: TEST_TAG,
          name: "AFIP Test",
          is_active: true,
          afip_cuit: "20123456789",
          afip_punto_venta: 1,
          afip_mode: "sandbox",
        })
        .select("id, slug")
        .single();
      businessId = biz!.id;
      businessSlug = biz!.slug;

      await supabase.from("business_users").insert({
        business_id: businessId,
        user_id: mozoId,
        role: "encargado",
        full_name: "Mozo",
      });

      CURRENT_USER_ID = mozoId;
    });

    afterAll(async () => {
      if (businessId) {
        await supabase.from("businesses").delete().eq("id", businessId);
      }
      if (mozoId) {
        await supabase.from("users").delete().eq("id", mozoId);
        await supabase.auth.admin.deleteUser(mozoId);
      }
    });

    it(
      "emite un comprobante en sandbox → authorized con CAE SANDBOX",
      { timeout: 30_000 },
      async () => {
        const orderId = await newOrder();
        const r = await emitInvoice({ orderId, slug: businessSlug });
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        expect(r.data.invoice.status).toBe("authorized");
        expect(r.data.invoice.cae).toMatch(/^SANDBOX-/);
        expect(r.data.invoice.numero).not.toBeNull();
      },
    );

    it(
      "propina fuera del facturable: el comprobante excluye tip_cents (spec 36 · R-C1)",
      { timeout: 30_000 },
      async () => {
        // subtotal 10.000 + propina 2.000 = total_cents 12.000. La base facturable
        // ARCA debe ser 10.000 (la propina no integra la base imponible en AR).
        const { data: order } = await supabase
          .from("orders")
          .insert({
            business_id: businessId,
            customer_name: "AFIP tip",
            customer_phone: "0",
            delivery_type: "dine_in",
            subtotal_cents: 10_000,
            tip_cents: 2_000,
            total_cents: 12_000,
            lifecycle_status: "open",
          })
          .select("id")
          .single();
        const orderId = order!.id as string;

        const r = await emitInvoice({ orderId, slug: businessSlug });
        expect(r.ok).toBe(true);
        if (!r.ok) return;

        const { data: inv } = await supabase
          .from("invoices")
          .select("total_cents, neto_cents, iva_cents")
          .eq("order_id", orderId)
          .eq("status", "authorized")
          .single();
        const row = inv as {
          total_cents: number;
          neto_cents: number;
          iva_cents: number;
        };
        // El comprobante se factura sobre 10.000, no 12.000 (sin propina).
        expect(row.total_cents).toBe(10_000);
        expect(row.neto_cents + row.iva_cents).toBe(10_000);
      },
    );

    it(
      "doble emisión con misma idempotency_key → un solo comprobante",
      { timeout: 30_000 },
      async () => {
        const orderId = await newOrder();
        const key = `${orderId}:factura_b`;

        const r1 = await emitInvoice({
          orderId,
          slug: businessSlug,
          idempotencyKey: key,
        });
        const r2 = await emitInvoice({
          orderId,
          slug: businessSlug,
          idempotencyKey: key,
        });

        expect(r1.ok).toBe(true);
        // El segundo intento o devuelve el mismo comprobante, o rebota por guard.
        if (r2.ok && r1.ok) {
          expect(r2.data.invoice.id).toBe(r1.data.invoice.id);
        } else {
          expect(r2.ok).toBe(false);
        }

        const { count } = await supabase
          .from("invoices")
          .select("id", { count: "exact", head: true })
          .eq("order_id", orderId)
          .eq("status", "authorized");
        expect(count).toBe(1);
      },
    );

    it(
      "orden ya facturada → rechaza re-emisión",
      { timeout: 30_000 },
      async () => {
        const orderId = await newOrder();
        const first = await emitInvoice({ orderId, slug: businessSlug });
        expect(first.ok).toBe(true);

        const again = await emitInvoice({ orderId, slug: businessSlug });
        expect(again.ok).toBe(false);
        if (!again.ok)
          expect(again.error).toMatch(/ya tiene una factura autorizada/i);
      },
    );

    it(
      "Factura A sobre una B viva → rechazo (spec 100), y sale sola después de anular",
      { timeout: 40_000 },
      async () => {
        // El caso llega solo: le hicimos la B y después pide la A. El guard era por
        // TIPO —igual que el índice único—, así que la A entraba limpia y la orden
        // quedaba con las dos autorizadas por el mismo consumo.
        const orderId = await newOrder();
        const b = await emitInvoice({ orderId, slug: businessSlug });
        expect(b.ok).toBe(true);
        if (!b.ok) return;

        const a = await emitInvoice({
          orderId,
          slug: businessSlug,
          tipoComprobante: "factura_a",
          cuitReceptor: "20307123459",
          condicionIvaReceptor: 1,
        });
        expect(a.ok).toBe(false);
        if (!a.ok) expect(a.error).toMatch(/Factura B .* autorizada/i);

        const { count } = await supabase
          .from("invoices")
          .select("id", { count: "exact", head: true })
          .eq("order_id", orderId)
          .eq("tipo_comprobante", "factura_a");
        expect(count).toBe(0);

        // El camino correcto: NC de la B y recién ahí la A.
        const anulada = await anularFactura({
          invoiceId: b.data.invoice.id,
          motivo: "el cliente pidió Factura A",
          slug: businessSlug,
        });
        expect(anulada.ok).toBe(true);

        const aOk = await emitInvoice({
          orderId,
          slug: businessSlug,
          tipoComprobante: "factura_a",
          cuitReceptor: "20307123459",
          condicionIvaReceptor: 1,
        });
        expect(aOk.ok).toBe(true);
        if (aOk.ok) expect(aOk.data.invoice.status).toBe("authorized");
      },
    );

    it(
      "Factura A sobre una B en PROCESO → rechazo (spec 147)",
      { timeout: 40_000 },
      async () => {
        // El agujero que abrió la emisión automática: contra el gateway real,
        // `enqueue` devuelve 202 y la factura queda `pending` ~28 min. La guarda
        // sólo miraba `authorized`, y el índice único lleva el tipo — así que en esa
        // ventana la A manual entraba al lado de la B y salían DOS comprobantes con
        // CAE por el mismo consumo. El sandbox autoriza en el acto, así que este
        // estado hay que fabricarlo a mano.
        const orderId = await newOrder();
        const { data: pendiente } = await supabase
          .from("invoices")
          .insert({
            business_id: businessId,
            order_id: orderId,
            tipo_comprobante: "factura_b",
            punto_venta: 1,
            total_cents: 100_000,
            neto_cents: 82_645,
            iva_cents: 17_355,
            status: "pending",
          })
          .select("id")
          .single();
        expect(pendiente?.id).toBeTruthy();

        const a = await emitInvoice({
          orderId,
          slug: businessSlug,
          tipoComprobante: "factura_a",
          cuitReceptor: "20307123459",
          condicionIvaReceptor: 1,
        });
        expect(a.ok).toBe(false);
        if (!a.ok) expect(a.error).toMatch(/en proceso/i);

        // Lo que importa no es el mensaje: es que no exista una segunda factura.
        const { count } = await supabase
          .from("invoices")
          .select("id", { count: "exact", head: true })
          .eq("order_id", orderId)
          .eq("tipo_comprobante", "factura_a");
        expect(count).toBe(0);
      },
    );

    it(
      "anular → emite NC y deja la original cancelled con motivo",
      { timeout: 30_000 },
      async () => {
        const orderId = await newOrder();
        const emitted = await emitInvoice({ orderId, slug: businessSlug });
        expect(emitted.ok).toBe(true);
        if (!emitted.ok) return;

        const motivo = "Factura mal hecha al mozo";
        const anulada = await anularFactura({
          invoiceId: emitted.data.invoice.id,
          motivo,
          slug: businessSlug,
        });
        expect(anulada.ok).toBe(true);
        if (!anulada.ok) return;

        expect(anulada.data.original.status).toBe("cancelled");
        expect(anulada.data.original.cancelled_reason).toBe(motivo);
        expect(anulada.data.notaCredito.tipo_comprobante).toBe(
          "nota_credito_b",
        );
        expect(anulada.data.notaCredito.status).toBe("authorized");
        expect(anulada.data.notaCredito.cancels_invoice_id).toBe(
          emitted.data.invoice.id,
        );
        expect(anulada.data.notaCredito.cae).toMatch(/^SANDBOX-NCB-/);
      },
    );

    it(
      "anular sin motivo → falla y no cambia la factura",
      { timeout: 30_000 },
      async () => {
        const orderId = await newOrder();
        const emitted = await emitInvoice({ orderId, slug: businessSlug });
        expect(emitted.ok).toBe(true);
        if (!emitted.ok) return;

        const r = await anularFactura({
          invoiceId: emitted.data.invoice.id,
          motivo: "   ",
          slug: businessSlug,
        });
        expect(r.ok).toBe(false);

        const { data: still } = await supabase
          .from("invoices")
          .select("status")
          .eq("id", emitted.data.invoice.id)
          .single();
        expect((still as { status: string }).status).toBe("authorized");
      },
    );

    it(
      "re-facturar tras anular → emite nuevo comprobante authorized",
      { timeout: 30_000 },
      async () => {
        const orderId = await newOrder();
        const first = await emitInvoice({ orderId, slug: businessSlug });
        expect(first.ok).toBe(true);
        if (!first.ok) return;

        const anulada = await anularFactura({
          invoiceId: first.data.invoice.id,
          motivo: "Error de carga",
          slug: businessSlug,
        });
        expect(anulada.ok).toBe(true);

        // Con la original cancelled, el guard ya no bloquea: se re-factura.
        const refacturada = await emitInvoice({ orderId, slug: businessSlug });
        expect(refacturada.ok).toBe(true);
        if (!refacturada.ok) return;
        expect(refacturada.data.invoice.status).toBe("authorized");
        expect(refacturada.data.invoice.id).not.toBe(first.data.invoice.id);
      },
    );

    // ── Condición IVA del receptor (spec 053 · R-C6 del #51) ──────────
    it(
      "Factura B con CUIT + condición Monotributo → authorized y persiste condicion_iva_receptor=6",
      { timeout: 30_000 },
      async () => {
        const orderId = await newOrder();
        const r = await emitInvoice({
          orderId,
          slug: businessSlug,
          tipoComprobante: "factura_b",
          cuitReceptor: "20307123459",
          condicionIvaReceptor: 6,
        });
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        expect(r.data.invoice.status).toBe("authorized");

        const { data: inv } = await supabase
          .from("invoices")
          .select("cuit_receptor, condicion_iva_receptor, provider_response")
          .eq("id", r.data.invoice.id)
          .single();
        const row = inv as {
          cuit_receptor: string;
          condicion_iva_receptor: number;
          provider_response: {
            gatewayBody?: {
              receptor?: { condicion_iva?: number; doc_tipo?: number };
            };
          };
        };
        expect(row.cuit_receptor).toBe("20307123459");
        expect(row.condicion_iva_receptor).toBe(6);
        // Valor de WIRE: lo que viajaría al gateway real (no solo la columna).
        expect(row.provider_response.gatewayBody?.receptor?.condicion_iva).toBe(
          6,
        );
        expect(row.provider_response.gatewayBody?.receptor?.doc_tipo).toBe(80);
      },
    );

    it(
      "A + Consumidor Final / A + Exento → rechazo por coherencia (RG 5616)",
      { timeout: 30_000 },
      async () => {
        for (const cond of [5, 4] as const) {
          const orderId = await newOrder();
          const r = await emitInvoice({
            orderId,
            slug: businessSlug,
            tipoComprobante: "factura_a",
            cuitReceptor: "20307123459",
            condicionIvaReceptor: cond,
          });
          expect(r.ok).toBe(false);
          const { count } = await supabase
            .from("invoices")
            .select("id", { count: "exact", head: true })
            .eq("order_id", orderId);
          expect(count).toBe(0);
        }
      },
    );

    it(
      "condición ≠ Consumidor Final SIN CUIT → rechazo (doc_tipo 99 coherente)",
      { timeout: 30_000 },
      async () => {
        const orderId = await newOrder();
        const r = await emitInvoice({
          orderId,
          slug: businessSlug,
          tipoComprobante: "factura_b",
          condicionIvaReceptor: 1, // RI sin CUIT: incoherente
        });
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.error).toMatch(/consumidor final/i);
        const { count } = await supabase
          .from("invoices")
          .select("id", { count: "exact", head: true })
          .eq("order_id", orderId);
        expect(count).toBe(0);
      },
    );

    it(
      "Factura B con CUIT SIN condición → rechazo (guard R-C6), cero comprobante",
      { timeout: 30_000 },
      async () => {
        const orderId = await newOrder();
        const r = await emitInvoice({
          orderId,
          slug: businessSlug,
          tipoComprobante: "factura_b",
          cuitReceptor: "20307123459",
        });
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.error).toMatch(/condición de IVA/i);

        const { count } = await supabase
          .from("invoices")
          .select("id", { count: "exact", head: true })
          .eq("order_id", orderId);
        expect(count).toBe(0);
      },
    );

    it(
      "Factura B sin CUIT → condicion_iva_receptor NULL (regresión: camino feliz intacto)",
      { timeout: 30_000 },
      async () => {
        const orderId = await newOrder();
        const r = await emitInvoice({ orderId, slug: businessSlug });
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        const { data: inv } = await supabase
          .from("invoices")
          .select("cuit_receptor, condicion_iva_receptor")
          .eq("id", r.data.invoice.id)
          .single();
        const row = inv as {
          cuit_receptor: string | null;
          condicion_iva_receptor: number | null;
        };
        expect(row.cuit_receptor).toBeNull();
        expect(row.condicion_iva_receptor).toBeNull();
      },
    );

    it(
      "anular una B con condición declarada → la NC hereda condicion_iva_receptor",
      { timeout: 30_000 },
      async () => {
        const orderId = await newOrder();
        const emitted = await emitInvoice({
          orderId,
          slug: businessSlug,
          tipoComprobante: "factura_b",
          cuitReceptor: "20307123459",
          condicionIvaReceptor: 6,
        });
        expect(emitted.ok).toBe(true);
        if (!emitted.ok) return;

        const anulada = await anularFactura({
          invoiceId: emitted.data.invoice.id,
          motivo: "Condición mal cargada",
          slug: businessSlug,
        });
        expect(anulada.ok).toBe(true);
        if (!anulada.ok) return;

        const { data: nc } = await supabase
          .from("invoices")
          .select("condicion_iva_receptor, provider_response")
          .eq("id", anulada.data.notaCredito.id)
          .single();
        const ncRow = nc as {
          condicion_iva_receptor: number;
          provider_response: {
            gatewayBody?: { receptor?: { condicion_iva?: number } };
          };
        };
        expect(ncRow.condicion_iva_receptor).toBe(6);
        // Costura row→wire de anular: la condición del ENQUEUE de la NC viene de la
        // fila original, no re-derivada del tipo (si no, NC-B caería a 5). Spec 053.
        expect(
          ncRow.provider_response.gatewayBody?.receptor?.condicion_iva,
        ).toBe(6);
      },
    );

    // ── El recargo / descuento por método va en el comprobante (#274 · 7) ──
    //
    // La base facturable era `total_cents − tip_cents` y el ajuste por método
    // vive en `payments.adjustment_cents`, que el motor no leía nunca (grep
    // `adjustment` en src/lib/afip/ daba cero). El comprobante declaraba
    // siempre el precio de lista, no lo que el cliente pagó.
    const cobrarCon = async (
      orderId: string,
      amountCents: number,
      adjustmentCents: number,
    ) => {
      const { data: caja } = await supabase
        .from("cajas")
        .select("id")
        .eq("business_id", businessId)
        .limit(1)
        .single();
      await supabase.from("payments").insert({
        order_id: orderId,
        business_id: businessId,
        caja_id: caja!.id,
        method: "cash",
        amount_cents: amountCents,
        adjustment_cents: adjustmentCents,
        payment_status: "paid",
      });
    };

    it(
      "recargo por método: el comprobante declara lo que el cliente pagó",
      { timeout: 30_000 },
      async () => {
        // Cuenta de $1.000 cobrada con 5% de recargo: entran $1.050.
        const orderId = await newOrder(100_000);
        await cobrarCon(orderId, 105_000, 5_000);

        const r = await emitInvoice({ orderId, slug: businessSlug });
        expect(r.ok).toBe(true);
        if (!r.ok) return;

        const { data: inv } = await supabase
          .from("invoices")
          .select("total_cents, neto_cents, iva_cents, provider_response")
          .eq("id", r.data.invoice.id)
          .single();
        const row = inv as {
          total_cents: number;
          neto_cents: number;
          iva_cents: number;
          provider_response: { gatewayBody?: { importe_total?: number } };
        };
        expect(row.total_cents).toBe(105_000);
        expect(row.neto_cents + row.iva_cents).toBe(105_000);
        // Valor de WIRE: lo que viajaría a ARCA, no sólo la columna.
        expect(row.provider_response.gatewayBody?.importe_total).toBe(1_050);
      },
    );

    it(
      "descuento por método: el comprobante NO declara plata que no entró",
      { timeout: 30_000 },
      async () => {
        // La dirección más grave, y la que el producto ofrece de verdad
        // («pagar en efectivo sale menos», Ajustes › Cobros admite negativos):
        // facturar de más es declarar IVA sobre plata que nunca entró y darle
        // al cliente un comprobante por más de lo que pagó.
        const orderId = await newOrder(100_000);
        await cobrarCon(orderId, 90_000, -10_000);

        const r = await emitInvoice({ orderId, slug: businessSlug });
        expect(r.ok).toBe(true);
        if (!r.ok) return;

        const { data: inv } = await supabase
          .from("invoices")
          .select("total_cents")
          .eq("id", r.data.invoice.id)
          .single();
        expect((inv as { total_cents: number }).total_cents).toBe(90_000);
      },
    );

    it(
      "un pago reembolsado no mueve la base facturable",
      { timeout: 30_000 },
      async () => {
        const orderId = await newOrder(100_000);
        await cobrarCon(orderId, 105_000, 5_000);
        await supabase
          .from("payments")
          .update({ payment_status: "refunded" })
          .eq("order_id", orderId);
        await cobrarCon(orderId, 100_000, 0);

        const r = await emitInvoice({ orderId, slug: businessSlug });
        expect(r.ok).toBe(true);
        if (!r.ok) return;

        const { data: inv } = await supabase
          .from("invoices")
          .select("total_cents")
          .eq("id", r.data.invoice.id)
          .single();
        expect((inv as { total_cents: number }).total_cents).toBe(100_000);
      },
    );

    // ── «Reintentar» pasa por las mismas guardas que emitir (#274 · 2) ──
    //
    // `retryInvoice` no llama a `emitInvoiceCore`: encola contra el provider
    // directo. Las dos guardas que el motor sí tiene —orden anulada (spec 092)
    // y comprobante vigente cruzando tipos (spec 100)— no existían de este
    // lado, y «Reintentar» es el botón que la pantalla ofrece con el cartel
    // rojo: en golf-jcr, con 14 rechazos en un mes, es el camino natural.
    it(
      "reintentar sobre una orden anulada → rechazo, la factura sigue failed (spec 092)",
      { timeout: 30_000 },
      async () => {
        const orderId = await newOrder();
        const { data: failedRow } = await supabase
          .from("invoices")
          .insert({
            business_id: businessId,
            order_id: orderId,
            tipo_comprobante: "factura_b",
            punto_venta: 1,
            total_cents: 12_100,
            neto_cents: 10_000,
            iva_cents: 2_100,
            iva_rate: 21,
            status: "failed",
            provider: "sandbox",
            idempotency_key: `${orderId}:factura_b`,
            error_message: "forzado para test",
          })
          .select("id")
          .single();
        const failedId = failedRow!.id as string;

        // El camino real: con la factura `failed` nada bloquea anular la mesa.
        await supabase
          .from("orders")
          .update({ lifecycle_status: "cancelled", status: "cancelled" })
          .eq("id", orderId);

        const r = await retryInvoice(failedId, businessSlug);
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.error).toMatch(/anulada/i);

        // Lo que importa no es el mensaje: es que no haya CAE nuevo.
        const { data: still } = await supabase
          .from("invoices")
          .select("status, cae")
          .eq("id", failedId)
          .single();
        expect((still as { status: string }).status).toBe("failed");
        expect((still as { cae: string | null }).cae).toBeNull();
      },
    );

    it(
      "reintentar una A fallida con una B viva → rechazo, no quedan dos CAE (spec 100)",
      { timeout: 40_000 },
      async () => {
        // El índice único parcial es (business, order, tipo): A ≠ B, así que la
        // base no lo impide. Es el desenlace del caso «pedí la A, ARCA la
        // rechazó, emití una B para salir del paso» — y después alguien vuelve
        // al comprobante rojo y toca Reintentar.
        const orderId = await newOrder();
        const { data: failedA } = await supabase
          .from("invoices")
          .insert({
            business_id: businessId,
            order_id: orderId,
            tipo_comprobante: "factura_a",
            punto_venta: 1,
            cuit_receptor: "20307123459",
            condicion_iva_receptor: 1,
            total_cents: 12_100,
            neto_cents: 10_000,
            iva_cents: 2_100,
            iva_rate: 21,
            status: "failed",
            provider: "sandbox",
            idempotency_key: `${orderId}:factura_a`,
            error_message: "ARCA rechazó el CUIT",
          })
          .select("id")
          .single();
        const failedAId = failedA!.id as string;

        const b = await emitInvoice({ orderId, slug: businessSlug });
        expect(b.ok).toBe(true);

        const r = await retryInvoice(failedAId, businessSlug);
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.error).toMatch(/Factura B/i);

        const { count } = await supabase
          .from("invoices")
          .select("id", { count: "exact", head: true })
          .eq("order_id", orderId)
          .eq("status", "authorized")
          .in("tipo_comprobante", ["factura_a", "factura_b"]);
        expect(count).toBe(1);
      },
    );

    it(
      "retry de una B-con-CUIT fallida → re-encola con la condición de la fila (costura row→wire)",
      { timeout: 30_000 },
      async () => {
        const orderId = await newOrder();
        // Insertamos directamente una factura `failed` con condición declarada
        // (el sandbox nunca falla, así que fabricamos el estado a mano).
        const { data: failedRow } = await supabase
          .from("invoices")
          .insert({
            business_id: businessId,
            order_id: orderId,
            tipo_comprobante: "factura_b",
            punto_venta: 1,
            cuit_receptor: "20307123459",
            condicion_iva_receptor: 6,
            total_cents: 12_100,
            neto_cents: 10_000,
            iva_cents: 2_100,
            iva_rate: 21,
            status: "failed",
            provider: "sandbox",
            idempotency_key: `${orderId}:factura_b`,
            error_message: "forzado para test",
          })
          .select("id")
          .single();
        const failedId = failedRow!.id as string;

        const r = await retryInvoice(failedId, businessSlug);
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        expect(r.data.invoice.status).toBe("authorized");

        const { data: inv } = await supabase
          .from("invoices")
          .select("condicion_iva_receptor, provider_response")
          .eq("id", failedId)
          .single();
        const row = inv as {
          condicion_iva_receptor: number;
          provider_response: {
            gatewayBody?: { receptor?: { condicion_iva?: number } };
          };
        };
        expect(row.condicion_iva_receptor).toBe(6);
        // El valor que viaja al gateway en el retry sale de la fila, no del tipo.
        expect(row.provider_response.gatewayBody?.receptor?.condicion_iva).toBe(
          6,
        );
      },
    );
  },
);
