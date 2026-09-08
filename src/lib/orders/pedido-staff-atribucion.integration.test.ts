// @vitest-environment node
//
// P07 · issue #260 — el pedido que carga el staff tiene dueño.
//
// `persistOrder` nunca escribía `order_items.loaded_by`, y de ahí colgaba una
// cadena: sin esa columna y sin mesa, `deriveAttributedMozo` no encuentra a
// nadie y el cobro queda con `attributed_mozo_id` en NULL. El pedido no entra
// en «Ventas y propinas por mozo» (que filtra por esa columna) y —lo caro— si
// se cobró en efectivo, el que lo cobró **no aparece en «deben rendir»**: tiene
// la plata encima y el sistema no se la reclama.
//
// El contrato del módulo ya decía cuál era la respuesta: «lo que no tiene mesa
// sigue cayendo en loaded_by, que ahí es la respuesta correcta».
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";

config({ path: ".env.local" });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const dbAvailable = Boolean(supabaseUrl && serviceKey);

const TAG = `test-atrib-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

const { persistOrder } = await import("./persist-order");

describe.skipIf(!dbAvailable)("persistOrder · quién cargó la línea", () => {
  const db = createClient(supabaseUrl!, serviceKey!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  let businessId: string;
  let staffId: string;
  let productId: string;

  beforeAll(async () => {
    const email = `${TAG}@example.test`;
    const { data: u } = await db.auth.admin.createUser({
      email, password: "test-pass-12345", email_confirm: true,
    });
    staffId = u!.user!.id;
    await db.from("users").upsert({ id: staffId, email, full_name: "Encargada" });

    const { data: biz } = await db
      .from("businesses")
      .insert({ slug: TAG, name: "Atrib Test", is_active: true })
      .select("id").single();
    businessId = biz!.id;
    await db.from("business_users").insert({
      business_id: businessId, user_id: staffId, role: "encargado", full_name: "Encargada",
    });

    const { data: cat } = await db
      .from("categories")
      .insert({ business_id: businessId, name: "Cat", slug: "cat", sort_order: 1 })
      .select("id").single();
    const { data: prod } = await db
      .from("products")
      .insert({
        business_id: businessId, category_id: cat!.id, name: "Plato",
        slug: "plato", price_cents: 10_000, is_available: true,
      })
      .select("id").single();
    productId = prod!.id;
  });

  afterAll(async () => {
    if (businessId) await db.from("businesses").delete().eq("id", businessId);
    if (staffId) {
      await db.from("users").delete().eq("id", staffId);
      await db.auth.admin.deleteUser(staffId);
    }
  });

  it("el pedido cargado por el staff deja `loaded_by` en la línea", async () => {
    const res = await persistOrder(
      {
        business_slug: TAG,
        delivery_type: "pickup",
        customer_name: "Cliente",
        customer_phone: "111",
        items: [{ product_id: productId, quantity: 1, modifier_ids: [] }],
        payment_method: "cash",
      } as never,
      staffId,
      { mozoId: staffId },
    );
    expect(res.ok, res.ok ? "" : res.error).toBe(true);
    if (!res.ok) return;

    const { data: items } = await db
      .from("order_items")
      .select("loaded_by")
      .eq("order_id", res.data.order_id);
    expect((items ?? [])[0]!.loaded_by).toBe(staffId);
  });

  it("el pedido del checkout público no lo cargó nadie del local", async () => {
    const res = await persistOrder(
      {
        business_slug: TAG,
        delivery_type: "pickup",
        customer_name: "Cliente Web",
        customer_phone: "222",
        items: [{ product_id: productId, quantity: 1, modifier_ids: [] }],
        payment_method: "cash",
      } as never,
      null,
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    const { data: items } = await db
      .from("order_items")
      .select("loaded_by")
      .eq("order_id", res.data.order_id);
    expect((items ?? [])[0]!.loaded_by).toBeNull();
  });
});
