// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";

import { customerPhoneKey } from "@/lib/phone";

config({ path: ".env.local" });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const dbAvailable = Boolean(supabaseUrl && serviceKey);

const TEST_TAG = `test-walkin-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const TEST_USER_EMAIL = `${TEST_TAG}@example.test`;
let TEST_USER_ID = "";

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({
    auth: {
      // Identidad de las actions del salón: `getClaims` (spec 106).
      // `getUser` queda para el código que todavía lo llama.
      getClaims: async () => ({
        data: { claims: { sub: TEST_USER_ID } },
        error: null,
      }),
      getUser: async () => ({
        data: { user: { id: TEST_USER_ID } },
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

const { sentarWalkIn } = await import("./walk-in");

describe.skipIf(!dbAvailable)("walk-in (integration)", () => {
  const supabase = createClient(supabaseUrl!, serviceKey!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  let businessId: string;
  let businessSlug: string;
  let otherBusinessId: string;
  let otherTableId: string;
  let tableA: string; // libre, sin mozo
  let tableB: string; // libre, mozo distinto al de sesión
  let tableC: string; // libre, sin mozo (para test sin phone)
  let tableD: string; // ya ocupada (negativo)
  let otherMozoId = "";

  beforeAll(async () => {
    const { data: created, error: authErr } = await supabase.auth.admin.createUser({
      email: TEST_USER_EMAIL,
      password: "test-pass-12345",
      email_confirm: true,
    });
    if (authErr || !created?.user) {
      throw new Error(`auth user: ${authErr?.message}`);
    }
    TEST_USER_ID = created.user.id;
    await supabase.from("users").upsert({
      id: TEST_USER_ID,
      email: TEST_USER_EMAIL,
      full_name: "Mozo Test",
    });

    // Otro mozo del mismo business (para tests de auto-asignación que NO debe ocurrir)
    const otherMozoEmail = `${TEST_TAG}-other-mozo@example.test`;
    const { data: otherMozo } = await supabase.auth.admin.createUser({
      email: otherMozoEmail,
      password: "test-pass-12345",
      email_confirm: true,
    });
    otherMozoId = otherMozo!.user!.id;
    await supabase.from("users").upsert({
      id: otherMozoId,
      email: otherMozoEmail,
      full_name: "Otro Mozo",
    });

    const { data: biz } = await supabase
      .from("businesses")
      .insert({ slug: TEST_TAG, name: "Walk-in Test", is_active: true })
      .select("id, slug")
      .single();
    businessId = biz!.id;
    businessSlug = biz!.slug;

    const otherTag = `${TEST_TAG}-other`;
    const { data: other } = await supabase
      .from("businesses")
      .insert({ slug: otherTag, name: "Otro WI", is_active: true })
      .select("id")
      .single();
    otherBusinessId = other!.id;

    await supabase.from("business_users").insert([
      { business_id: businessId, user_id: TEST_USER_ID, role: "mozo" },
      { business_id: businessId, user_id: otherMozoId, role: "mozo" },
    ]);

    const { data: fp } = await supabase
      .from("floor_plans")
      .insert({ business_id: businessId, name: "Salón" })
      .select("id")
      .single();

    const seedTable = async (
      label: string,
      operational: string,
      mozoId: string | null,
    ) => {
      const { data } = await supabase
        .from("tables")
        .insert({
          floor_plan_id: fp!.id,
          label,
          seats: 4,
          shape: "circle",
          x: 0,
          y: 0,
          width: 80,
          height: 80,
          operational_status: operational,
          mozo_id: mozoId,
        })
        .select("id")
        .single();
      return data!.id as string;
    };
    tableA = await seedTable("A", "libre", null);
    tableB = await seedTable("B", "libre", otherMozoId);
    tableC = await seedTable("C", "libre", null);
    tableD = await seedTable("D", "ocupada", null);

    const { data: otherFp } = await supabase
      .from("floor_plans")
      .insert({ business_id: otherBusinessId, name: "Salón B" })
      .select("id")
      .single();
    const { data: otherTable } = await supabase
      .from("tables")
      .insert({
        floor_plan_id: otherFp!.id,
        label: "Z",
        seats: 2,
        shape: "circle",
        x: 0,
        y: 0,
        width: 80,
        height: 80,
      })
      .select("id")
      .single();
    otherTableId = otherTable!.id;
  });

  afterAll(async () => {
    if (businessId) {
      await supabase
        .from("businesses")
        .delete()
        .in("id", [businessId, otherBusinessId].filter(Boolean));
    }
    if (TEST_USER_ID) {
      await supabase.from("users").delete().eq("id", TEST_USER_ID);
      await supabase.auth.admin.deleteUser(TEST_USER_ID);
    }
    if (otherMozoId) {
      await supabase.from("users").delete().eq("id", otherMozoId);
      await supabase.auth.admin.deleteUser(otherMozoId);
    }
  });

  it("phone nuevo → crea customer + abre mesa + auto-asigna mozo", async () => {
    const result = await sentarWalkIn({
      tableId: tableA,
      partySize: 3,
      name: "Pedro",
      phone: `+5491100${Math.floor(Math.random() * 1e6)}`,
      slug: businessSlug,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.customerId).toBeTruthy();
    expect(result.data.autoAssignedMozo).toBe(true);

    const { data: tableRow } = await supabase
      .from("tables")
      .select("operational_status, opened_at, mozo_id")
      .eq("id", tableA)
      .single();
    expect(tableRow!.operational_status).toBe("ocupada");
    expect(tableRow!.opened_at).not.toBeNull();
    expect(tableRow!.mozo_id).toBe(TEST_USER_ID);

    const { data: customer } = await supabase
      .from("customers")
      .select("id, name")
      .eq("id", result.data.customerId!)
      .single();
    expect(customer!.name).toBe("Pedro");

    const { data: audit } = await supabase
      .from("tables_audit_log")
      .select("kind, from_value, to_value")
      .eq("table_id", tableA)
      .order("created_at", { ascending: true });
    const kinds = (audit ?? []).map((a) => a.kind);
    expect(kinds).toContain("status");
    expect(kinds).toContain("assignment");
  });

  it("phone existente → reusa customer (no duplica)", async () => {
    const sharedPhone = `+5491133${Math.floor(Math.random() * 1e6)}`;
    // Pre-seed customer
    // El cliente se siembra con la clave **normalizada**, que es lo único que
    // la app escribe: los tres caminos de alta (checkout, walk-in y reserva)
    // pasan por `customerPhoneKey`, que es digits-only y se come el `+` (#114).
    // Sembrarlo crudo creaba un dato que producción nunca genera, el lookup no
    // matcheaba y el test se caía culpando al código en vez de a su fixture.
    const { data: existing } = await supabase
      .from("customers")
      .insert({
        business_id: businessId,
        phone: customerPhoneKey(sharedPhone),
        name: "Original",
      })
      .select("id")
      .single();

    const result = await sentarWalkIn({
      tableId: tableC,
      partySize: 2,
      name: "Original Updated",
      phone: sharedPhone,
      slug: businessSlug,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.customerId).toBe(existing!.id);

    const { data: customer } = await supabase
      .from("customers")
      .select("name")
      .eq("id", existing!.id)
      .single();
    // Nombre se actualiza si difiere
    expect(customer!.name).toBe("Original Updated");

    // No duplicación: count por phone debe seguir en 1
    const { count } = await supabase
      .from("customers")
      .select("id", { count: "exact", head: true })
      .eq("business_id", businessId)
      .eq("phone", customerPhoneKey(sharedPhone));
    expect(count).toBe(1);
  });

  it("respeta mozo_id si la mesa ya estaba asignada a otro", async () => {
    const result = await sentarWalkIn({
      tableId: tableB,
      partySize: 2,
      slug: businessSlug,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.autoAssignedMozo).toBe(false);

    const { data: tableRow } = await supabase
      .from("tables")
      .select("mozo_id, operational_status")
      .eq("id", tableB)
      .single();
    expect(tableRow!.operational_status).toBe("ocupada");
    expect(tableRow!.mozo_id).toBe(otherMozoId);
  });

  it("mesa no libre → error", async () => {
    const result = await sentarWalkIn({
      tableId: tableD,
      partySize: 2,
      slug: businessSlug,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/libre/i);
    }
  });

  it("cross-tenant: tableId de otro business → error", async () => {
    const result = await sentarWalkIn({
      tableId: otherTableId,
      partySize: 2,
      slug: businessSlug,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/no encontrada/i);
    }
  });

  it("sin phone → mesa abre, no se crea customer", async () => {
    // Usamos la mesa A nuevamente: la liberamos primero.
    await supabase
      .from("tables")
      .update({
        operational_status: "libre",
        opened_at: null,
        mozo_id: null,
      })
      .eq("id", tableA);

    const result = await sentarWalkIn({
      tableId: tableA,
      partySize: 1,
      slug: businessSlug,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.customerId).toBeNull();
  });
});
