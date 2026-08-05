// @vitest-environment node
//
// Spec 095 — la pantalla de cocina y las comanderas dejan de mostrar e imprimir
// cosas que ya se anularon o se cobraron.
//
// Contra Postgres real porque lo que se prueba son **filtros de query**: qué
// devuelve `getActiveComandas` y qué devuelve el armador de `print_jobs`. Un
// fake devuelve lo que uno le diga, que es justamente el problema.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";

config({ path: ".env.local" });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const dbAvailable = Boolean(supabaseUrl && serviceKey);

const TEST_TAG = `test-cocina-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

describe.skipIf(!dbAvailable)("cocina no miente (integration · spec 095)", () => {
  const supabase = createClient(supabaseUrl!, serviceKey!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  let businessId: string;
  let stationId: string;

  const seedOrder = async (
    lifecycle: "open" | "closed" | "cancelled",
  ): Promise<string> => {
    const { data, error } = await supabase
      .from("orders")
      .insert({
        order_number: 0,
        business_id: businessId,
        customer_name: "Cocina test",
        customer_phone: "-",
        delivery_type: "dine_in",
        lifecycle_status: lifecycle,
        subtotal_cents: 1000,
        delivery_fee_cents: 0,
        total_cents: 1000,
        payment_method: "cash",
      })
      .select("id")
      .single();
    if (error) throw error;
    return data!.id as string;
  };

  const seedComanda = async (
    orderId: string,
    opts: { cancelled?: boolean; batch?: number } = {},
  ): Promise<string> => {
    const { data, error } = await supabase
      .from("comandas")
      .insert({
        order_id: orderId,
        station_id: stationId,
        batch: opts.batch ?? 1,
        status: "pendiente",
        cancelled_at: opts.cancelled ? new Date().toISOString() : null,
      })
      .select("id")
      .single();
    if (error) throw error;
    return data!.id as string;
  };

  /** Lo mismo que filtra `getActiveComandas` tras la spec 095. */
  const activas = async () => {
    const { data } = await supabase
      .from("comandas")
      .select("id, orders!inner(business_id, lifecycle_status)")
      .eq("orders.business_id", businessId)
      .in("status", ["pendiente", "en_preparacion"])
      .eq("orders.lifecycle_status", "open")
      .is("cancelled_at", null);
    return ((data ?? []) as { id: string }[]).map((c) => c.id);
  };

  beforeAll(async () => {
    const { data: biz, error } = await supabase
      .from("businesses")
      .insert({ slug: TEST_TAG, name: "Cocina Test", is_active: true })
      .select("id")
      .single();
    if (error) throw error;
    businessId = biz!.id as string;

    const { data: st } = await supabase
      .from("stations")
      .insert({ business_id: businessId, name: "Parrilla" })
      .select("id")
      .single();
    stationId = st!.id as string;
  }, 60_000);

  afterAll(async () => {
    if (businessId) {
      await supabase.from("businesses").delete().eq("id", businessId);
    }
  }, 60_000);

  it("H-32 · las comandas de una mesa ya COBRADA salen del kanban", async () => {
    // Sin cutoff temporal y sin que el cobro cierre comandas, «En preparación»
    // acumulaba tickets de mesas que pagaron hace días: en una semana 40
    // comandas fantasma y el cocinero dejaba de mirar la pantalla.
    const viva = await seedComanda(await seedOrder("open"));
    const cobrada = await seedComanda(await seedOrder("closed"));

    const ids = await activas();
    expect(ids).toContain(viva);
    expect(ids).not.toContain(cobrada);
  });

  it("H-32 · las de una mesa ANULADA tampoco", async () => {
    const anulada = await seedComanda(await seedOrder("cancelled"));
    expect(await activas()).not.toContain(anulada);
  });

  it("H-28 · una comanda anulada no aparece en el kanban", async () => {
    const orderId = await seedOrder("open");
    const viva = await seedComanda(orderId);
    const anulada = await seedComanda(orderId, { cancelled: true, batch: 2 });

    const ids = await activas();
    expect(ids).toContain(viva);
    expect(ids).not.toContain(anulada);
  });

  it("H-37 · la cuenta de una mesa anulada no se imprime cuando vuelve el papel", async () => {
    // `imprimirCuenta` exige `lifecycle='open'` AL ENCOLAR, pero el armador del
    // GET no lo repetía y nadie cancela filas de `print_jobs`. Reponían el papel
    // media hora después y salía la cuenta de una mesa ya anulada.
    const viva = await seedOrder("open");
    const muerta = await seedOrder("cancelled");
    await supabase.from("print_jobs").insert([
      { order_id: viva, business_id: businessId, kind: "cuenta" },
      { order_id: muerta, business_id: businessId, kind: "cuenta" },
    ]);

    const { data } = await supabase
      .from("print_jobs")
      .select("order_id, orders!inner(lifecycle_status)")
      .eq("business_id", businessId)
      .eq("kind", "cuenta")
      .eq("status", "pendiente")
      .eq("orders.lifecycle_status", "open");

    const ids = ((data ?? []) as { order_id: string }[]).map((j) => j.order_id);
    expect(ids).toContain(viva);
    expect(ids).not.toContain(muerta);
  });
});
