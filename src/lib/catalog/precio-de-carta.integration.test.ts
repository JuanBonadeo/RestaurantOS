// @vitest-environment node
//
// P14 · issue #269 — hallazgos 2 y 5, los dos en la base.
//
// (2) Cambiar el precio de venta no dejaba rastro en ningún lado. El override
//     de UNA línea exige motivo y sale en el reporte «Precios modificados»; el
//     costo de un insumo se historiza solo en `ingredient_price_log`. Pero
//     `products` no tenía trigger, ni tabla de historial, ni siquiera
//     `updated_at`: el acto más caro del catálogo —que afecta TODAS las ventas
//     futuras del plato— era el único sin auditoría. Con la venta vieja se
//     podía deducir el precio anterior; el QUIÉN no se reconstruía nunca.
//
// (5) Un grupo de adicionales podía quedar colgado de un producto de OTRO
//     negocio: la policy de `modifier_groups` mira su propio `business_id` —el
//     del atacante— y no el del producto, y no había constraint que los atara.
//     El grupo aparecía en la carta pública y en la app del mozo de la víctima,
//     que no podía ni verlo ni borrarlo desde su admin.
//
// Los dos se prueban con el ROL REAL (JWT de la encargada, como el navegador):
// con `service_role` la RLS no corre y el verde no probaría nada.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";

config({ path: ".env.local" });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const anonKey =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const dbAvailable = Boolean(supabaseUrl && serviceKey && anonKey);

const TAG = `test-precio-carta-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const PASS = "test-pass-12345";

describe.skipIf(!dbAvailable)("catálogo · el precio de carta", () => {
  const admin = createClient(supabaseUrl!, serviceKey!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const negocios: string[] = [];
  let encargadaId: string;
  let encargadaEmail: string;
  let productoPropio: string;
  let productoAjeno: string;
  let businessPropio: string;

  const armarNegocio = async (sufijo: string) => {
    const { data: biz, error: bizErr } = await admin
      .from("businesses")
      .insert({
        slug: `${TAG}-${sufijo}`,
        name: `Negocio ${sufijo}`,
        is_active: true,
      })
      .select("id")
      .single();
    if (bizErr) throw new Error(`negocio: ${bizErr.message}`);
    negocios.push(biz!.id);

    const { data: cat } = await admin
      .from("categories")
      .insert({
        business_id: biz!.id,
        name: "Parrilla",
        slug: "parrilla",
        sort_order: 1,
      })
      .select("id")
      .single();
    const { data: prod, error: prodErr } = await admin
      .from("products")
      .insert({
        business_id: biz!.id,
        category_id: cat!.id,
        name: "Asado",
        slug: "asado",
        price_cents: 1_000_000,
        is_available: true,
      })
      .select("id")
      .single();
    if (prodErr) throw new Error(`producto: ${prodErr.message}`);
    return { businessId: biz!.id, productId: prod!.id };
  };

  /** Un cliente con la sesión REAL de la encargada — como el navegador. */
  const comoEncargada = async () => {
    const c = createClient(supabaseUrl!, anonKey!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { error } = await c.auth.signInWithPassword({
      email: encargadaEmail,
      password: PASS,
    });
    if (error) throw new Error(`login: ${error.message}`);
    return c;
  };

  beforeAll(async () => {
    encargadaEmail = `${TAG}@example.test`;
    const { data: u } = await admin.auth.admin.createUser({
      email: encargadaEmail,
      password: PASS,
      email_confirm: true,
    });
    encargadaId = u!.user!.id;
    await admin
      .from("users")
      .upsert({ id: encargadaId, email: encargadaEmail, full_name: "Sofía" });

    const propio = await armarNegocio("a");
    const ajeno = await armarNegocio("b");
    businessPropio = propio.businessId;
    productoPropio = propio.productId;
    productoAjeno = ajeno.productId;

    await admin.from("business_users").insert({
      business_id: businessPropio,
      user_id: encargadaId,
      role: "encargado",
      full_name: "Sofía",
    });
  });

  afterAll(async () => {
    for (const id of negocios)
      await admin.from("businesses").delete().eq("id", id);
    if (encargadaId) {
      await admin.from("users").delete().eq("id", encargadaId);
      await admin.auth.admin.deleteUser(encargadaId);
    }
  });

  it("subir el precio deja quién, cuándo y desde cuánto", async () => {
    const c = await comoEncargada();
    const { error } = await c
      .from("products")
      .update({ price_cents: 1_850_000 })
      .eq("id", productoPropio);
    expect(error, error?.message).toBeNull();

    const { data: log } = await admin
      .from("product_price_log")
      .select("old_price_cents, new_price_cents, recorded_by, business_id")
      .eq("product_id", productoPropio);

    expect(log ?? []).toHaveLength(1);
    expect(Number(log![0]!.old_price_cents)).toBe(1_000_000);
    expect(Number(log![0]!.new_price_cents)).toBe(1_850_000);
    // El QUIÉN es lo único que no se podía reconstruir de ninguna otra forma.
    expect(log![0]!.recorded_by).toBe(encargadaId);
    expect(log![0]!.business_id).toBe(businessPropio);
  });

  it("guardar el producto sin tocar el precio no ensucia el historial", async () => {
    const c = await comoEncargada();
    await c
      .from("products")
      .update({ name: "Asado de tira" })
      .eq("id", productoPropio);

    const { count } = await admin
      .from("product_price_log")
      .select("*", { count: "exact", head: true })
      .eq("product_id", productoPropio);
    expect(count).toBe(1);
  });

  it("la encargada ve el historial de SU negocio", async () => {
    const c = await comoEncargada();
    const { data } = await c
      .from("product_price_log")
      .select("id")
      .eq("product_id", productoPropio);
    expect(data ?? []).toHaveLength(1);
  });

  it("un adicional no se puede colgar de un producto de otro negocio", async () => {
    const c = await comoEncargada();
    const { error } = await c.from("modifier_groups").insert({
      business_id: businessPropio,
      product_id: productoAjeno,
      name: "INYECTADO",
      min_selection: 0,
      max_selection: 1,
    });

    // Tiene que rechazarlo la BASE: el grupo se inserta con el business_id del
    // atacante, así que la policy lo deja pasar y sólo la constraint lo frena.
    expect(error, "el insert cross-tenant tiene que fallar").not.toBeNull();

    const { count } = await admin
      .from("modifier_groups")
      .select("*", { count: "exact", head: true })
      .eq("product_id", productoAjeno);
    expect(count).toBe(0);
  });

  it("el grupo propio sigue entrando", async () => {
    // La contracara: atar el grupo al negocio del producto no puede romper el
    // camino normal del catálogo.
    const c = await comoEncargada();
    const { error } = await c.from("modifier_groups").insert({
      business_id: businessPropio,
      product_id: productoPropio,
      name: "Punto de cocción",
      min_selection: 1,
      max_selection: 1,
    });
    expect(error, error?.message).toBeNull();
  });
});
