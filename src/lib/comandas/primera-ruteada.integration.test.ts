// @vitest-environment node
//
// P06 · issue #259 — dos pestañas confirmando no mandan el plato dos veces.
//
// `routeOrderToCocina` chequea idempotencia contando comandas, y el batch se
// leía aparte con `max(batch)+1`. Entre las dos lecturas de la segunda pestaña
// entra el insert de la primera: el conteo dio cero pero el `lastBatch` ya vio
// el 1, y se creaba un **batch 2 con los mismos ítems**. El unique de
// `(order_id, station_id, batch)` no lo tapaba: son batches distintos. La cocina
// recibía dos papeles bien formados, sin marca de reimpresión.
//
// Con `primeraRuteada` el batch se fuerza a 1 y el unique arbitra: la segunda
// llamada choca con 23505 y se va sin crear nada.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";

config({ path: ".env.local" });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const dbAvailable = Boolean(supabaseUrl && serviceKey);

const TEST_TAG = `test-ruteada-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

const { createComandasForItems } = await import("./route-items");

describe.skipIf(!dbAvailable)("comandas · primera ruteada (integration)", () => {
  const supabase = createClient(supabaseUrl!, serviceKey!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  let businessId: string;
  let stationId: string;
  let orderId: string;
  let itemId: string;

  beforeAll(async () => {
    const { data: biz } = await supabase
      .from("businesses")
      .insert({ slug: TEST_TAG, name: "Ruteada Test", is_active: true })
      .select("id").single();
    businessId = biz!.id;

    const { data: st } = await supabase
      .from("stations")
      .insert({ business_id: businessId, name: "Cocina" })
      .select("id").single();
    stationId = st!.id;

    const { data: order } = await supabase
      .from("orders")
      .insert({
        business_id: businessId, customer_name: "C", customer_phone: "0",
        delivery_type: "delivery", subtotal_cents: 5_000, total_cents: 5_000,
        lifecycle_status: "open",
      })
      .select("id").single();
    orderId = order!.id;

    const { data: item } = await supabase
      .from("order_items")
      .insert({
        order_id: orderId, product_name: "Milanesa", unit_price_cents: 5_000,
        quantity: 1, subtotal_cents: 5_000,
      })
      .select("id").single();
    itemId = item!.id;
  });

  afterAll(async () => {
    if (businessId) await supabase.from("businesses").delete().eq("id", businessId);
  });

  it("la segunda ruteada del mismo pedido no crea una comanda nueva", async () => {
    const itemsByStation = new Map([[stationId, [itemId]]]);

    const primera = await createComandasForItems(
      supabase as never, orderId, itemsByStation, { primeraRuteada: true },
    );
    expect(primera.ok).toBe(true);

    const segunda = await createComandasForItems(
      supabase as never, orderId, itemsByStation, { primeraRuteada: true },
    );
    // No falla: es idempotencia, no error. Pero no crea nada.
    expect(segunda.ok).toBe(true);

    const { count } = await supabase
      .from("comandas")
      .select("id", { count: "exact", head: true })
      .eq("order_id", orderId);
    expect(count).toBe(1);
  });

  it("sin el flag, una segunda tanda SÍ crea su comanda (la mesa que pide más)", async () => {
    const itemsByStation = new Map([[stationId, [itemId]]]);
    await createComandasForItems(supabase as never, orderId, itemsByStation, {
      primeraRuteada: false,
    });

    const { count } = await supabase
      .from("comandas")
      .select("id", { count: "exact", head: true })
      .eq("order_id", orderId);
    expect(count).toBe(2);
  });
});
