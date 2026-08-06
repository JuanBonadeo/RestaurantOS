// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";

config({ path: ".env.local" });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const dbAvailable = Boolean(supabaseUrl && serviceKey);

const TEST_TAG = `test-stock-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

let CURRENT_USER_ID = "";

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({
    auth: {
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

const { toggleTrackStock, setStockLevels, ingresarStock, ajustarStock, setBarStock } =
  await import("./actions");
const { getStockOverview, getBarStockOverview, getStockMovimientos, getLowStockCount } =
  await import("./queries");

describe.skipIf(!dbAvailable)("stock de bebidas (integration)", () => {
  const supabase = createClient(supabaseUrl!, serviceKey!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  let businessId: string;
  let businessSlug: string;
  let adminId: string;
  let encargadoId: string;
  let mozoId: string;
  let productId: string;
  let categoryId: string;

  const seedUser = async (label: string) => {
    const email = `${TEST_TAG}-${label}@example.test`;
    const { data: created } = await supabase.auth.admin.createUser({
      email,
      password: "test-pass-12345",
      email_confirm: true,
    });
    const id = created!.user!.id;
    await supabase.from("users").upsert({ id, email, full_name: label });
    return id;
  };

  beforeAll(async () => {
    adminId = await seedUser("Admin");
    encargadoId = await seedUser("Encargado");
    mozoId = await seedUser("Mozo");

    const { data: biz } = await supabase
      .from("businesses")
      .insert({ slug: TEST_TAG, name: "Stock Test", is_active: true })
      .select("id, slug")
      .single();
    businessId = biz!.id;
    businessSlug = biz!.slug;

    await supabase.from("business_users").insert([
      { business_id: businessId, user_id: adminId, role: "admin", full_name: "Admin" },
      { business_id: businessId, user_id: encargadoId, role: "encargado", full_name: "Encargado" },
      { business_id: businessId, user_id: mozoId, role: "mozo", full_name: "Mozo" },
    ]);

    const { data: cat } = await supabase
      .from("categories")
      .insert({ business_id: businessId, name: "Bebidas Test", slug: `bebidas-${TEST_TAG}`, sort_order: 0 })
      .select("id")
      .single();
    categoryId = cat!.id;

    const { data: prod } = await supabase
      .from("products")
      .insert({
        business_id: businessId,
        category_id: categoryId,
        name: "Cerveza Test",
        slug: `cerveza-${TEST_TAG}`,
        price_cents: 500000,
        is_active: true,
        is_available: true,
        sort_order: 0,
      })
      .select("id")
      .single();
    productId = prod!.id;
  }, 30_000);

  afterAll(async () => {
    await supabase.from("stock_movimientos").delete().eq("business_id", businessId);
    await supabase.from("stock_items").delete().eq("business_id", businessId);
    await supabase.from("products").delete().eq("business_id", businessId);
    await supabase.from("categories").delete().eq("business_id", businessId);
    await supabase.from("business_users").delete().eq("business_id", businessId);
    await supabase.from("businesses").delete().eq("id", businessId);
    for (const uid of [adminId, encargadoId, mozoId]) {
      await supabase.auth.admin.deleteUser(uid);
    }
  }, 30_000);

  it("toggle track stock + set initial levels", async () => {
    CURRENT_USER_ID = adminId;

    const r1 = await toggleTrackStock(productId, true, businessSlug);
    expect(r1.ok).toBe(true);

    const r2 = await setStockLevels(productId, 24, 5, businessSlug);
    expect(r2.ok).toBe(true);

    const overview = await getStockOverview(businessId);
    const item = overview.find((i) => i.productId === productId);
    expect(item).toBeDefined();
    expect(item!.currentQty).toBe(24);
    expect(item!.minQty).toBe(5);
    expect(item!.isLow).toBe(false);
  });

  it("ingreso suma correctamente", async () => {
    CURRENT_USER_ID = encargadoId;

    const r = await ingresarStock(productId, 12, businessSlug, "Proveedor");
    expect(r.ok).toBe(true);

    const overview = await getStockOverview(businessId);
    const item = overview.find((i) => i.productId === productId);
    expect(item!.currentQty).toBe(36);

    const { data: si } = await supabase
      .from("stock_items")
      .select("id")
      .eq("product_id", productId)
      .single();
    const movs = await getStockMovimientos(si!.id);
    const ingreso = movs.items.find((m) => m.kind === "ingreso" && m.qty === 12);
    expect(ingreso).toBeDefined();
    expect(ingreso!.reason).toBe("Proveedor");
  });

  it("ajuste con motivo funciona", async () => {
    CURRENT_USER_ID = encargadoId;

    const r = await ajustarStock(productId, -2, "Botella rota", businessSlug);
    expect(r.ok).toBe(true);

    const overview = await getStockOverview(businessId);
    const item = overview.find((i) => i.productId === productId);
    expect(item!.currentQty).toBe(34);
  });

  it("ajuste sin motivo falla", async () => {
    CURRENT_USER_ID = encargadoId;

    const r = await ajustarStock(productId, -1, "", businessSlug);
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.error).toContain("motivo");
  });

  it("trigger descuenta stock al insertar order_item", async () => {
    // Set stock to a known value first
    CURRENT_USER_ID = adminId;
    await setStockLevels(productId, 10, 3, businessSlug);

    // Create order + order_item directly in DB (simulating a sale)
    const { data: order } = await supabase
      .from("orders")
      .insert({
        order_number: 0,
        business_id: businessId,
        customer_name: "Test",
        customer_phone: "+5493410000000",
        delivery_type: "dine_in",
        status: "preparing",
        lifecycle_status: "open",
        subtotal_cents: 500000,
        delivery_fee_cents: 0,
        discount_cents: 0,
        total_cents: 500000,
        payment_method: "cash_on_delivery",
        payment_status: "pending",
      })
      .select("id")
      .single();

    await supabase.from("order_items").insert({
      order_id: order!.id,
      product_id: productId,
      product_name: "Cerveza Test",
      unit_price_cents: 500000,
      quantity: 2,
      subtotal_cents: 1000000,
    });

    // Wait a moment for the trigger to execute
    await new Promise((r) => setTimeout(r, 500));

    const { data: si } = await supabase
      .from("stock_items")
      .select("current_qty")
      .eq("product_id", productId)
      .single();
    expect(si!.current_qty).toBe(8);

    // Cleanup
    await supabase.from("order_items").delete().eq("order_id", order!.id);
    await supabase.from("orders").delete().eq("id", order!.id);
  });

  // Spec 099: vender más de lo que el sistema cree que hay deja el inventario
  // en negativo (el faltante es el dato) y NO saca el producto de la carta.
  it("vender más de lo que hay: stock negativo y el producto sigue disponible", async () => {
    CURRENT_USER_ID = adminId;
    await setStockLevels(productId, 1, 0, businessSlug);

    const { data: order } = await supabase
      .from("orders")
      .insert({
        order_number: 0,
        business_id: businessId,
        customer_name: "Test",
        customer_phone: "+5493410000000",
        delivery_type: "dine_in",
        status: "preparing",
        lifecycle_status: "open",
        subtotal_cents: 500000,
        delivery_fee_cents: 0,
        discount_cents: 0,
        total_cents: 500000,
        payment_method: "cash_on_delivery",
        payment_status: "pending",
      })
      .select("id")
      .single();

    await supabase.from("order_items").insert({
      order_id: order!.id,
      product_id: productId,
      product_name: "Cerveza Test",
      unit_price_cents: 500000,
      quantity: 3,
      subtotal_cents: 1500000,
    });

    await new Promise((r) => setTimeout(r, 500));

    const { data: prod } = await supabase
      .from("products")
      .select("is_available")
      .eq("id", productId)
      .single();
    expect(prod!.is_available).toBe(true);

    const { data: si } = await supabase
      .from("stock_items")
      .select("current_qty")
      .eq("product_id", productId)
      .single();
    expect(si!.current_qty).toBe(-2);

    // Y el ingreso siguiente arranca desde el faltante, no desde cero.
    CURRENT_USER_ID = encargadoId;
    const ing = await ingresarStock(productId, 12, businessSlug, "Reposición");
    expect(ing.ok).toBe(true);

    const overview = await getStockOverview(businessId);
    expect(overview.find((i) => i.productId === productId)!.currentQty).toBe(10);

    // Cleanup
    await supabase.from("order_items").delete().eq("order_id", order!.id);
    await supabase.from("orders").delete().eq("id", order!.id);
    CURRENT_USER_ID = adminId;
    await setStockLevels(productId, 10, 3, businessSlug);
  });

  // El espejo del anterior: si el encargado apagó el producto a mano, cargar
  // mercadería no puede volver a prenderlo.
  it("el ingreso no reenciende un producto apagado a mano", async () => {
    CURRENT_USER_ID = encargadoId;
    await supabase.from("products").update({ is_available: false }).eq("id", productId);

    const r = await ingresarStock(productId, 6, businessSlug, "Proveedor");
    expect(r.ok).toBe(true);

    const { data: prod } = await supabase
      .from("products")
      .select("is_available")
      .eq("id", productId)
      .single();
    expect(prod!.is_available).toBe(false);

    // Restore
    await supabase.from("products").update({ is_available: true }).eq("id", productId);
    CURRENT_USER_ID = adminId;
    await setStockLevels(productId, 10, 3, businessSlug);
  });

  // El ajuste tampoco decide sobre la carta: baja el inventario a negativo y
  // deja el producto donde estaba.
  it("el ajuste puede dejar el stock en negativo sin tocar la disponibilidad", async () => {
    CURRENT_USER_ID = encargadoId;
    await setStockLevels(productId, 2, 1, businessSlug);

    const r = await ajustarStock(productId, -5, "Conteo físico", businessSlug);
    expect(r.ok).toBe(true);

    const overview = await getStockOverview(businessId);
    const item = overview.find((i) => i.productId === productId);
    expect(item!.currentQty).toBe(-3);
    expect(item!.isLow).toBe(true);

    const { data: prod } = await supabase
      .from("products")
      .select("is_available")
      .eq("id", productId)
      .single();
    expect(prod!.is_available).toBe(true);

    // Restore
    await setStockLevels(productId, 10, 3, businessSlug);
  });

  it("mozo NO puede ajustar stock", async () => {
    CURRENT_USER_ID = mozoId;

    const r = await ajustarStock(productId, -1, "Merma", businessSlug);
    expect(r.ok).toBe(false);
  });

  it("getLowStockCount cuenta items bajo mínimo", async () => {
    CURRENT_USER_ID = adminId;
    await setStockLevels(productId, 2, 5, businessSlug);

    const count = await getLowStockCount(businessId);
    expect(count).toBeGreaterThanOrEqual(1);

    // Restore
    await setStockLevels(productId, 10, 5, businessSlug);
  });

  // ── Stock de bar (spec 10) ──────────────────────────────────────

  const seedBarProduct = async (label: string) => {
    const { data: prod } = await supabase
      .from("products")
      .insert({
        business_id: businessId,
        category_id: categoryId,
        name: `${label} ${TEST_TAG}`,
        slug: `${label}-${TEST_TAG}`.toLowerCase(),
        price_cents: 80000,
        is_active: true,
        is_available: true,
        sort_order: 0,
      })
      .select("id")
      .single();
    return prod!.id as string;
  };

  it("marcar un producto como stock de bar lo separa de bebidas", async () => {
    CURRENT_USER_ID = encargadoId;
    const alfajorId = await seedBarProduct("Alfajor");

    const r = await setBarStock(alfajorId, true, businessSlug);
    expect(r.ok).toBe(true);

    const { data: prod } = await supabase
      .from("products")
      .select("is_bar_stock, track_stock")
      .eq("id", alfajorId)
      .single();
    expect(prod!.is_bar_stock).toBe(true);
    expect(prod!.track_stock).toBe(true);

    const bar = await getBarStockOverview(businessId);
    expect(bar.find((i) => i.productId === alfajorId)).toBeDefined();

    // No aparece en el stock de bebidas
    const bebidas = await getStockOverview(businessId);
    expect(bebidas.find((i) => i.productId === alfajorId)).toBeUndefined();
  });

  it("quitar del bar es baja lógica: conserva movimientos", async () => {
    CURRENT_USER_ID = encargadoId;
    const turronId = await seedBarProduct("Turron");

    await setBarStock(turronId, true, businessSlug);
    const ing = await ingresarStock(turronId, 24, businessSlug, "Compra inicial");
    expect(ing.ok).toBe(true);

    const { data: si } = await supabase
      .from("stock_items")
      .select("id")
      .eq("product_id", turronId)
      .single();

    const r = await setBarStock(turronId, false, businessSlug);
    expect(r.ok).toBe(true);

    const { data: prod } = await supabase
      .from("products")
      .select("is_bar_stock, track_stock")
      .eq("id", turronId)
      .single();
    expect(prod!.is_bar_stock).toBe(false);
    expect(prod!.track_stock).toBe(false);

    // Deja de listarse en el bar…
    const bar = await getBarStockOverview(businessId);
    expect(bar.find((i) => i.productId === turronId)).toBeUndefined();

    // …pero el histórico de movimientos se conserva
    const movs = await getStockMovimientos(si!.id);
    expect(movs.items.find((m) => m.kind === "ingreso" && m.qty === 24)).toBeDefined();
  }, 20_000);

  it("mozo NO puede marcar stock de bar", async () => {
    CURRENT_USER_ID = mozoId;
    const helado = await seedBarProduct("Helado");

    const r = await setBarStock(helado, true, businessSlug);
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.error).toContain("admin o encargado");
  });
});
