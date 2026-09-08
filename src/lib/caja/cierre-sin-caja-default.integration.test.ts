// @vitest-environment node
//
// P03 · E-01 — desactivar la caja principal apaga las guardas del cierre.
//
// Las dos guardas que impiden cerrar el día con plata suelta —cuentas abiertas
// (D7) y rendiciones sin resolver (spec 139 · D1/D5)— están gateadas por
// `caja.is_default`, en las dos capas: la server action (`actions.ts:369, :387`)
// y la RPC, que recibe `p_barrer_salon: caja.is_default` (`actions.ts:472`).
//
// `setCajaActive(caja, false)` **no limpiaba `is_default`**, mientras que
// `setCajaDefault` sí se niega a marcar una caja inactiva ("Una caja inactiva
// no puede ser la caja por defecto"). Esa asimetría dejaba alcanzable, con un
// solo click, el estado «ninguna caja ACTIVA es la principal»: a partir de ahí
// el cierre de la caja que sí se está usando no chequeaba nada —ni cuentas
// abiertas, ni rendiciones— y tampoco barría el salón.
//
// Corregido (issue #254): desactivar la principal se rechaza y hay que marcar
// otra antes. Estos tests fijan las dos mitades — que el estado ya no se
// alcanza, y que la guarda que protegía sigue viva.
//
// Caso de uso: wiki/qa/procesos/P03-cerrar-la-caja.md
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";

config({ path: ".env.local" });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const dbAvailable = Boolean(supabaseUrl && serviceKey);

const TEST_TAG = `test-cierre-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
let CURRENT_USER_ID = "";

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({
    auth: {
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

const { cerrarCaja, setCajaActive } = await import("./actions");

describe.skipIf(!dbAvailable)("caja · cierre sin caja default (integration)", () => {
  const supabase = createClient(supabaseUrl!, serviceKey!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  let businessId: string;
  let businessSlug: string;
  let adminId: string;
  let encargadoId: string;
  let mozoId: string;
  let cajaPrincipalId: string;
  let cajaBarId: string;
  let floorPlanId: string;

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

  /** Una mesa ocupada con consumo sin cobrar. */
  const mesaConCuentaAbierta = async (label: string, total = 18_500) => {
    const { data: t } = await supabase
      .from("tables")
      .insert({
        floor_plan_id: floorPlanId,
        label,
        seats: 4,
        shape: "circle",
        x: 0, y: 0, width: 80, height: 80,
        operational_status: "ocupada",
        opened_at: new Date().toISOString(),
      })
      .select("id")
      .single();
    const { data: order } = await supabase
      .from("orders")
      .insert({
        business_id: businessId,
        customer_name: `Mesa ${label}`,
        customer_phone: "0",
        delivery_type: "dine_in",
        table_id: t!.id,
        subtotal_cents: total,
        total_cents: total,
        lifecycle_status: "open",
      })
      .select("id")
      .single();
    await supabase.from("order_items").insert({
      order_id: order!.id,
      product_name: "Item",
      unit_price_cents: total,
      quantity: 1,
      subtotal_cents: total,
      loaded_by: mozoId,
    });
    return { tableId: t!.id, orderId: order!.id };
  };

  beforeAll(async () => {
    adminId = await seedUser("Admin");
    encargadoId = await seedUser("Encargado");
    mozoId = await seedUser("Mozo");

    const { data: biz } = await supabase
      .from("businesses")
      .insert({ slug: TEST_TAG, name: "Cierre Test", is_active: true })
      .select("id, slug")
      .single();
    businessId = biz!.id;
    businessSlug = biz!.slug;

    await supabase.from("business_users").insert([
      { business_id: businessId, user_id: adminId, role: "admin", full_name: "Admin" },
      { business_id: businessId, user_id: encargadoId, role: "encargado", full_name: "Encargado" },
      { business_id: businessId, user_id: mozoId, role: "mozo", full_name: "Mozo" },
    ]);

    const { data: fp } = await supabase
      .from("floor_plans")
      .insert({ business_id: businessId, name: "Salón" })
      .select("id")
      .single();
    floorPlanId = fp!.id;

    const { data: principal } = await supabase
      .from("cajas")
      .insert({ business_id: businessId, name: "Caja Principal", is_default: true })
      .select("id")
      .single();
    cajaPrincipalId = principal!.id;

    const { data: bar } = await supabase
      .from("cajas")
      .insert({ business_id: businessId, name: "Caja Bar" })
      .select("id")
      .single();
    cajaBarId = bar!.id;
  });

  afterAll(async () => {
    if (businessId) await supabase.from("businesses").delete().eq("id", businessId);
    for (const id of [adminId, encargadoId, mozoId].filter(Boolean)) {
      await supabase.from("users").delete().eq("id", id);
      await supabase.auth.admin.deleteUser(id);
    }
  });

  it(
    "desactivar la caja principal se rechaza: primero hay que marcar otra",
    { timeout: 30_000 },
    async () => {
      CURRENT_USER_ID = adminId;
      const r = await setCajaActive(cajaPrincipalId, false, businessSlug);
      expect(r.ok).toBe(false);

      // Lo que importa no es el error, es el invariante: siempre hay una caja
      // ACTIVA marcada como principal. De eso cuelgan las dos guardas del cierre.
      const { data: activas } = await supabase
        .from("cajas")
        .select("id, is_default")
        .eq("business_id", businessId)
        .eq("is_active", true);
      expect(activas!.some((c) => c.is_default)).toBe(true);
    },
  );

  it(
    "la caja del bar sí se desactiva: la guarda es sólo para la principal",
    { timeout: 30_000 },
    async () => {
      CURRENT_USER_ID = adminId;
      const r = await setCajaActive(cajaBarId, false, businessSlug);
      expect(r.ok).toBe(true);
      // Se vuelve a dejar como estaba: los tests no se ordenan entre sí.
      await setCajaActive(cajaBarId, true, businessSlug);
    },
  );

  it(
    "con una mesa abierta, la caja principal no cierra",
    { timeout: 30_000 },
    async () => {
      // Se arma la precondición acá dentro: el test no puede depender de que
      // el anterior haya corrido, ni de en qué orden corran.
      await mesaConCuentaAbierta("7", 6_200);

      CURRENT_USER_ID = encargadoId;

      const r = await cerrarCaja({
        cajaId: cajaPrincipalId,
        closing_cash_cents: 0,
        closing_notes: null,
        denomination_count: null,
        retirar: true,
        businessSlug,
      });

      // El día no se cierra con plata sin cobrar en el salón.
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toMatch(/cuenta abierta/i);
    },
  );
});
