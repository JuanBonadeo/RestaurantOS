// @vitest-environment node
//
// P06 · issue #259 — rechazar un pedido online devuelve plata: pide rol.
//
// `rechazarPedido` sólo chequeaba que hubiera sesión, y confiaba en el SELECT
// bajo RLS: «si este usuario no puede ver la orden de este negocio, no la puede
// rechazar». Eso prueba **tenancy**, no rol — cualquier miembro ve las órdenes
// de su negocio. O sea que un mozo, o alguien de cocina, podía rechazar un
// pedido pagado y **disparar la devolución por Mercado Pago**, sin tope y sin
// que nadie lo autorice.
//
// El rol pedido es `canConfirmOrder` y no una condición nueva: rechazar es la
// otra mitad de la misma decisión, en la misma pantalla.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";

config({ path: ".env.local" });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const dbAvailable = Boolean(supabaseUrl && serviceKey);

const TEST_TAG = `test-rechazo-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
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
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: ORDEN_ACTUAL, error: null }),
          }),
        }),
      }),
    }),
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

let ORDEN_ACTUAL: Record<string, unknown> | null = null;

const { rechazarPedido } = await import("./rechazar-pedido");

describe.skipIf(!dbAvailable)("orders · quién puede rechazar (integration)", () => {
  const supabase = createClient(supabaseUrl!, serviceKey!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  let businessId: string;
  let businessSlug: string;
  let mozoId: string;
  let encargadoId: string;
  let orderId: string;

  const seedUser = async (label: string) => {
    const email = `${TEST_TAG}-${label}@example.test`;
    const { data } = await supabase.auth.admin.createUser({
      email,
      password: "test-pass-12345",
      email_confirm: true,
    });
    const id = data!.user!.id;
    await supabase.from("users").upsert({ id, email, full_name: label });
    return id;
  };

  const nuevoPedido = async () => {
    const { data } = await supabase
      .from("orders")
      .insert({
        business_id: businessId,
        customer_name: "Cliente",
        customer_phone: "0",
        delivery_type: "delivery",
        subtotal_cents: 25_000,
        total_cents: 25_000,
        status: "pending",
        lifecycle_status: "open",
      })
      .select("id")
      .single();
    return data!.id as string;
  };

  beforeAll(async () => {
    mozoId = await seedUser("Mozo");
    encargadoId = await seedUser("Encargado");

    const { data: biz } = await supabase
      .from("businesses")
      .insert({ slug: TEST_TAG, name: "Rechazo Test", is_active: true })
      .select("id, slug")
      .single();
    businessId = biz!.id;
    businessSlug = biz!.slug;

    await supabase.from("business_users").insert([
      { business_id: businessId, user_id: mozoId, role: "mozo", full_name: "Mozo" },
      { business_id: businessId, user_id: encargadoId, role: "encargado", full_name: "Encargado" },
    ]);
  });

  afterAll(async () => {
    if (businessId) await supabase.from("businesses").delete().eq("id", businessId);
    for (const id of [mozoId, encargadoId].filter(Boolean)) {
      await supabase.from("users").delete().eq("id", id);
      await supabase.auth.admin.deleteUser(id);
    }
  });

  it("el mozo no puede rechazar un pedido online", async () => {
    orderId = await nuevoPedido();
    ORDEN_ACTUAL = {
      id: orderId,
      status: "pending",
      delivery_type: "delivery",
      payment_status: null,
      mp_payment_id: null,
    };
    CURRENT_USER_ID = mozoId;

    const r = await rechazarPedido({
      order_id: orderId,
      business_slug: businessSlug,
      motivo: "sin stock",
    });

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/permiso/i);

    // Y el pedido queda intacto: la guarda corta ANTES de tocar nada.
    const { data } = await supabase
      .from("orders")
      .select("status")
      .eq("id", orderId)
      .single();
    expect(data!.status).toBe("pending");
  });

  it("la encargada sí puede", async () => {
    orderId = await nuevoPedido();
    ORDEN_ACTUAL = {
      id: orderId,
      status: "pending",
      delivery_type: "delivery",
      payment_status: null,
      mp_payment_id: null,
    };
    CURRENT_USER_ID = encargadoId;

    const r = await rechazarPedido({
      order_id: orderId,
      business_slug: businessSlug,
      motivo: "zona fuera de cobertura",
    });

    // La contracara: apretar el permiso no puede romper el camino normal.
    expect(r.ok, r.ok ? "" : r.error).toBe(true);
  });
});
