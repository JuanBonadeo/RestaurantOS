// @vitest-environment node
//
// Issue #268 · hallazgo 2 — uno anula el comprobante mientras el otro lo paga.
//
// `anularComprobante` leía `supplier_payment_allocations` en una consulta suelta
// y escribía la anulación TRES round-trips después (con la RPC de reversión de
// stock en el medio). En esa ventana entra entero un `registrar_pago_proveedor_tx`:
// quedaban las dos escrituras, o sea un comprobante ANULADO con un pago VIVO
// imputado. Como el saldo es derivado (Σ comprobantes vivos − Σ pagos vivos), el
// proveedor pasaba a tener plata «a favor» que nadie le debe.
//
// El invariante que se verifica es de la BASE, no del retorno de la action:
// **nunca puede haber un comprobante anulado con un pago vivo imputado**.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";

config({ path: ".env.local" });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const dbAvailable = Boolean(supabaseUrl && serviceKey);

const TEST_TAG = `test-carrera-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

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

const { anularComprobante, registrarPagoProveedor } = await import(
  "./cuenta-corriente-actions"
);

describe.skipIf(!dbAvailable)("anular vs. pagar · issue #268 (integration)", () => {
  const supabase = createClient(supabaseUrl!, serviceKey!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  let businessId: string;
  let businessSlug: string;
  let encargadoId: string;
  let supplierId: string;

  const nuevoComprobante = async (numero: string, total = 500_000) => {
    const { data } = await supabase
      .from("supplier_invoices")
      .insert({
        business_id: businessId,
        supplier_id: supplierId,
        invoice_number: numero,
        invoice_date: "2026-09-01",
        total_cents: total,
        document_type: "factura_a",
      })
      .select("id")
      .single();
    return data!.id as string;
  };

  /** El estado que la guarda dice impedir: anulado + pago vivo imputado. */
  const estadoInvalido = async (invoiceId: string) => {
    const { data: inv } = await supabase
      .from("supplier_invoices")
      .select("cancelled_at")
      .eq("id", invoiceId)
      .single();
    const { data: allocs } = await supabase
      .from("supplier_payment_allocations")
      .select("amount_cents, supplier_payments!inner(cancelled_at)")
      .eq("invoice_id", invoiceId);
    const pagoVivo = (allocs ?? []).some(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (a: any) =>
        (Array.isArray(a.supplier_payments) ? a.supplier_payments : [a.supplier_payments]).some(
          (p: { cancelled_at: string | null } | null) => p != null && p.cancelled_at == null,
        ),
    );
    return Boolean(inv!.cancelled_at) && pagoVivo;
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
      .insert({ slug: TEST_TAG, name: "Carrera Test", is_active: true })
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

    const { data: sup } = await supabase
      .from("suppliers")
      .insert({ business_id: businessId, name: `Distribuidora ${TEST_TAG}`, is_active: true })
      .select("id")
      .single();
    supplierId = sup!.id;

    CURRENT_USER_ID = encargadoId;
  }, 30_000);

  afterAll(async () => {
    await supabase.from("supplier_payment_allocations").delete().eq("business_id", businessId);
    await supabase.from("supplier_payments").delete().eq("business_id", businessId);
    await supabase.from("supplier_invoices").delete().eq("business_id", businessId);
    await supabase.from("suppliers").delete().eq("business_id", businessId);
    await supabase.from("business_users").delete().eq("business_id", businessId);
    await supabase.from("businesses").delete().eq("id", businessId);
    await supabase.auth.admin.deleteUser(encargadoId);
  }, 30_000);

  // ── la guarda vive adentro de la transacción ───────────────────────────
  //
  // Antes la guarda era una lectura de PostgREST y la escritura otra: entre las
  // dos no había nada que impidiera el pago. Ahora las dos ocurren bajo el mismo
  // `for update` que toma `registrar_pago_proveedor_tx`.

  it("la RPC de anulación rechaza el comprobante con un pago vivo, y no lo anula", async () => {
    const invoiceId = await nuevoComprobante(`RPC-VIVO-${TEST_TAG}`);

    const pago = await registrarPagoProveedor(businessSlug, {
      supplier_id: supplierId,
      amount_cents: 500_000,
      method: "transfer",
      invoice_ids: [invoiceId],
    });
    expect(pago.ok).toBe(true);

    const { error } = await supabase.rpc("anular_comprobante_tx", {
      p_business_id: businessId,
      p_invoice_id: invoiceId,
      p_cancelled_by: encargadoId,
      p_reason: "prueba",
    });

    expect(error?.message ?? "").toContain("COMPROBANTE_CON_PAGO_VIVO");

    const { data: inv } = await supabase
      .from("supplier_invoices")
      .select("cancelled_at")
      .eq("id", invoiceId)
      .single();
    expect(inv!.cancelled_at).toBeNull();
    expect(await estadoInvalido(invoiceId)).toBe(false);
  });

  it("anulado el comprobante, el pago que llega después rebota", async () => {
    const invoiceId = await nuevoComprobante(`POST-ANUL-${TEST_TAG}`);

    expect(
      (await anularComprobante(businessSlug, { id: invoiceId, reason: "era de otro local" })).ok,
    ).toBe(true);

    const pago = await registrarPagoProveedor(businessSlug, {
      supplier_id: supplierId,
      amount_cents: 500_000,
      method: "transfer",
      invoice_ids: [invoiceId],
    });

    expect(pago.ok).toBe(false);
    expect(await estadoInvalido(invoiceId)).toBe(false);
  });

  // ── el invariante bajo carrera real ────────────────────────────────────
  //
  // Los dos salen a la vez sobre el mismo comprobante. El `for update` los
  // serializa: una de las dos SIEMPRE pierde. No se afirma cuál —eso depende de
  // quién llegue primero, y las dos respuestas son correctas— sino que el estado
  // final nunca es el prohibido.
  it("anular y pagar en simultáneo nunca dejan un comprobante anulado con pago vivo", async () => {
    for (let i = 0; i < 6; i++) {
      const invoiceId = await nuevoComprobante(`RACE-${i}-${TEST_TAG}`);

      const [anul, pago] = await Promise.all([
        anularComprobante(businessSlug, { id: invoiceId, reason: "duplicado" }),
        registrarPagoProveedor(businessSlug, {
          supplier_id: supplierId,
          amount_cents: 500_000,
          method: "transfer",
          invoice_ids: [invoiceId],
        }),
      ]);

      // Exactamente una gana. Que las dos den ok era el bug.
      expect([anul.ok, pago.ok].filter(Boolean)).toHaveLength(1);
      expect(await estadoInvalido(invoiceId)).toBe(false);
    }
  }, 60_000);

  // ── el gemelo: editarComprobante tenía la guarda copiada ───────────────

  it("editar la plata de un comprobante con pago vivo rebota; la clasificación no", async () => {
    const invoiceId = await nuevoComprobante(`EDIT-${TEST_TAG}`);
    const { data: concepto } = await supabase
      .from("expense_concepts")
      .insert({ business_id: businessId, name: `Mercaderías ${TEST_TAG}`, rubro: "mercaderias" })
      .select("id")
      .single();

    expect(
      (
        await registrarPagoProveedor(businessSlug, {
          supplier_id: supplierId,
          amount_cents: 500_000,
          method: "transfer",
          invoice_ids: [invoiceId],
        })
      ).ok,
    ).toBe(true);

    const { editarComprobante } = await import("./cuenta-corriente-actions");

    const plata = await editarComprobante(businessSlug, {
      id: invoiceId,
      total_cents: 999_999,
    });
    expect(plata.ok).toBe(false);

    const clasificacion = await editarComprobante(businessSlug, {
      id: invoiceId,
      expense_concept_id: concepto!.id,
    });
    expect(clasificacion.ok).toBe(true);

    const { data: inv } = await supabase
      .from("supplier_invoices")
      .select("total_cents, expense_concept_id")
      .eq("id", invoiceId)
      .single();
    expect(inv!.total_cents).toBe(500_000);
    expect((inv as unknown as { expense_concept_id: string }).expense_concept_id).toBe(
      concepto!.id,
    );
  });

  it("editar con un concepto de otro negocio no entra", async () => {
    const invoiceId = await nuevoComprobante(`EDIT-CONC-${TEST_TAG}`);

    const { data: otroBiz } = await supabase
      .from("businesses")
      .insert({ slug: `${TEST_TAG}-ajeno`, name: "Ajeno", is_active: true })
      .select("id")
      .single();
    const { data: conceptoAjeno } = await supabase
      .from("expense_concepts")
      .insert({ business_id: otroBiz!.id, name: `Ajeno ${TEST_TAG}`, rubro: "servicios" })
      .select("id")
      .single();

    const { editarComprobante } = await import("./cuenta-corriente-actions");
    const r = await editarComprobante(businessSlug, {
      id: invoiceId,
      expense_concept_id: conceptoAjeno!.id,
    });

    expect(r.ok).toBe(false);

    const { data: inv } = await supabase
      .from("supplier_invoices")
      .select("expense_concept_id")
      .eq("id", invoiceId)
      .single();
    expect((inv as unknown as { expense_concept_id: string | null }).expense_concept_id).toBeNull();

    await supabase.from("expense_concepts").delete().eq("id", conceptoAjeno!.id);
    await supabase.from("businesses").delete().eq("id", otroBiz!.id);
  });
});
