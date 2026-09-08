// @vitest-environment node
//
// P07 · issue #260 — un adicional de otro negocio no entra al pedido.
//
// `persistOrder` validaba el `product_id` contra el negocio pero los
// `modifier_ids` los buscaba **sólo por id**. Y escribe con el service client,
// así que las policies de `modifiers` —que cuelgan de
// `modifier_groups.business_id`, porque la tabla no tiene `business_id` propio—
// no corren. Mandando el id de un adicional de otro local, la línea entraba con
// su nombre y su precio.
//
// En la nube conviven `demo`, `golf-jcr` y `kcc`: los ids ajenos existen de
// verdad.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";

config({ path: ".env.local" });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const dbAvailable = Boolean(supabaseUrl && serviceKey);

const TAG = `test-modxt-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

describe.skipIf(!dbAvailable)("persistOrder · adicionales por negocio", () => {
  const db = createClient(supabaseUrl!, serviceKey!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const negocios: string[] = [];
  let modPropio: string;
  let modAjeno: string;

  const armarNegocio = async (slug: string, precioAdicional: number) => {
    const { data: biz } = await db
      .from("businesses")
      .insert({ slug, name: slug, is_active: true })
      .select("id").single();
    negocios.push(biz!.id);

    const { data: cat, error: catErr } = await db
      .from("categories")
      .insert({ business_id: biz!.id, name: "Cat", slug: "cat", sort_order: 1 })
      .select("id").single();
    if (catErr) throw new Error(`cat: ${catErr.message}`);
    const { data: prod, error: pErr } = await db
      .from("products")
      .insert({
        business_id: biz!.id, category_id: cat!.id, name: "Plato", slug: "plato",
        price_cents: 10_000, is_available: true,
      })
      .select("id").single();
    if (pErr) throw new Error(`prod: ${pErr.message}`);
    const { data: grupo, error: gErr } = await db
      .from("modifier_groups")
      .insert({ business_id: biz!.id, product_id: prod!.id, name: "Extras", min_selection: 0, max_selection: 3 })
      .select("id").single();
    if (gErr) throw new Error(`grupo: ${gErr.message}`);
    const { data: mod, error: mErr } = await db
      .from("modifiers")
      .insert({
        group_id: grupo!.id, name: `Extra ${slug}`,
        price_delta_cents: precioAdicional, is_available: true,
      })
      .select("id").single();
    if (mErr) throw new Error(`mod: ${mErr.message}`);
    return { businessId: biz!.id, productId: prod!.id, modifierId: mod!.id };
  };

  let propio: Awaited<ReturnType<typeof armarNegocio>>;

  beforeAll(async () => {
    propio = await armarNegocio(`${TAG}-a`, 500);
    const ajeno = await armarNegocio(`${TAG}-b`, 99_000);
    modPropio = propio.modifierId;
    modAjeno = ajeno.modifierId;
  });

  afterAll(async () => {
    for (const id of negocios) await db.from("businesses").delete().eq("id", id);
  });

  it("el adicional propio se resuelve por el negocio", async () => {
    const { data } = await db
      .from("modifiers")
      .select("id, modifier_groups!inner(business_id)")
      .in("id", [modPropio])
      .eq("modifier_groups.business_id", propio.businessId);
    expect(data ?? []).toHaveLength(1);
  });

  it("el de otro negocio no vuelve: el pedido lo rechaza por faltante", async () => {
    const { data } = await db
      .from("modifiers")
      .select("id, modifier_groups!inner(business_id)")
      .in("id", [modPropio, modAjeno])
      .eq("modifier_groups.business_id", propio.businessId);
    // Vuelve uno solo de los dos pedidos → `persistOrder` corta con
    // «Algún adicional ya no está disponible».
    expect((data ?? []).length).toBe(1);
    expect((data ?? [])[0]!.id).toBe(modPropio);
  });
});
