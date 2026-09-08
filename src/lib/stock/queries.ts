import "server-only";

import { createSupabaseServiceClient } from "@/lib/supabase/service";

// ── Types ────────────────────────────────────────────────────────

export type StockOverviewItem = {
  stockItemId: string;
  productId: string;
  productName: string;
  categoryName: string | null;
  currentQty: number;
  minQty: number;
  unit: string;
  isLow: boolean;
  updatedAt: string;
};

export type StockMovimiento = {
  id: string;
  // Issue #270 · 'merma' es el kind nuevo de la baja manual del bar: hasta ahora
  // una botella rota y un conteo físico eran la misma fila 'ajuste'.
  kind: "ingreso" | "venta" | "ajuste" | "reversion" | "merma";
  qty: number;
  reason: string | null;
  createdByName: string | null;
  createdAt: string;
  orderItemId: string | null;
};

// ── getStockOverview ─────────────────────────────────────────────
// `scope` segmenta la vista: "bebidas" excluye productos marcados como stock
// de bar; "bar" devuelve sólo los de bar. Ambos comparten el mismo mapeo.

async function loadStockOverview(
  businessId: string,
  scope: "bebidas" | "bar",
): Promise<StockOverviewItem[]> {
  const service = createSupabaseServiceClient();

  const { data } = await service
    .from("stock_items")
    .select(
      "id, product_id, current_qty, min_qty, unit, updated_at, products(name, category_id, is_bar_stock, categories(name))",
    )
    .eq("business_id", businessId)
    .order("updated_at", { ascending: false });

  return (data ?? [])
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .filter((row: any) =>
      scope === "bar"
        ? row.products?.is_bar_stock === true
        : row.products?.is_bar_stock !== true,
    )
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .map((row: any) => ({
      stockItemId: row.id,
      productId: row.product_id,
      productName: row.products?.name ?? "—",
      categoryName: row.products?.categories?.name ?? null,
      currentQty: row.current_qty,
      minQty: row.min_qty,
      unit: row.unit,
      isLow: row.current_qty <= row.min_qty,
      updatedAt: row.updated_at,
    }));
}

export async function getStockOverview(
  businessId: string,
): Promise<StockOverviewItem[]> {
  return loadStockOverview(businessId, "bebidas");
}

// ── getBarStockOverview (stock de bar, spec 10) ──────────────────

export async function getBarStockOverview(
  businessId: string,
): Promise<StockOverviewItem[]> {
  return loadStockOverview(businessId, "bar");
}

// ── getStockMovimientos ──────────────────────────────────────────

export async function getStockMovimientos(
  stockItemId: string,
  page = 1,
  pageSize = 20,
): Promise<{ items: StockMovimiento[]; total: number }> {
  const service = createSupabaseServiceClient();
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  const { data, count } = await service
    .from("stock_movimientos")
    .select(
      "id, kind, qty, reason, created_by, created_at, order_item_id, users(email)",
      { count: "exact" },
    )
    .eq("stock_item_id", stockItemId)
    .order("created_at", { ascending: false })
    .range(from, to);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const items: StockMovimiento[] = (data ?? []).map((row: any) => ({
    id: row.id,
    kind: row.kind,
    qty: row.qty,
    reason: row.reason,
    createdByName: row.users?.email?.split("@")[0] ?? null,
    createdAt: row.created_at,
    orderItemId: row.order_item_id,
  }));

  return { items, total: count ?? 0 };
}

// ── getLowStockCount ─────────────────────────────────────────────

export async function getLowStockCount(
  businessId: string,
): Promise<number> {
  const service = createSupabaseServiceClient();

  const { data } = await service
    .from("stock_items")
    .select("id, current_qty, min_qty")
    .eq("business_id", businessId);

  return (data ?? []).filter(
    (row) => row.current_qty <= row.min_qty,
  ).length;
}

// ── getAllProductsForConfig ───────────────────────────────────────

export type ProductForStockConfig = {
  id: string;
  name: string;
  categoryName: string | null;
  trackStock: boolean;
  isBarStock: boolean;
  currentQty: number | null;
  minQty: number | null;
};

export async function getAllProductsForConfig(
  businessId: string,
): Promise<ProductForStockConfig[]> {
  const service = createSupabaseServiceClient();

  const { data: products } = await service
    .from("products")
    .select("id, name, track_stock, is_bar_stock, category_id, categories(name)")
    .eq("business_id", businessId)
    .eq("is_active", true)
    .order("name");

  const { data: stockItems } = await service
    .from("stock_items")
    .select("product_id, current_qty, min_qty")
    .eq("business_id", businessId);

  const stockMap = new Map<string, { current_qty: number; min_qty: number }>();
  for (const si of stockItems ?? []) {
    stockMap.set(si.product_id, { current_qty: si.current_qty, min_qty: si.min_qty });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (products ?? []).map((p: any) => {
    const stock = stockMap.get(p.id);
    return {
      id: p.id,
      name: p.name,
      categoryName: p.categories?.name ?? null,
      trackStock: p.track_stock,
      isBarStock: p.is_bar_stock ?? false,
      currentQty: stock?.current_qty ?? null,
      minQty: stock?.min_qty ?? null,
    };
  });
}

// ── getMermaDeBar (issue #270 · hallazgo 5) ──────────────────────
//
// La solapa «Merma» del catálogo lee sólo `ingredient_consumptions`, o sea
// insumos de cocina: el bar vive en otra tabla que ese reporte ni mira. Para
// enterarse de que se rompió una botella había que entrar producto por producto
// al sheet del historial. Esta lectura devuelve la merma de bar del período ya
// valorizada, para que el reporte tenga a quién preguntarle.

/** Cliente sin tipar para las columnas que `database.types.ts` todavía no conoce. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type LooseTable = { from: (t: string) => any };

export type MermaBarItem = {
  productId: string;
  productName: string;
  stockItemId: string;
  /** Unidades perdidas, en positivo. */
  qty: number;
  /** Lo que costaron, al costo de reposición del ítem. 0 si nadie lo cargó. */
  costCents: number;
  movimientos: number;
};

export async function getMermaDeBar(
  businessId: string,
  startIso: string,
  endIso: string,
): Promise<MermaBarItem[]> {
  const service = createSupabaseServiceClient();

  // Mismo escape hatch que el resto del back-office: `cost_cents_snapshot` es de
  // la 0086 y `database.types.ts` todavía no la conoce.
  const { data, error } = await (service as unknown as LooseTable)
    .from("stock_movimientos")
    .select("stock_item_id, qty, cost_cents_snapshot, stock_items(product_id, products(name))")
    .eq("business_id", businessId)
    .eq("kind", "merma")
    .gte("created_at", startIso)
    .lte("created_at", endIso);

  // Falla ruidosa antes que un $0 plausible: la merma en cero es exactamente lo
  // que este reporte viene a dejar de decir.
  if (error) throw new Error(`Falló la lectura (stock_movimientos): ${error.message}`);

  const map = new Map<string, MermaBarItem>();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const row of (data ?? []) as any[]) {
    const item = row.stock_items;
    const productId = item?.product_id ?? row.stock_item_id;
    const acc = map.get(productId) ?? {
      productId,
      productName: item?.products?.name ?? "—",
      stockItemId: row.stock_item_id,
      qty: 0,
      costCents: 0,
      movimientos: 0,
    };
    acc.qty += Math.abs(Number(row.qty) || 0);
    acc.costCents += Math.abs(Number(row.cost_cents_snapshot) || 0);
    acc.movimientos += 1;
    map.set(productId, acc);
  }

  return [...map.values()].sort((a, b) => b.costCents - a.costCents || b.qty - a.qty);
}
