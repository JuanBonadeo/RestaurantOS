// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";

config({ path: ".env.local" });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const dbAvailable = Boolean(supabaseUrl && serviceKey);

const TEST_TAG = `test-empleados-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const ADMIN_EMAIL = `${TEST_TAG}-admin@example.test`;
const MOZO_EMAIL = `${TEST_TAG}-mozo@example.test`;
let ADMIN_USER_ID = "";

// El gate cross-tenant en members-actions resuelve `auth.getUser()` desde el
// session client. Mockeamos para devolver el admin de seed.
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({
    auth: {
      getUser: async () => ({
        data: { user: { id: ADMIN_USER_ID } },
        error: null,
      }),
    },
  }),
}));

// `cache()` de React no está en node puro. Passthrough para que helpers que la
// usan (getBusiness, etc.) funcionen.
vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");
  return { ...actual, cache: <T>(fn: T) => fn };
});

// `revalidatePath` requiere static generation store de Next, no disponible en
// node puro. Lo neutralizamos.
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
}));

// `redirect()` de next/navigation tira un error específico — lo capturamos.
const redirectMock = vi.fn((url: string) => {
  throw new Error(`__REDIRECT__:${url}`);
});
vi.mock("next/navigation", async () => {
  const actual = await vi.importActual<typeof import("next/navigation")>(
    "next/navigation",
  );
  return { ...actual, redirect: redirectMock };
});

// Importadas DESPUÉS de los mocks.
const {
  createBusinessMemberWithPassword,
  disableBusinessMember,
  enableBusinessMember,
  updateMemberProfile,
  updateMemberRole,
} = await import("./members-actions");
const { listBusinessMembers } = await import("./members-query");
const { ensureAdminAccess } = await import("./context");

describe.skipIf(!dbAvailable)("empleados — Bloque 1 (integration)", () => {
  const supabase = createClient(supabaseUrl!, serviceKey!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  let businessId: string;
  let businessSlug: string;
  let mozoUserId: string;

  beforeAll(async () => {
    // 1. Admin de seed — el "operador" del test.
    const { data: adminCreated, error: adminErr } =
      await supabase.auth.admin.createUser({
        email: ADMIN_EMAIL,
        password: "test-pass-12345",
        email_confirm: true,
      });
    if (adminErr || !adminCreated?.user) {
      throw new Error(`could not create admin: ${adminErr?.message}`);
    }
    ADMIN_USER_ID = adminCreated.user.id;
    await supabase.from("users").upsert({
      id: ADMIN_USER_ID,
      email: ADMIN_EMAIL,
      full_name: "Admin Test",
    });

    // 2. Business
    const { data: biz, error: bizErr } = await supabase
      .from("businesses")
      .insert({ slug: TEST_TAG, name: "Empleados Test", is_active: true })
      .select("id, slug")
      .single();
    if (bizErr || !biz) throw new Error(`could not create biz: ${bizErr?.message}`);
    businessId = biz.id;
    businessSlug = biz.slug;

    // 3. Membership de admin
    await supabase.from("business_users").insert({
      business_id: businessId,
      user_id: ADMIN_USER_ID,
      role: "admin",
      full_name: "Admin Test",
    });
  });

  afterAll(async () => {
    // Cleanup: business cascadea `business_users`. Borramos auth users.
    if (businessId) {
      await supabase.from("businesses").delete().eq("id", businessId);
    }
    if (mozoUserId) {
      await supabase.auth.admin.deleteUser(mozoUserId).catch(() => undefined);
    }
    if (ADMIN_USER_ID) {
      await supabase.auth.admin.deleteUser(ADMIN_USER_ID).catch(() => undefined);
    }
  });

  it("alta de mozo persiste full_name + phone y queda activo", async () => {
    const r = await createBusinessMemberWithPassword({
      business_slug: businessSlug,
      email: MOZO_EMAIL,
      password: "mozo-pass-12345",
      role: "mozo",
      full_name: "Juan Mozo",
      phone: "+54 9 11 1234 5678",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    const { data: row } = await supabase
      .from("business_users")
      .select("user_id, role, full_name, phone, disabled_at")
      .eq("business_id", businessId)
      .eq("role", "mozo")
      .maybeSingle();
    expect(row).toBeTruthy();
    expect(row!.role).toBe("mozo");
    expect(row!.full_name).toBe("Juan Mozo");
    expect(row!.phone).toBe("+54 9 11 1234 5678");
    expect(row!.disabled_at).toBeNull();
    mozoUserId = row!.user_id;
  });

  it("listBusinessMembers excluye deshabilitados por default", async () => {
    const before = await listBusinessMembers(businessId);
    expect(before.find((m) => m.user_id === mozoUserId)).toBeTruthy();

    const dis = await disableBusinessMember(businessSlug, mozoUserId);
    expect(dis.ok).toBe(true);

    const after = await listBusinessMembers(businessId);
    expect(after.find((m) => m.user_id === mozoUserId)).toBeUndefined();

    const withDisabled = await listBusinessMembers(businessId, {
      includeDisabled: true,
    });
    const found = withDisabled.find((m) => m.user_id === mozoUserId);
    expect(found).toBeTruthy();
    expect(found!.disabled_at).not.toBeNull();
  });

  it("ensureAdminAccess de un user deshabilitado redirige a login con reason=disabled", async () => {
    // Cambiamos el "currentUser" mockeado al mozo deshabilitado para simular
    // su sesión.
    const previousAdminId = ADMIN_USER_ID;
    ADMIN_USER_ID = mozoUserId; // re-target el mock de auth.getUser
    redirectMock.mockClear();

    await expect(
      ensureAdminAccess(businessId, businessSlug),
    ).rejects.toThrow(/__REDIRECT__/);

    expect(redirectMock).toHaveBeenCalledWith(
      `/${businessSlug}/admin/login?reason=disabled`,
    );

    ADMIN_USER_ID = previousAdminId;
  });

  it("enableBusinessMember reactiva al mozo y vuelve a aparecer en list default", async () => {
    const en = await enableBusinessMember(businessSlug, mozoUserId);
    expect(en.ok).toBe(true);

    const list = await listBusinessMembers(businessId);
    const found = list.find((m) => m.user_id === mozoUserId);
    expect(found).toBeTruthy();
    expect(found!.disabled_at).toBeNull();
  });

  it("updateMemberProfile actualiza full_name y phone", async () => {
    const r = await updateMemberProfile({
      business_slug: businessSlug,
      user_id: mozoUserId,
      full_name: "Juan Mozo Editado",
      phone: "+54 9 11 0000 0000",
    });
    expect(r.ok).toBe(true);

    const list = await listBusinessMembers(businessId);
    const found = list.find((m) => m.user_id === mozoUserId);
    expect(found?.full_name).toBe("Juan Mozo Editado");
    expect(found?.phone).toBe("+54 9 11 0000 0000");
  });

  it("disableBusinessMember rechaza self-disable de un admin no platform", async () => {
    const r = await disableBusinessMember(businessSlug, ADMIN_USER_ID);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toMatch(/vos mismo/i);
    }
  });

  it("updateMemberRole promueve al mozo a encargado", async () => {
    const r = await updateMemberRole({
      business_slug: businessSlug,
      user_id: mozoUserId,
      role: "encargado",
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.needsCredentials).toBe(false);

    const list = await listBusinessMembers(businessId);
    expect(list.find((m) => m.user_id === mozoUserId)?.role).toBe("encargado");
  });

  it("updateMemberRole rechaza el rol Personal si el miembro no tiene PIN", async () => {
    const r = await updateMemberRole({
      business_slug: businessSlug,
      user_id: mozoUserId,
      role: "personal",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/PIN/i);
  });

  it("updateMemberRole rechaza cambiarse el rol a uno mismo", async () => {
    const r = await updateMemberRole({
      business_slug: businessSlug,
      user_id: ADMIN_USER_ID,
      role: "mozo",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/vos mismo/i);
  });

  it("updateMemberRole permite degradar a un admin mientras quede otro activo", async () => {
    const up = await updateMemberRole({
      business_slug: businessSlug,
      user_id: mozoUserId,
      role: "admin",
    });
    expect(up.ok).toBe(true);

    // Hay dos admins activos (el operador + el recién promovido): degradar
    // no deja al negocio huérfano.
    const down = await updateMemberRole({
      business_slug: businessSlug,
      user_id: mozoUserId,
      role: "mozo",
    });
    expect(down.ok).toBe(true);

    const list = await listBusinessMembers(businessId);
    expect(list.find((m) => m.user_id === mozoUserId)?.role).toBe("mozo");
  });
});
