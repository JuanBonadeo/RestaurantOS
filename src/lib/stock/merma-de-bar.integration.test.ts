// @vitest-environment node
//
// Issue #270 · hallazgo 5 — la botella que se rompe queda registrada, pero no
// vale nada en ningún reporte.
//
// La pantalla del bar dice literalmente «Cantidad (negativa = merma)» y el
// placeholder es «Ej: Botella rota». Y el movimiento se guardaba con
// `kind='ajuste'`, el MISMO tipo que un conteo físico: ni el tipo distinguía una
// rotura de una corrección, sólo el texto libre del motivo. Encima
// `stock_movimientos` no tenía ninguna columna de plata, así que el costo de una
// botella de whisky importado —$30.000 a $60.000— no existía en el sistema.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";

config({ path: ".env.local" });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const dbAvailable = Boolean(supabaseUrl && serviceKey);

const TEST_TAG = `test-mermabar-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

let CURRENT_USER_ID = "";

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({
    auth: {
      getClaims: async () => ({ data: { claims: { sub: CURRENT_USER_ID } }, error: null }),
      getUser: async () => ({ data: { user: { id: CURRENT_USER_ID } }, error: null }),
    },
  }),
}));

vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");
  return { ...actual, cache: <T>(fn: T) => fn };
});

vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));

const { ajustarStock, ingresarStock, setStockLevels } = await import("./actions");
const { getMermaDeBar } = await import("./queries");

describe.skipIf(!dbAvailable)("merma de bar (integration)", () => {
  const supabase = createClient(supabaseUrl!, serviceKey!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  let businessId: string;
  let businessSlug: string;
  let encargadoId: string;
  let productId: string;
  let stockItemId: string;

  const movimientos = async () => {
    const { data } = await supabase
      .from("stock_movimientos")
      .select("*")
      .eq("stock_item_id", stockItemId)
      .order("created_at", { ascending: true });
    return (data ?? []) as unknown as Array<{
      kind: string;
      qty: number;
      reason: string | null;
      created_by: string | null;
      cost_cents_snapshot: number | null;
    }>;
  };

  beforeAll(async () => {
    const email = `${TEST_TAG}-enc@example.test`;
    const { data: created } = await supabase.auth.admin.createUser({
      email,
      password: "test-pass-12345",
      email_confirm: true,
    });
    encargadoId = created!.user!.id;
    await supabase.from("users").upsert({ id: encargadoId, email, full_name: "Encargada" });

    const { data: biz } = await supabase
      .from("businesses")
      .insert({ slug: TEST_TAG, name: "Merma Bar Test", is_active: true })
      .select("id, slug")
      .single();
    businessId = biz!.id;
    businessSlug = biz!.slug;

    await supabase.from("business_users").insert({
      business_id: businessId,
      user_id: encargadoId,
      role: "encargado",
      full_name: "Encargada",
    });

    const { data: cat } = await supabase
      .from("categories")
      .insert({ business_id: businessId, name: `Bebidas ${TEST_TAG}`, slug: `beb-${TEST_TAG}` })
      .select("id")
      .single();

    const { data: prod } = await supabase
      .from("products")
      .insert({
        business_id: businessId,
        category_id: cat!.id,
        name: `Whisky ${TEST_TAG}`,
        slug: `whisky-${TEST_TAG}`,
        price_cents: 1_200_000,
        track_stock: true,
        is_bar_stock: true,
      })
      .select("id")
      .single();
    productId = prod!.id;

    CURRENT_USER_ID = encargadoId;

    await setStockLevels(productId, 10, 2, businessSlug);
    const { data: item } = await supabase
      .from("stock_items")
      .select("id")
      .eq("product_id", productId)
      .single();
    stockItemId = item!.id;
  }, 30_000);

  beforeEach(async () => {
    await supabase.from("stock_movimientos").delete().eq("stock_item_id", stockItemId);
    await supabase
      .from("stock_items")
      .update({ current_qty: 10, unit_cost_cents: 0 })
      .eq("id", stockItemId);
  });

  afterAll(async () => {
    await supabase.from("stock_movimientos").delete().eq("business_id", businessId);
    await supabase.from("stock_items").delete().eq("business_id", businessId);
    await supabase.from("products").delete().eq("business_id", businessId);
    await supabase.from("categories").delete().eq("business_id", businessId);
    await supabase.from("business_users").delete().eq("business_id", businessId);
    await supabase.from("businesses").delete().eq("id", businessId);
    await supabase.auth.admin.deleteUser(encargadoId);
  }, 30_000);

  it("el ingreso con costo deja el costo de reposición en el ítem", async () => {
    await ingresarStock(productId, 6, businessSlug, "compra al distribuidor", 400_000);

    const { data: item } = await supabase
      .from("stock_items")
      .select("current_qty, unit_cost_cents")
      .eq("id", stockItemId)
      .single();
    expect(item!.current_qty).toBe(16);
    expect((item as unknown as { unit_cost_cents: number }).unit_cost_cents).toBe(400_000);
  });

  it("la baja a mano queda como merma, valorizada al costo de reposición", async () => {
    await ingresarStock(productId, 6, businessSlug, "compra al distribuidor", 400_000);
    await ajustarStock(productId, -1, "botella rota", businessSlug);

    const merma = (await movimientos()).find((m) => m.kind === "merma");
    expect(merma, "la rotura no quedó marcada como merma").toBeDefined();
    expect(merma!.qty).toBe(-1);
    expect(merma!.reason).toBe("botella rota");
    expect(merma!.created_by).toBe(encargadoId);
    expect(merma!.cost_cents_snapshot).toBe(400_000);
  });

  it("el ajuste que SUMA sigue siendo un ajuste de conteo", async () => {
    await ajustarStock(productId, 3, "apareció un cajón en el depósito", businessSlug);

    const [m] = await movimientos();
    expect(m.kind).toBe("ajuste");
    expect(m.qty).toBe(3);
  });

  // La plata tiene que poder leerse en algún lado: hasta ahora había que entrar
  // producto por producto al sheet del historial.
  it("la merma del período se puede leer valorizada y agrupada", async () => {
    await ingresarStock(productId, 6, businessSlug, "compra", 400_000);
    await ajustarStock(productId, -1, "botella rota", businessSlug);
    await ajustarStock(productId, -2, "se cayó la bandeja", businessSlug);

    const desde = new Date(Date.now() - 60_000).toISOString();
    const hasta = new Date(Date.now() + 60_000).toISOString();
    const reporte = await getMermaDeBar(businessId, desde, hasta);

    const fila = reporte.find((r) => r.productId === productId);
    expect(fila).toBeDefined();
    expect(fila!.qty).toBe(3);
    expect(fila!.costCents).toBe(1_200_000);
  });
});
