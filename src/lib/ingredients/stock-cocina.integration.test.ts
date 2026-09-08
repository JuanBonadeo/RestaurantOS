// @vitest-environment node
//
// El stock de cocina — issues #268 (hallazgo 4) y #270 (hallazgos 2, 3 y 4).
//
// `ingresarStockCocina` y `ajustarStockCocina` eran las dos últimas escrituras
// de inventario que quedaban con read-modify-write en JS: leían
// `stock_quantity`, sumaban en el proceso y escribían el ABSOLUTO. Cualquier
// movimiento que cayera en el medio —una venta descargando receta, otro
// ingreso, la RPC de una compra— se perdía. El repo ya había resuelto esto para
// el bar (`adjust_stock_item`, spec 36) y para la compra por renglón (0073);
// sólo la cocina quedó afuera.
//
// Y las dos tiraban a la basura el motivo que la pantalla exige con asterisco
// rojo, el autor, el signo del ajuste y el costo del movimiento.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";

config({ path: ".env.local" });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const dbAvailable = Boolean(supabaseUrl && serviceKey);

const TEST_TAG = `test-stkcoc-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

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

const { ingresarStockCocina, ajustarStockCocina } = await import("./actions");

describe.skipIf(!dbAvailable)("stock de cocina (integration)", () => {
  const supabase = createClient(supabaseUrl!, serviceKey!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  let businessId: string;
  let businessSlug: string;
  let encargadoId: string;
  let ingredientId: string;
  let presentationId: string;

  const stock = async () => {
    const { data } = await supabase
      .from("ingredients")
      .select("stock_quantity")
      .eq("id", ingredientId)
      .single();
    return Number(data!.stock_quantity);
  };

  const setStock = async (q: number) => {
    await supabase.from("ingredients").update({ stock_quantity: q }).eq("id", ingredientId);
  };

  const consumos = async () => {
    const { data } = await supabase
      .from("ingredient_consumptions")
      .select("*")
      .eq("ingredient_id", ingredientId)
      .order("created_at", { ascending: true });
    return (data ?? []) as unknown as Array<{
      kind: string;
      quantity: string | number;
      cost_cents_snapshot: number;
      reason: string | null;
      created_by: string | null;
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
      .insert({ slug: TEST_TAG, name: "Stock Cocina Test", is_active: true })
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

    const { data: ing } = await supabase
      .from("ingredients")
      .insert({
        business_id: businessId,
        name: `Entraña ${TEST_TAG}`,
        unit: "kg",
        stock_quantity: 0,
        waste_percent: 0,
      })
      .select("id")
      .single();
    ingredientId = ing!.id;

    // 1 envase = 5 kg a $2.000 el envase ⇒ $400 el kilo (40.000 centavos).
    const { data: pres } = await supabase
      .from("ingredient_presentations")
      .insert({
        ingredient_id: ingredientId,
        name: "Vacío 5 kg",
        net_quantity: 5,
        cost_cents: 200_000,
        is_default: true,
      })
      .select("id")
      .single();
    presentationId = pres!.id;

    CURRENT_USER_ID = encargadoId;
  }, 30_000);

  beforeEach(async () => {
    await supabase.from("ingredient_consumptions").delete().eq("ingredient_id", ingredientId);
    await setStock(0);
  });

  afterAll(async () => {
    await supabase.from("ingredient_consumptions").delete().eq("business_id", businessId);
    await supabase.from("ingredient_presentations").delete().eq("ingredient_id", ingredientId);
    await supabase.from("ingredients").delete().eq("business_id", businessId);
    await supabase.from("business_users").delete().eq("business_id", businessId);
    await supabase.from("businesses").delete().eq("id", businessId);
    await supabase.auth.admin.deleteUser(encargadoId);
  }, 30_000);

  // ── #268 · 4 / #270 · 4 — el lost update ───────────────────────────────
  //
  // Ocho ingresos a la vez. Con read-modify-write, los que leen el mismo valor
  // se pisan y el total queda corto; con el update atómico el total es el total
  // sin importar el orden en que lleguen. Se afirma la SUMA, no una secuencia:
  // eso es lo que hace al test determinista.

  it("ocho ingresos en simultáneo suman los ocho", async () => {
    await Promise.all(
      Array.from({ length: 8 }, () =>
        ingresarStockCocina(businessSlug, {
          ingredient_id: ingredientId,
          presentation_id: presentationId,
          units: 1,
        }),
      ),
    );

    // 8 envases × 5 kg
    expect(await stock()).toBeCloseTo(40, 3);
  });

  it("ocho ajustes en simultáneo se aplican los ocho", async () => {
    await setStock(100);

    await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        ajustarStockCocina(businessSlug, {
          ingredient_id: ingredientId,
          quantity: -1,
          reason: `conteo ${i}`,
        }),
      ),
    );

    expect(await stock()).toBeCloseTo(92, 3);
  });

  // ── #268 · 4 — el ingreso manual escribía el costo en 0 ─────────────────

  it("el ingreso manual anota la plata real del movimiento, no 0", async () => {
    await ingresarStockCocina(businessSlug, {
      ingredient_id: ingredientId,
      presentation_id: presentationId,
      units: 3,
      reason: "llegó el pedido del jueves",
    });

    const [c] = await consumos();
    expect(c.kind).toBe("compra");
    expect(Number(c.quantity)).toBeCloseTo(15, 3);
    // 3 envases × $2.000 = $6.000
    expect(c.cost_cents_snapshot).toBe(600_000);
    expect(c.reason).toBe("llegó el pedido del jueves");
    expect(c.created_by).toBe(encargadoId);
  });

  // ── #270 · 3 — el motivo con asterisco rojo, el autor y el signo ────────

  it("el ajuste guarda el motivo, el autor y el signo", async () => {
    await setStock(10);

    await ajustarStockCocina(businessSlug, {
      ingredient_id: ingredientId,
      quantity: -5,
      reason: "se cortó la cadena de frío el sábado",
    });

    const [c] = await consumos();
    expect(c.reason).toBe("se cortó la cadena de frío el sábado");
    expect(c.created_by).toBe(encargadoId);
    // El signo: una baja de 5 y un alta de 5 no pueden quedar idénticas en el log.
    expect(Number(c.quantity)).toBeCloseTo(-5, 3);
  });

  // ── #270 · 2 — el tile «Merma · 30 días» decía $0,00 para siempre ───────
  //
  // Ningún camino de la app escribía nunca `kind='merma'`: el único productor
  // era el seed. Decisión de producto: el ajuste NEGATIVO de cocina es merma
  // (mercadería que se fue sin venderse) y se valoriza con el costo vivo del
  // insumo; el positivo sigue siendo un 'ajuste' de conteo.

  it("bajar stock a mano escribe una merma valorizada", async () => {
    await setStock(10);

    await ajustarStockCocina(businessSlug, {
      ingredient_id: ingredientId,
      quantity: -5,
      reason: "se pudrió la entraña, la tiramos",
    });

    const [c] = await consumos();
    expect(c.kind).toBe("merma");
    // 5 kg × $400/kg = $2.000
    expect(c.cost_cents_snapshot).toBe(200_000);
  });

  it("subir stock a mano sigue siendo un ajuste de conteo, no una merma", async () => {
    await setStock(10);

    await ajustarStockCocina(businessSlug, {
      ingredient_id: ingredientId,
      quantity: 2,
      reason: "conté mal el lunes",
    });

    const [c] = await consumos();
    expect(c.kind).toBe("ajuste");
    expect(Number(c.quantity)).toBeCloseTo(2, 3);
    expect(await stock()).toBeCloseTo(12, 3);
  });

  it("el insumo de otro negocio sigue sin entrar", async () => {
    const { data: otro } = await supabase
      .from("businesses")
      .insert({ slug: `${TEST_TAG}-otro`, name: "Otro", is_active: true })
      .select("id")
      .single();
    const { data: ajeno } = await supabase
      .from("ingredients")
      .insert({ business_id: otro!.id, name: `Ajeno ${TEST_TAG}`, unit: "kg" })
      .select("id")
      .single();

    const r = await ajustarStockCocina(businessSlug, {
      ingredient_id: ajeno!.id,
      quantity: -1,
      reason: "prueba",
    });
    expect(r.ok).toBe(false);

    await supabase.from("ingredients").delete().eq("id", ajeno!.id);
    await supabase.from("businesses").delete().eq("id", otro!.id);
  });
});
