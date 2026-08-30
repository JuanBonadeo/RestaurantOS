// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";

config({ path: ".env.local" });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const dbAvailable = Boolean(supabaseUrl && serviceKey);

const TEST_TAG = `test-cuenta-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

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

const {
  aplicarPropinaYDescuento,
  dividirPorPersonas,
  dividirPorItems,
  cancelarItemEnCuenta,
} = await import("./cuenta-actions");
const { getCuentaForTable } = await import("./cuenta-query");

describe.skipIf(!dbAvailable)("billing/cuenta (integration)", () => {
  const supabase = createClient(supabaseUrl!, serviceKey!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  let businessId: string;
  let businessSlug: string;
  let mozoId: string;
  let encargadoId: string;
  let tableId: string;
  let orderId: string;
  let item1Id: string;
  let item2Id: string;
  let item3Id: string;

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
    mozoId = await seedUser("Mozo");
    encargadoId = await seedUser("Encargado");

    const { data: biz } = await supabase
      .from("businesses")
      .insert({ slug: TEST_TAG, name: "Cuenta Test", is_active: true })
      .select("id, slug")
      .single();
    businessId = biz!.id;
    businessSlug = biz!.slug;

    await supabase.from("business_users").insert([
      { business_id: businessId, user_id: mozoId, role: "mozo", full_name: "Mozo" },
      { business_id: businessId, user_id: encargadoId, role: "encargado", full_name: "Encargado" },
    ]);

    const { data: fp } = await supabase
      .from("floor_plans")
      .insert({ business_id: businessId, name: "S" })
      .select("id")
      .single();
    const { data: t } = await supabase
      .from("tables")
      .insert({
        floor_plan_id: fp!.id,
        label: "1",
        seats: 4,
        shape: "circle",
        x: 0, y: 0, width: 80, height: 80,
        operational_status: "ocupada",
        opened_at: new Date().toISOString(),
      })
      .select("id")
      .single();
    tableId = t!.id;

    const { data: order } = await supabase
      .from("orders")
      .insert({
        business_id: businessId,
        customer_name: "Mesa 1",
        customer_phone: "0",
        delivery_type: "dine_in",
        table_id: tableId,
        subtotal_cents: 10_000,
        total_cents: 10_000,
        lifecycle_status: "open",
      })
      .select("id")
      .single();
    orderId = order!.id;

    // 3 items: $5000, $3000, $2000.
    const { data: i1 } = await supabase
      .from("order_items")
      .insert({
        order_id: orderId,
        product_name: "Muzza",
        unit_price_cents: 5_000,
        quantity: 1,
        subtotal_cents: 5_000,
        loaded_by: mozoId,
      })
      .select("id")
      .single();
    item1Id = i1!.id;
    const { data: i2 } = await supabase
      .from("order_items")
      .insert({
        order_id: orderId,
        product_name: "Empanadas",
        unit_price_cents: 1_500,
        quantity: 2,
        subtotal_cents: 3_000,
        loaded_by: mozoId,
      })
      .select("id")
      .single();
    item2Id = i2!.id;
    const { data: i3 } = await supabase
      .from("order_items")
      .insert({
        order_id: orderId,
        product_name: "Agua",
        unit_price_cents: 2_000,
        quantity: 1,
        subtotal_cents: 2_000,
        loaded_by: mozoId,
      })
      .select("id")
      .single();
    item3Id = i3!.id;
  });

  afterAll(async () => {
    if (businessId) {
      await supabase.from("businesses").delete().eq("id", businessId);
    }
    for (const id of [mozoId, encargadoId].filter(Boolean)) {
      await supabase.from("users").delete().eq("id", id);
      await supabase.auth.admin.deleteUser(id);
    }
  });

  it("getCuentaForTable: trae items + totales + last_mozo_id", async () => {
    const c = await getCuentaForTable(tableId, businessId);
    expect(c).not.toBeNull();
    expect(c!.items).toHaveLength(3);
    expect(c!.totals.subtotal_cents).toBe(10_000);
    expect(c!.last_mozo_id).toBe(mozoId);
  });

  it("mozo aplica 10% propina + 0 descuento → ok", async () => {
    CURRENT_USER_ID = mozoId;
    const r = await aplicarPropinaYDescuento(
      orderId,
      { tip_cents: 1_000, discount_cents: 0, discount_reason: null },
      businessSlug,
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.total_cents).toBe(11_000);
  });

  it("mozo intenta 15% descuento → falla por permiso", async () => {
    CURRENT_USER_ID = mozoId;
    const r = await aplicarPropinaYDescuento(
      orderId,
      { tip_cents: 0, discount_cents: 1_500, discount_reason: "cumpleaños" },
      businessSlug,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/rol|encargado/i);
  });

  it("mozo aplica 10% descuento con motivo → ok", async () => {
    CURRENT_USER_ID = mozoId;
    const r = await aplicarPropinaYDescuento(
      orderId,
      { tip_cents: 0, discount_cents: 1_000, discount_reason: "fidelidad" },
      businessSlug,
    );
    expect(r.ok).toBe(true);
  });

  it("encargado aplica 20% descuento → ok", async () => {
    CURRENT_USER_ID = encargadoId;
    const r = await aplicarPropinaYDescuento(
      orderId,
      { tip_cents: 0, discount_cents: 2_000, discount_reason: "cortesía" },
      businessSlug,
    );
    expect(r.ok).toBe(true);
  });

  it("descuento sin motivo → falla", async () => {
    CURRENT_USER_ID = encargadoId;
    const r = await aplicarPropinaYDescuento(
      orderId,
      { tip_cents: 0, discount_cents: 500, discount_reason: "" },
      businessSlug,
    );
    expect(r.ok).toBe(false);
  });

  it("dividir por 3 personas: suma de expected = total", async () => {
    CURRENT_USER_ID = mozoId;
    // Reset propina/descuento.
    await aplicarPropinaYDescuento(
      orderId,
      { tip_cents: 0, discount_cents: 0, discount_reason: null },
      businessSlug,
    );
    const r = await dividirPorPersonas(orderId, 3, businessSlug);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.splits).toHaveLength(3);
    const sum = r.data.splits.reduce((a, s) => a + s.expected_amount_cents, 0);
    expect(sum).toBe(10_000);
  });

  it("dividir por items: cada item a un split, sumas correctas", async () => {
    CURRENT_USER_ID = mozoId;
    const r = await dividirPorItems(
      orderId,
      {
        1: [item1Id], // 5000
        2: [item2Id, item3Id], // 3000 + 2000
      },
      businessSlug,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.splits).toHaveLength(2);
    const byIdx = new Map(r.data.splits.map((s) => [s.split_index, s]));
    expect(byIdx.get(1)!.expected_amount_cents).toBe(5_000);
    expect(byIdx.get(2)!.expected_amount_cents).toBe(5_000);
  });

  it("dividir por items con item sin asignar → falla", async () => {
    CURRENT_USER_ID = mozoId;
    const r = await dividirPorItems(
      orderId,
      {
        1: [item1Id],
        2: [item2Id],
        // item3Id queda sin asignar
      },
      businessSlug,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/sin asignar/i);
  });

  it("aplicar propina/descuento invalida splits previos", async () => {
    CURRENT_USER_ID = mozoId;
    // Primero dividimos.
    await dividirPorPersonas(orderId, 2, businessSlug);
    let { data: splitsBefore } = await supabase
      .from("order_splits")
      .select("id")
      .eq("order_id", orderId);
    expect(splitsBefore!.length).toBe(2);

    // Cambiamos propina → splits eliminados.
    await aplicarPropinaYDescuento(
      orderId,
      { tip_cents: 500, discount_cents: 0, discount_reason: null },
      businessSlug,
    );
    const { data: splitsAfter } = await supabase
      .from("order_splits")
      .select("id")
      .eq("order_id", orderId);
    expect(splitsAfter!.length).toBe(0);
  });

  it("encargado cancela item → totales recalculados, splits invalidados", async () => {
    CURRENT_USER_ID = encargadoId;
    // Reset y div.
    await aplicarPropinaYDescuento(
      orderId,
      { tip_cents: 0, discount_cents: 0, discount_reason: null },
      businessSlug,
    );
    await dividirPorPersonas(orderId, 2, businessSlug);

    const r = await cancelarItemEnCuenta(item3Id, "se quemó", businessSlug);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.total_cents).toBe(8_000); // 5000+3000

    const { data: splitsAfter } = await supabase
      .from("order_splits")
      .select("id")
      .eq("order_id", orderId);
    expect(splitsAfter!.length).toBe(0);
  });
});
