// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";

config({ path: ".env.local" });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const dbAvailable = Boolean(supabaseUrl && serviceKey);

// La migración 0056 puede no estar aplicada todavía en la DB de tests. Sondeamos
// la tabla y, si no existe, skipeamos todo el suite (en vez de fallar). Cuando
// se aplique la migración, los tests corren sin tocar nada más.
async function probeSchema(): Promise<boolean> {
  if (!dbAvailable) return false;
  const c = createClient(supabaseUrl!, serviceKey!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { error } = await c
    .from("notification_preferences")
    .select("id")
    .limit(1);
  return !error;
}
const schemaReady = await probeSchema();

const TEST_TAG = `test-notifprefs-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
let CURRENT_AUTH_USER_ID = "";

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({
    auth: {
      // Identidad de las actions del salón: `getClaims` (spec 106).
      // `getUser` queda para el código que todavía lo llama.
      getClaims: async () => ({
        data: { claims: { sub: CURRENT_AUTH_USER_ID } },
        error: null,
      }),
      getUser: async () => ({
        data: { user: { id: CURRENT_AUTH_USER_ID } },
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

const { listNotificationPreferences, setNotificationPreference } = await import(
  "./actions"
);

describe.skipIf(!schemaReady)("notification preferences (integration)", () => {
  const supabase = createClient(supabaseUrl!, serviceKey!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  let businessId = "";
  let businessSlug = "";
  let otherBusinessId = "";
  let otherBusinessSlug = "";
  let adminId = "";
  let encargadoId = "";
  let mozoId = "";

  async function createUser(suffix: string): Promise<string> {
    const email = `${TEST_TAG}-${suffix}@example.test`;
    const { data, error } = await supabase.auth.admin.createUser({
      email,
      password: "test-pass-12345",
      email_confirm: true,
    });
    if (error || !data?.user) {
      throw new Error(`Could not create ${suffix} user: ${error?.message}`);
    }
    await supabase
      .from("users")
      .upsert({ id: data.user.id, email, full_name: `${suffix} Test` });
    return data.user.id;
  }

  beforeAll(async () => {
    adminId = await createUser("admin");
    encargadoId = await createUser("enc");
    mozoId = await createUser("mozo");

    const { data: biz } = await supabase
      .from("businesses")
      .insert({ slug: TEST_TAG, name: "NotifPrefs Test", is_active: true })
      .select("id, slug")
      .single();
    businessId = biz!.id;
    businessSlug = biz!.slug;

    const { data: other } = await supabase
      .from("businesses")
      .insert({ slug: `${TEST_TAG}-other`, name: "Otro", is_active: true })
      .select("id, slug")
      .single();
    otherBusinessId = other!.id;
    otherBusinessSlug = other!.slug;

    await supabase.from("business_users").insert([
      { business_id: businessId, user_id: adminId, role: "admin" },
      { business_id: businessId, user_id: encargadoId, role: "encargado" },
      { business_id: businessId, user_id: mozoId, role: "mozo" },
      { business_id: otherBusinessId, user_id: encargadoId, role: "encargado" },
    ]);
  });

  afterAll(async () => {
    // Borrar businesses cascadea notification_preferences.
    await supabase
      .from("businesses")
      .delete()
      .in("id", [businessId, otherBusinessId]);
    for (const id of [adminId, encargadoId, mozoId]) {
      await supabase.auth.admin.deleteUser(id).catch(() => {});
    }
  });

  it("el mozo no puede configurar preferencias", async () => {
    CURRENT_AUTH_USER_ID = mozoId;
    const res = await setNotificationPreference({
      businessSlug,
      eventType: "order.pending",
      targetRole: "encargado",
      channel: "whatsapp",
      enabled: true,
    });
    expect(res.ok).toBe(false);

    // No quedó nada escrito.
    const { data } = await supabase
      .from("notification_preferences")
      .select("id")
      .eq("business_id", businessId);
    expect(data ?? []).toHaveLength(0);
  });

  it("el encargado crea y luego togglea sin duplicar (idempotente)", async () => {
    CURRENT_AUTH_USER_ID = encargadoId;

    const created = await setNotificationPreference({
      businessSlug,
      eventType: "order.pending",
      targetRole: "encargado",
      channel: "whatsapp",
      enabled: true,
    });
    expect(created.ok).toBe(true);

    const toggled = await setNotificationPreference({
      businessSlug,
      eventType: "order.pending",
      targetRole: "encargado",
      channel: "whatsapp",
      enabled: false,
    });
    expect(toggled.ok).toBe(true);

    const { data } = await supabase
      .from("notification_preferences")
      .select("id, enabled")
      .eq("business_id", businessId)
      .eq("event_type", "order.pending")
      .eq("target_role", "encargado")
      .eq("channel", "whatsapp");
    expect(data ?? []).toHaveLength(1);
    expect(data![0].enabled).toBe(false);
  });

  it("un negocio no ve las preferencias de otro", async () => {
    CURRENT_AUTH_USER_ID = encargadoId;
    // Hay prefs en `businessId` (creadas arriba); las listamos desde el otro.
    const res = await listNotificationPreferences(otherBusinessSlug);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data).toHaveLength(0);
  });

  it("la unicidad SQL rechaza duplicados (business, evento, rol, canal)", async () => {
    await supabase.from("notification_preferences").insert({
      business_id: businessId,
      event_type: "mesa.cancelled",
      target_role: "encargado",
      channel: "in_app",
      enabled: true,
    });
    const { error } = await supabase.from("notification_preferences").insert({
      business_id: businessId,
      event_type: "mesa.cancelled",
      target_role: "encargado",
      channel: "in_app",
      enabled: false,
    });
    expect(error).not.toBeNull();
  });
});
