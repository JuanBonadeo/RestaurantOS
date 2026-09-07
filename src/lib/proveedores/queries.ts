import "server-only";


import { createSupabaseServiceClient } from "@/lib/supabase/service";

import { enLotes, fetchAll, unwrap } from "./unwrap";

import type {
  SupplierIngredientLink,
  SupplierInvoice,
  SupplierOutflowItem,
  SupplierStats,
  SupplierWithStats,
} from "./types";

function db() {
  return createSupabaseServiceClient();
}

/**
 * Las columnas de la spec 158 llegan en el `select("*")` pero todavía no están
 * en `database.types.ts` (el `pnpm db:types` del repo necesita el CLI linkeado).
 * Estos accesos las leen sin apagar el tipado del resto de la fila.
 */
type ColumnasSpec158 = {
  default_expense_concept_id?: string | null;
  payment_terms_days?: number | null;
  document_type?: string | null;
  expense_concept_id?: string | null;
  due_date?: string | null;
  cancelled_at?: string | null;
  cancelled_reason?: string | null;
};

function extra(row: unknown): ColumnasSpec158 {
  return row as ColumnasSpec158;
}

// ── Suppliers list (with aggregated stats) ──────────────────────

export async function getSuppliers(
  businessId: string,
): Promise<SupplierWithStats[]> {
  const service = db();

  const suppliers = await fetchAll(
    () => service.from("suppliers").select("*").eq("business_id", businessId).order("id"),
    "suppliers",
  );

  if (!suppliers.length) return [];

  // Por lotes: con 111 proveedores hoy entra de sobra, pero el límite del
  // `.in()` es el largo de la URL y no avisa — devuelve `Bad Request`.
  const invoiceAgg = await enLotes(
    suppliers.map((s) => s.id),
    async (lote) =>
      unwrap(
        await service
          .from("supplier_invoices")
          .select("supplier_id, total_cents, invoice_date")
          .eq("business_id", businessId)
          // Spec 163 — «Total comprado» contaba los anulados. La Cta. Cte. sí los
          // filtra, así que la misma plata daba dos números distintos a doce
          // líneas de distancia, en tres superficies.
          .is("cancelled_at", null)
          .in("supplier_id", lote),
        "supplier_invoices",
      ),
  );

  const statsMap = new Map<
    string,
    { total: number; count: number; last: string | null }
  >();

  for (const inv of invoiceAgg) {
    const entry = statsMap.get(inv.supplier_id) ?? {
      total: 0,
      count: 0,
      last: null,
    };
    entry.total += inv.total_cents;
    entry.count += 1;
    if (!entry.last || inv.invoice_date > entry.last) {
      entry.last = inv.invoice_date;
    }
    statsMap.set(inv.supplier_id, entry);
  }

  return suppliers.map((row) => {
    const stats = statsMap.get(row.id);
    return {
      id: row.id,
      businessId: row.business_id,
      name: row.name,
      cuit: row.cuit,
      contact: row.contact,
      phone: row.phone,
      email: row.email,
      notes: row.notes,
      isActive: row.is_active,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      defaultExpenseConceptId: extra(row).default_expense_concept_id ?? null,
      paymentTermsDays: extra(row).payment_terms_days ?? 0,
      totalSpentCents: stats?.total ?? 0,
      invoiceCount: stats?.count ?? 0,
      lastInvoiceDate: stats?.last ?? null,
    };
  });
}

// ── Supplier invoices ───────────────────────────────────────────

export async function getSupplierInvoices(
  supplierId: string,
  businessId: string,
): Promise<SupplierInvoice[]> {
  const service = db();

  const invoices = await fetchAll(
    () =>
      service
        .from("supplier_invoices")
        .select("*")
        .eq("supplier_id", supplierId)
        .eq("business_id", businessId)
        .order("invoice_date", { ascending: false })
        .order("id"),
    "supplier_invoices",
  );

  if (!invoices.length) return [];

  const results: SupplierInvoice[] = [];
  for (const row of invoices) {
    let photoSignedUrl: string | null = null;
    if (row.photo_url) {
      const { data } = await service.storage
        .from("supplier-invoices")
        .createSignedUrl(row.photo_url, 3600);
      photoSignedUrl = data?.signedUrl ?? null;
    }

    results.push({
      id: row.id,
      businessId: row.business_id,
      supplierId: row.supplier_id,
      invoiceNumber: row.invoice_number,
      invoiceDate: row.invoice_date,
      totalCents: row.total_cents,
      photoUrl: row.photo_url,
      photoSignedUrl,
      notes: row.notes,
      createdBy: row.created_by,
      createdAt: row.created_at,
      documentType: extra(row).document_type ?? "interno",
      expenseConceptId: extra(row).expense_concept_id ?? null,
      dueDate: extra(row).due_date ?? null,
      cancelledAt: extra(row).cancelled_at ?? null,
      cancelledReason: extra(row).cancelled_reason ?? null,
    });
  }

  return results;
}

// ── Supplier stats by date range ────────────────────────────────

export async function getSupplierStats(
  businessId: string,
  from?: string,
  to?: string,
): Promise<SupplierStats[]> {
  const service = db();

  let query = service
    .from("supplier_invoices")
    .select("supplier_id, total_cents, invoice_date, suppliers!inner(name)")
    .eq("business_id", businessId)
    .is("cancelled_at", null);

  if (from) query = query.gte("invoice_date", from);
  if (to) query = query.lte("invoice_date", to);

  const data = unwrap(await query, "supplier_invoices");
  if (!data.length) return [];

  const map = new Map<
    string,
    { name: string; total: number; count: number; last: string | null }
  >();

  for (const row of data) {
    const supplierName =
      (row.suppliers as unknown as { name: string })?.name ?? "—";
    const entry = map.get(row.supplier_id) ?? {
      name: supplierName,
      total: 0,
      count: 0,
      last: null,
    };
    entry.total += row.total_cents;
    entry.count += 1;
    if (!entry.last || row.invoice_date > entry.last) {
      entry.last = row.invoice_date;
    }
    map.set(row.supplier_id, entry);
  }

  return Array.from(map.entries()).map(([id, v]) => ({
    supplierId: id,
    supplierName: v.name,
    totalSpentCents: v.total,
    invoiceCount: v.count,
    lastInvoiceDate: v.last,
  }));
}

// ── Supplier ↔ ingredients links ────────────────────────────────

export async function getSupplierIngredients(
  supplierId: string,
  businessId: string,
): Promise<SupplierIngredientLink[]> {
  const service = db();

  const data = unwrap(
    await service
      .from("supplier_ingredients")
      .select("supplier_id, ingredient_id, created_at, ingredients!inner(name, unit)")
      .eq("supplier_id", supplierId)
      .eq("business_id", businessId),
    "supplier_ingredients",
  );

  if (!data.length) return [];

  return data.map((row) => {
    const ingredient = row.ingredients as unknown as { name: string; unit: string };
    return {
      supplierId: row.supplier_id,
      ingredientId: row.ingredient_id,
      ingredientName: ingredient.name,
      ingredientUnit: ingredient.unit,
      createdAt: row.created_at,
    };
  });
}

// ── Supplier product outflow (proveedor ↔ salida) ─────────────

export async function getSupplierProductOutflow(
  businessId: string,
  startIso: string,
  endIso: string,
): Promise<SupplierOutflowItem[]> {
  const service = db();

  const [consumptions, links, suppliers] = await Promise.all([
    fetchAll(
      () =>
        service
          .from("ingredient_consumptions")
          .select("ingredient_id, cost_cents_snapshot")
          .eq("business_id", businessId)
          .eq("kind", "venta")
          .gte("created_at", startIso)
          .lt("created_at", endIso)
          .order("id"),
      "ingredient_consumptions",
    ),
    fetchAll(
      () =>
        service
          .from("supplier_ingredients")
          .select("supplier_id, ingredient_id")
          .eq("business_id", businessId)
          .order("ingredient_id"),
      "supplier_ingredients",
    ),
    fetchAll(
      () => service.from("suppliers").select("id, name").eq("business_id", businessId).order("id"),
      "suppliers",
    ),
  ]);

  if (!consumptions.length || !links.length) return [];

  const ingredientToSuppliers = new Map<string, Set<string>>();
  for (const link of links) {
    const set = ingredientToSuppliers.get(link.ingredient_id) ?? new Set();
    set.add(link.supplier_id);
    ingredientToSuppliers.set(link.ingredient_id, set);
  }

  const supplierNames = new Map<string, string>();
  for (const s of suppliers) supplierNames.set(s.id, s.name);

  const agg = new Map<string, { costCents: number; count: number }>();
  for (const c of consumptions) {
    const row = c as { ingredient_id: string; cost_cents_snapshot: number };
    const sids = ingredientToSuppliers.get(row.ingredient_id);
    if (!sids) continue;
    for (const sid of sids) {
      const entry = agg.get(sid) ?? { costCents: 0, count: 0 };
      entry.costCents += Math.abs(Number(row.cost_cents_snapshot) || 0);
      entry.count += 1;
      agg.set(sid, entry);
    }
  }

  return Array.from(agg.entries())
    .map(([supplierId, v]) => ({
      supplierId,
      supplierName: supplierNames.get(supplierId) ?? "—",
      totalCostCents: v.costCents,
      consumptionCount: v.count,
    }))
    .sort((a, b) => b.totalCostCents - a.totalCostCents);
}

// ── Ingredients for search (used by link dialog) ────────────────

export type IngredientOption = {
  id: string;
  name: string;
  unit: string;
  /**
   * spec 165 · la presentación default del insumo. Sin ella no se puede
   * convertir «2 bolsas» a «100 kg», que es lo que el renglón necesita para dar
   * de alta stock.
   */
  presentationId?: string | null;
  netQuantity?: number;
  costCents?: number;
};

export async function getIngredientsForLinking(
  businessId: string,
): Promise<IngredientOption[]> {
  const service = db();
  const filas = await fetchAll(
    () =>
      service
        .from("ingredients")
        .select(
          "id, name, unit, ingredient_presentations!left(id, net_quantity, cost_cents, is_default)",
        )
        .eq("business_id", businessId)
        .eq("is_active", true)
        .order("name")
        .order("id"),
    "ingredients",
  );

  return (filas as unknown as Array<{
    id: string;
    name: string;
    unit: string;
    ingredient_presentations?: Array<{
      id: string;
      net_quantity: number | string;
      cost_cents: number;
      is_default: boolean;
    }> | null;
  }>).map((f) => {
    // El embed viene como array; la default es la que importa, y si no hay
    // ninguna marcada se toma la primera antes que dejar el insumo sin envase.
    const pres =
      f.ingredient_presentations?.find((p) => p.is_default) ??
      f.ingredient_presentations?.[0];
    return {
      id: f.id,
      name: f.name,
      unit: f.unit,
      presentationId: pres?.id ?? null,
      netQuantity: pres ? Number(pres.net_quantity) : undefined,
      costCents: pres?.cost_cents,
    };
  });
}
