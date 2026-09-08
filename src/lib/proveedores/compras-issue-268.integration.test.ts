// @vitest-environment node
//
// Issue #268 · los tres agujeros del alta de comprobantes:
//   1. la nota de crédito con renglones SUMABA stock y reescribía el costo;
//   5. la misma factura entraba dos veces sin que nada dijera nada;
//   6. el `expense_concept_id` de otro negocio viajaba del input al insert.
//
// Se verifica el EFECTO en la base (stock del insumo, costo de la presentación,
// filas de comprobante), no el retorno de la action.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";

config({ path: ".env.local" });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const dbAvailable = Boolean(supabaseUrl && serviceKey);

const TEST_TAG = `test-nc-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

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

const { createSupplierInvoice } = await import("./actions");

describe.skipIf(!dbAvailable)("alta de comprobantes · issue #268 (integration)", () => {
  const supabase = createClient(supabaseUrl!, serviceKey!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  let businessId: string;
  let businessSlug: string;
  let otroBusinessId: string;
  let encargadoId: string;
  let supplierId: string;
  let ingredientId: string;
  let presentationId: string;
  let conceptoAjenoId: string;

  /** Stock actual del insumo de prueba, leído de la base. */
  const stock = async () => {
    const { data } = await supabase
      .from("ingredients")
      .select("stock_quantity")
      .eq("id", ingredientId)
      .single();
    return Number(data!.stock_quantity);
  };

  const costoPresentacion = async () => {
    const { data } = await supabase
      .from("ingredient_presentations")
      .select("cost_cents")
      .eq("id", presentationId)
      .single();
    return data!.cost_cents;
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
      .insert({ slug: TEST_TAG, name: "NC Test", is_active: true })
      .select("id, slug")
      .single();
    businessId = biz!.id;
    businessSlug = biz!.slug;

    const { data: otro } = await supabase
      .from("businesses")
      .insert({ slug: `${TEST_TAG}-otro`, name: "NC Test Otro", is_active: true })
      .select("id")
      .single();
    otroBusinessId = otro!.id;

    await supabase.from("business_users").insert({
      business_id: businessId,
      user_id: encargadoId,
      role: "encargado",
      full_name: "Encargada",
    });

    const { data: sup } = await supabase
      .from("suppliers")
      .insert({ business_id: businessId, name: `Verdulería ${TEST_TAG}`, is_active: true })
      .select("id")
      .single();
    supplierId = sup!.id;

    const { data: ing } = await supabase
      .from("ingredients")
      .insert({
        business_id: businessId,
        name: `Tomate ${TEST_TAG}`,
        unit: "kg",
        stock_quantity: 11.27,
        waste_percent: 0,
      })
      .select("id")
      .single();
    ingredientId = ing!.id;

    const { data: pres } = await supabase
      .from("ingredient_presentations")
      .insert({
        ingredient_id: ingredientId,
        name: "Cajón 20 kg",
        net_quantity: 20,
        cost_cents: 225_000,
        is_default: true,
      })
      .select("id")
      .single();
    presentationId = pres!.id;

    // El concepto vive en el OTRO negocio: el FK sólo chequea existencia.
    const { data: concepto } = await supabase
      .from("expense_concepts")
      .insert({ business_id: otroBusinessId, name: `Mercaderías ${TEST_TAG}`, rubro: "mercaderias" })
      .select("id")
      .single();
    conceptoAjenoId = concepto!.id;

    CURRENT_USER_ID = encargadoId;
  }, 30_000);

  afterAll(async () => {
    for (const bid of [businessId, otroBusinessId]) {
      const { data: invs } = await supabase
        .from("supplier_invoices")
        .select("id")
        .eq("business_id", bid);
      for (const inv of invs ?? []) {
        await supabase.from("supplier_invoice_items").delete().eq("invoice_id", inv.id);
      }
      await supabase.from("supplier_invoices").delete().eq("business_id", bid);
      await supabase.from("ingredient_consumptions").delete().eq("business_id", bid);
      const { data: ings } = await supabase.from("ingredients").select("id").eq("business_id", bid);
      for (const ing of ings ?? []) {
        await supabase.from("ingredient_presentations").delete().eq("ingredient_id", ing.id);
      }
      await supabase.from("ingredients").delete().eq("business_id", bid);
      await supabase.from("expense_concepts").delete().eq("business_id", bid);
      await supabase.from("suppliers").delete().eq("business_id", bid);
      await supabase.from("business_users").delete().eq("business_id", bid);
      await supabase.from("businesses").delete().eq("id", bid);
    }
    await supabase.auth.admin.deleteUser(encargadoId);
  }, 30_000);

  // ── 1 · la nota de crédito devuelve mercadería ──────────────────────────

  it("la nota de crédito con renglones BAJA el stock y no toca el precio del insumo", async () => {
    const antes = await stock();
    const costoAntes = await costoPresentacion();

    const r = await createSupplierInvoice(businessSlug, {
      supplier_id: supplierId,
      invoice_number: `NC-${TEST_TAG}`,
      invoice_date: "2026-09-01",
      total_cents: -900_000,
      document_type: "nota_credito",
      items: [
        {
          ingredient_id: ingredientId,
          presentation_id: presentationId,
          units: 2,
          unit_cost_cents: 450_000,
        },
      ],
    });

    expect(r.ok).toBe(true);

    // 2 cajones × 20 kg = 40 kg que SALEN. Antes subía 40 (error de 80 kg).
    expect(await stock()).toBeCloseTo(antes - 40, 3);

    // Devolver mercadería no es un precio de compra: el proveedor no cobró
    // $4.500 el kilo, lo reintegró. Antes esto duplicaba el costo del plato.
    expect(await costoPresentacion()).toBe(costoAntes);

    const { data: log } = await supabase
      .from("ingredient_price_log")
      .select("id")
      .eq("presentation_id", presentationId);
    expect(log ?? []).toHaveLength(0);

    // El consumo queda como 'reversion' negativa: es la misma forma que usa la
    // anulación de comprobante, y el reporte de merma la lee con signo.
    const { data: cons } = await supabase
      .from("ingredient_consumptions")
      .select("kind, quantity")
      .eq("ingredient_id", ingredientId);
    const rev = (cons ?? []).filter((c) => c.kind === "reversion");
    expect(rev).toHaveLength(1);
    expect(Number(rev[0].quantity)).toBeCloseTo(-40, 3);
  });

  it("la factura normal sigue sumando stock y reescribiendo el precio", async () => {
    const antes = await stock();

    const r = await createSupplierInvoice(businessSlug, {
      supplier_id: supplierId,
      invoice_number: `FA-${TEST_TAG}`,
      invoice_date: "2026-09-02",
      total_cents: 900_000,
      document_type: "factura_a",
      items: [
        {
          ingredient_id: ingredientId,
          presentation_id: presentationId,
          units: 2,
          unit_cost_cents: 300_000,
        },
      ],
    });

    expect(r.ok).toBe(true);
    expect(await stock()).toBeCloseTo(antes + 40, 3);
    expect(await costoPresentacion()).toBe(300_000);
  });

  // ── 5 · la misma factura no entra dos veces ─────────────────────────────

  it("cargar dos veces la misma factura del mismo proveedor rebota", async () => {
    const payload = {
      supplier_id: supplierId,
      invoice_number: `0001-00012345-${TEST_TAG}`,
      invoice_date: "2026-09-03",
      total_cents: 150_000,
      document_type: "factura_a" as const,
      items: [],
    };

    const primera = await createSupplierInvoice(businessSlug, payload);
    expect(primera.ok).toBe(true);

    const segunda = await createSupplierInvoice(businessSlug, payload);
    expect(segunda.ok).toBe(false);
    if (!segunda.ok) expect(segunda.error).toMatch(/ya cargaste|ya está cargad/i);

    const { data: filas } = await supabase
      .from("supplier_invoices")
      .select("id")
      .eq("business_id", businessId)
      .eq("invoice_number", payload.invoice_number);
    expect(filas ?? []).toHaveLength(1);
  });

  it("dos compras internas sin número el mismo día siguen entrando: no son un duplicado", async () => {
    const payload = {
      supplier_id: supplierId,
      invoice_date: "2026-09-04",
      total_cents: 42_000,
      document_type: "interno" as const,
      items: [],
    };

    expect((await createSupplierInvoice(businessSlug, payload)).ok).toBe(true);
    expect((await createSupplierInvoice(businessSlug, payload)).ok).toBe(true);
  });

  // ── 6 · el concepto de gasto es del negocio ─────────────────────────────

  it("un expense_concept_id de otro negocio no entra", async () => {
    const r = await createSupplierInvoice(businessSlug, {
      supplier_id: supplierId,
      invoice_number: `CONC-${TEST_TAG}`,
      invoice_date: "2026-09-05",
      total_cents: 10_000,
      document_type: "factura_a",
      expense_concept_id: conceptoAjenoId,
      items: [],
    });

    expect(r.ok).toBe(false);

    const { data: filas } = await supabase
      .from("supplier_invoices")
      .select("id")
      .eq("business_id", businessId)
      .eq("expense_concept_id", conceptoAjenoId);
    expect(filas ?? []).toHaveLength(0);
  });
});
