// @vitest-environment node
//
// P11 · issue #264 — el reparto de un cajón sólo puede restar lo que salió DE
// ese cajón.
//
// `stats.expected_cash_cents` se calcula **por caja** (`getCajaStatsEnVentana`
// filtra `caja_id`), pero el pendiente del mozo se leía **por negocio**. Con
// dos cajas —demo y golf-house tienen Principal + Bar— al cajón de la Principal
// se le descontaba el efectivo que el mozo había cobrado en el Bar: plata que
// nunca estuvo en el esperado de la Principal.
//
// El encargado abre el cierre, lee «en el cajón deberías tener» ya con el
// descuento de más, cuenta, y le sobra. Y el reparto existe justamente para que
// la diferencia esté explicada ANTES de contar — o sea que el número que venía
// a dar tranquilidad era el que mentía.
//
// Lo que NO cambia: lo que el mozo debe rendir sigue siendo de todo el negocio.
// La plata la tiene encima una sola vez y la entrega una sola vez.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";

config({ path: ".env.local" });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const dbAvailable = Boolean(supabaseUrl && serviceKey);

const TEST_TAG = `test-reparto-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

const { getRendicionPendienteMozo } = await import("./queries");

describe.skipIf(!dbAvailable)("caja · reparto por caja (integration)", () => {
  const supabase = createClient(supabaseUrl!, serviceKey!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const EN_PRINCIPAL = 30_000;
  const EN_BAR = 65_000;

  let businessId: string;
  let mozoId: string;
  let cajaPrincipalId: string;
  let cajaBarId: string;

  beforeAll(async () => {
    const email = `${TEST_TAG}@example.test`;
    const { data: u } = await supabase.auth.admin.createUser({
      email,
      password: "test-pass-12345",
      email_confirm: true,
    });
    mozoId = u!.user!.id;
    await supabase.from("users").upsert({ id: mozoId, email, full_name: "Mozo" });

    const { data: biz } = await supabase
      .from("businesses")
      .insert({ slug: TEST_TAG, name: "Reparto Test", is_active: true })
      .select("id")
      .single();
    businessId = biz!.id;
    await supabase.from("business_users").insert({
      business_id: businessId, user_id: mozoId, role: "mozo", full_name: "Mozo",
    });

    const { data: cajas, error: cajasErr } = await supabase
      .from("cajas")
      .insert([
        { business_id: businessId, name: "Caja Principal", is_default: true },
        { business_id: businessId, name: "Caja Bar", is_default: false },
      ])
      .select("id, name");
    if (cajasErr) throw new Error(`seed cajas: ${cajasErr.message}`);
    cajaPrincipalId = cajas!.find((c) => c.name === "Caja Principal")!.id;
    cajaBarId = cajas!.find((c) => c.name === "Caja Bar")!.id;

    // Un cobro en efectivo en cada caja, los dos atribuidos al mismo mozo.
    const { data: order } = await supabase
      .from("orders")
      .insert({
        business_id: businessId, customer_name: "C", customer_phone: "0",
        delivery_type: "dine_in", subtotal_cents: EN_PRINCIPAL + EN_BAR,
        total_cents: EN_PRINCIPAL + EN_BAR, lifecycle_status: "open",
      })
      .select("id")
      .single();

    await supabase.from("payments").insert([
      { order_id: order!.id, business_id: businessId, caja_id: cajaPrincipalId,
        operated_by: mozoId, attributed_mozo_id: mozoId, method: "cash",
        amount_cents: EN_PRINCIPAL, tip_cents: 0, payment_status: "paid" },
      { order_id: order!.id, business_id: businessId, caja_id: cajaBarId,
        operated_by: mozoId, attributed_mozo_id: mozoId, method: "cash",
        amount_cents: EN_BAR, tip_cents: 0, payment_status: "paid" },
    ]);
  });

  afterAll(async () => {
    if (businessId) await supabase.from("businesses").delete().eq("id", businessId);
    if (mozoId) {
      await supabase.from("users").delete().eq("id", mozoId);
      await supabase.auth.admin.deleteUser(mozoId);
    }
  });

  it("sin scope, el mozo debe todo lo del negocio: es lo que tiene encima", async () => {
    const r = await getRendicionPendienteMozo(mozoId, businessId, "Mozo");
    expect(r.efectivo_cents).toBe(EN_PRINCIPAL + EN_BAR);
  });

  it("al cajón de la Principal sólo se le resta lo que se cobró en la Principal", async () => {
    const r = await getRendicionPendienteMozo(
      mozoId, businessId, "Mozo", cajaPrincipalId,
    );
    expect(r.efectivo_cents).toBe(EN_PRINCIPAL);
  });

  it("y al del Bar, lo del Bar", async () => {
    const r = await getRendicionPendienteMozo(
      mozoId, businessId, "Mozo", cajaBarId,
    );
    expect(r.efectivo_cents).toBe(EN_BAR);
  });
});
