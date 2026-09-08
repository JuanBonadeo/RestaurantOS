// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";

config({ path: ".env.local" });

// ── Qué cubre este archivo ─────────────────────────────────────────────
// El formulario de alta escribía sobre `business_users` con un upsert crudo
// `onConflict: business_id,user_id`. Para alguien que YA estaba en el equipo eso
// no era un alta: era un cambio de rol (y de nombre, teléfono y PIN) por la
// puerta de atrás, sin ninguna de las guardas que `updateMemberRole` sí aplica.
// El caso feo es el negocio de un solo admin: el dueño se da de alta a sí mismo
// como mozo, el negocio queda sin ningún admin y no se sale desde la UI.

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const dbAvailable = Boolean(supabaseUrl && serviceKey);

const TEST_TAG = `test-guardas-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const ADMIN_EMAIL = `${TEST_TAG}-admin@example.test`;
const OTRO_ADMIN_EMAIL = `${TEST_TAG}-otro@example.test`;
const MOZO_EMAIL = `${TEST_TAG}-mozo@example.test`;
const REEMPLAZO_EMAIL = `${TEST_TAG}-reemplazo@example.test`;

let ACTING_USER_ID = "";

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({
    auth: {
      getClaims: async () => ({
        data: { claims: { sub: ACTING_USER_ID } },
        error: null,
      }),
      getUser: async () => ({
        data: { user: { id: ACTING_USER_ID } },
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
  createBusinessMemberWithPassword,
  disableBusinessMember,
  enableBusinessMember,
  inviteBusinessMemberByAdmin,
} = await import("./members-actions");

describe.skipIf(!dbAvailable)("altas — guardas de rol y de PIN (integration)", () => {
  const supabase = createClient(supabaseUrl!, serviceKey!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  let businessId: string;
  let businessSlug: string;
  const creados: string[] = [];

  async function crearUsuario(email: string): Promise<string> {
    const { data, error } = await supabase.auth.admin.createUser({
      email,
      password: "test-pass-12345",
      email_confirm: true,
    });
    if (error || !data.user) throw new Error(`createUser: ${error?.message}`);
    await supabase.from("users").upsert({ id: data.user.id, email });
    creados.push(data.user.id);
    return data.user.id;
  }

  async function rolDe(userId: string) {
    const { data } = await supabase
      .from("business_users")
      .select("role, pin, phone, full_name, disabled_at")
      .eq("business_id", businessId)
      .eq("user_id", userId)
      .maybeSingle();
    return data;
  }

  beforeAll(async () => {
    ACTING_USER_ID = await crearUsuario(ADMIN_EMAIL);

    const { data: biz, error } = await supabase
      .from("businesses")
      .insert({ slug: TEST_TAG, name: "Guardas Test", is_active: true })
      .select("id, slug")
      .single();
    if (error || !biz) throw new Error(`business: ${error?.message}`);
    businessId = biz.id;
    businessSlug = biz.slug;

    await supabase.from("business_users").insert({
      business_id: businessId,
      user_id: ACTING_USER_ID,
      role: "admin",
      full_name: "Admin Test",
      phone: "+54 11 5555 5555",
    });
  });

  afterAll(async () => {
    if (businessId) {
      await supabase.from("businesses").delete().eq("id", businessId);
    }
    for (const id of creados) {
      await supabase.auth.admin.deleteUser(id).catch(() => undefined);
    }
  });

  it("el alta con el email de alguien que ya está no le cambia el rol a sí mismo", async () => {
    const r = await inviteBusinessMemberByAdmin({
      business_slug: businessSlug,
      email: ADMIN_EMAIL,
      role: "mozo",
      full_name: "Admin Test",
    });

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/vos mismo/i);
    // El efecto que importa: sigue siendo admin y el negocio sigue teniendo uno.
    expect((await rolDe(ACTING_USER_ID))!.role).toBe("admin");
  });

  it("el alta por contraseña tampoco: es la misma escritura por otra puerta", async () => {
    const r = await createBusinessMemberWithPassword({
      business_slug: businessSlug,
      email: ADMIN_EMAIL,
      password: "otra-pass-12345",
      role: "mozo",
      full_name: "Admin Test",
    });

    expect(r.ok).toBe(false);
    expect((await rolDe(ACTING_USER_ID))!.role).toBe("admin");
  });

  it("el alta no puede dejar al negocio sin ningún admin activo", async () => {
    // Un platform admin sí puede tocar el rol de otro (incluso el propio), así
    // que la guarda que queda en pie es la del último admin del negocio.
    const platformId = await crearUsuario(`${TEST_TAG}-plat@example.test`);
    await supabase
      .from("users")
      .update({ is_platform_admin: true })
      .eq("id", platformId);

    const anterior = ACTING_USER_ID;
    ACTING_USER_ID = platformId;

    const r = await inviteBusinessMemberByAdmin({
      business_slug: businessSlug,
      email: ADMIN_EMAIL,
      role: "encargado",
      full_name: "Admin Test",
    });

    ACTING_USER_ID = anterior;

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/al menos un Admin/i);
    expect((await rolDe(anterior))!.role).toBe("admin");
  });

  it("re-invitar a alguien sin tocar su PIN no se lo borra", async () => {
    const alta = await createBusinessMemberWithPassword({
      business_slug: businessSlug,
      email: MOZO_EMAIL,
      password: "mozo-pass-12345",
      role: "mozo",
      full_name: "Juan Mozo",
      pin: "4321",
    });
    expect(alta.ok).toBe(true);

    const { data: fila } = await supabase
      .from("business_users")
      .select("user_id")
      .eq("business_id", businessId)
      .eq("pin", "4321")
      .single();
    const mozoId = fila!.user_id;

    // Mismo miembro, mismo rol, sin PIN en el formulario (el tab de link ni
    // siquiera dibuja el campo). Antes esto lo dejaba sin PIN: alguien que
    // fichaba dejaba de poder fichar, y nada lo decía.
    const reinvite = await createBusinessMemberWithPassword({
      business_slug: businessSlug,
      email: MOZO_EMAIL,
      password: "mozo-pass-67890",
      role: "mozo",
      full_name: "Juan Mozo",
    });
    expect(reinvite.ok).toBe(true);

    expect((await rolDe(mozoId))!.pin).toBe("4321");
  });

  it("Personal por link sin PIN se rechaza, como en el alta por contraseña", async () => {
    const r = await inviteBusinessMemberByAdmin({
      business_slug: businessSlug,
      email: `${TEST_TAG}-cocina@example.test`,
      role: "personal",
      full_name: "Cocinero Sin Pin",
    });

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/PIN/i);

    const { count } = await supabase
      .from("business_users")
      .select("user_id", { count: "exact", head: true })
      .eq("business_id", businessId)
      .eq("role", "personal");
    expect(count ?? 0).toBe(0);
  });

  it("no se le puede dar a un nuevo empleado el PIN de uno dado de baja", async () => {
    const { data: fila } = await supabase
      .from("business_users")
      .select("user_id")
      .eq("business_id", businessId)
      .eq("pin", "4321")
      .single();
    const mozoId = fila!.user_id;

    const baja = await disableBusinessMember(businessSlug, mozoId);
    expect(baja.ok).toBe(true);

    // Antes esto daba verde —el chequeo de duplicados sólo miraba activos— y la
    // trampa recién saltaba días después, al intentar reactivar al primero.
    const r = await createBusinessMemberWithPassword({
      business_slug: businessSlug,
      email: REEMPLAZO_EMAIL,
      password: "reemplazo-12345",
      role: "mozo",
      full_name: "Reemplazo",
      pin: "4321",
    });

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/dad[oa] de baja/i);

    // Y el que estaba de baja se puede reactivar, que era lo que se rompía.
    const alta = await enableBusinessMember(businessSlug, mozoId);
    expect(alta.ok).toBe(true);
    expect((await rolDe(mozoId))!.disabled_at).toBeNull();
  });

  it("si el PIN ya se lo llevó otro, la reactivación lo dice con nombre y apellido", async () => {
    const { data: fila } = await supabase
      .from("business_users")
      .select("user_id")
      .eq("business_id", businessId)
      .eq("pin", "4321")
      .single();
    const mozoId = fila!.user_id;

    await disableBusinessMember(businessSlug, mozoId);

    // El choque se arma a mano: con la guarda del alta puesta, ya no hay forma
    // de llegar acá desde la UI — pero las filas viejas de la base sí están así.
    const otroId = await crearUsuario(OTRO_ADMIN_EMAIL);
    await supabase.from("business_users").insert({
      business_id: businessId,
      user_id: otroId,
      role: "mozo",
      full_name: "La Que Se Quedó Con El PIN",
      pin: "4321",
    });

    const r = await enableBusinessMember(businessSlug, mozoId);

    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toMatch(/4321/);
      expect(r.error).toMatch(/La Que Se Quedó Con El PIN/);
    }
    // Y sigue de baja: el update no se aplicó a medias.
    expect((await rolDe(mozoId))!.disabled_at).not.toBeNull();
  });
});
