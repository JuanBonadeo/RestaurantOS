// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";

config({ path: ".env.local" });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const dbAvailable = Boolean(supabaseUrl && serviceKey);

const TEST_TAG = `test-import-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

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

const { importIngredients } = await import("./actions");

describe.skipIf(!dbAvailable)("import masivo de insumos (integration)", () => {
  const supabase = createClient(supabaseUrl!, serviceKey!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  let businessId: string;
  let businessSlug: string;
  let adminId: string;
  let mozoId: string;

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
    mozoId = await seedUser("Mozo");

    const { data: biz } = await supabase
      .from("businesses")
      .insert({ slug: TEST_TAG, name: "Import Test", is_active: true })
      .select("id, slug")
      .single();
    businessId = biz!.id;
    businessSlug = biz!.slug;

    await supabase.from("business_users").insert([
      { business_id: businessId, user_id: adminId, role: "admin", full_name: "Admin" },
      { business_id: businessId, user_id: mozoId, role: "mozo", full_name: "Mozo" },
    ]);
  }, 30_000);

  afterAll(async () => {
    const { data: ings } = await supabase
      .from("ingredients")
      .select("id")
      .eq("business_id", businessId);
    for (const ing of ings ?? []) {
      await supabase.from("ingredient_presentations").delete().eq("ingredient_id", ing.id);
    }
    await supabase.from("ingredients").delete().eq("business_id", businessId);
    await supabase.from("business_users").delete().eq("business_id", businessId);
    await supabase.from("businesses").delete().eq("id", businessId);
    for (const uid of [adminId, mozoId]) {
      await supabase.auth.admin.deleteUser(uid);
    }
  }, 30_000);

  it("importa filas válidas y reporta las inválidas sin abortar", async () => {
    CURRENT_USER_ID = adminId;

    const rows = [
      { name: `Harina 000 ${TEST_TAG}`, unit: "kg", net_quantity: 25, cost_cents: 1500000, waste_percent: 2, stock_initial: 50 },
      { name: `Aceite ${TEST_TAG}`, unit: "lt", net_quantity: 5, cost_cents: 800000 },
      // Fila inválida: unidad fuera del enum
      { name: `Cosa rara ${TEST_TAG}`, unit: "litros", net_quantity: 1, cost_cents: 100 },
    ];

    const r = await importIngredients(businessSlug, rows);
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    expect(r.data.imported).toBe(2);
    expect(r.data.errors).toHaveLength(1);
    expect(r.data.errors[0].row).toBe(3);

    // Las válidas quedaron creadas con su presentación default
    const { data: harina } = await supabase
      .from("ingredients")
      .select("id, unit, stock_quantity, ingredient_presentations(name, cost_cents, net_quantity, is_default)")
      .eq("business_id", businessId)
      .eq("name", `Harina 000 ${TEST_TAG}`)
      .single();
    expect(harina!.unit).toBe("kg");
    expect(Number(harina!.stock_quantity)).toBe(50);
    const pres = (harina!.ingredient_presentations as any[])[0];
    expect(pres.cost_cents).toBe(1500000);
    expect(pres.is_default).toBe(true);
  }, 20_000);

  it("reimportar no duplica (upsert por business_id, name)", async () => {
    CURRENT_USER_ID = adminId;

    const rows = [
      { name: `Harina 000 ${TEST_TAG}`, unit: "kg", net_quantity: 25, cost_cents: 1600000 },
    ];

    const r = await importIngredients(businessSlug, rows);
    expect(r.ok).toBe(true);

    const { data: matches } = await supabase
      .from("ingredients")
      .select("id, ingredient_presentations(cost_cents)")
      .eq("business_id", businessId)
      .eq("name", `Harina 000 ${TEST_TAG}`);
    expect(matches!.length).toBe(1);
    // Actualizó el costo de la presentación default (no creó otra)
    expect((matches![0].ingredient_presentations as any[]).length).toBe(1);
    expect((matches![0].ingredient_presentations as any[])[0].cost_cents).toBe(1600000);
  }, 20_000);

  it("mozo NO puede importar insumos", async () => {
    CURRENT_USER_ID = mozoId;

    const r = await importIngredients(businessSlug, [
      { name: `No deberia ${TEST_TAG}`, unit: "un", net_quantity: 1, cost_cents: 100 },
    ]);
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.error).toContain("admin o encargado");
  });
});
