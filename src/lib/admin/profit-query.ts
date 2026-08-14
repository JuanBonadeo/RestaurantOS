import "server-only";

import { createSupabaseServerClient } from "@/lib/supabase/server";

import { effectiveMargin } from "./effective-margin";
import { getCosteoOverview } from "@/lib/ingredients/queries";

// ── Rentabilidad agregada ─────────────────────────────────────────
//
// El food cost histórico ya está materializado: cada venta inserta una
// fila en `ingredient_consumptions` con `cost_cents_snapshot` (el costo
// congelado al momento de vender). Agregarlo es un SUM por período, no
// hace falta recalcular recetas retroactivamente.

export type ProfitMetrics = {
  netSalesCents: number; // venta de productos (subtotal de items no cancelados)
  foodCostCents: number; // costo de mercadería vendida (CMV)
  foodCostPct: number | null; // CMV / ventas
  grossMarginCents: number; // ventas - CMV
  grossMarginPct: number | null;
  mermaCents: number; // costo de insumos perdidos por merma
  hasCostData: boolean; // hay recetas cargadas → los números son confiables
};

export async function getProfitMetrics(
  businessId: string,
  startIso: string,
  endIso: string,
): Promise<ProfitMetrics> {
  const supabase = await createSupabaseServerClient();

  const [itemsRes, consumptionsRes] = await Promise.all([
    supabase
      .from("order_items")
      .select("subtotal_cents, orders!inner(business_id, created_at, status)")
      .eq("orders.business_id", businessId)
      .gte("orders.created_at", startIso)
      .lt("orders.created_at", endIso)
      .neq("orders.status", "cancelled")
      .neq("orders.lifecycle_status", "cancelled")
      // issue #190 — el ítem anulado tampoco es venta. Se filtraba la orden
      // cancelada pero no la línea anulada adentro de una orden viva, así que
      // cada plato que el encargado dio de baja seguía sumando al numerador
      // mientras su costo **sí** se restaba por la reversión de la 089: ventas
      // arriba, costo abajo, margen mejor que el real.
      .is("cancelled_at", null),
    supabase
      .from("ingredient_consumptions")
      .select("cost_cents_snapshot, kind")
      .eq("business_id", businessId)
      .gte("created_at", startIso)
      .lt("created_at", endIso)
      // spec 089 — `reversion` entra al conjunto. Antes se filtraba afuera y la
      // fila venía con `cost_cents_snapshot = 0` literal, así que el costo de una
      // orden cancelada se quedaba en el food cost mientras su venta **sí** se
      // excluía del numerador: el margen salía 4-5 puntos peor de lo real en
      // cualquier noche con anulaciones.
      .in("kind", ["venta", "merma", "reversion"]),
  ]);

  let netSalesCents = 0;
  for (const it of itemsRes.data ?? []) {
    netSalesCents += Number((it as { subtotal_cents: number }).subtotal_cents) || 0;
  }

  let foodCostCents = 0;
  let mermaCents = 0;
  for (const c of consumptionsRes.data ?? []) {
    const row = c as { cost_cents_snapshot: number; kind: string };
    const cost = Math.abs(Number(row.cost_cents_snapshot) || 0);
    if (row.kind === "venta") foodCostCents += cost;
    else if (row.kind === "merma") mermaCents += cost;
    // La reversión se guarda en positivo (magnitud del movimiento, igual que
    // 'venta'); el signo lo pone quien lee. Acá resta: el insumo volvió a la
    // heladera, no se consumió.
    else if (row.kind === "reversion") foodCostCents -= cost;
  }
  // Piso en cero: una reversión puede caer en el rango de fechas y su venta
  // quedar afuera (se cargó ayer, se anuló hoy). Sin el piso, el food cost del
  // día se iría a negativo y el margen daría más de 100%.
  foodCostCents = Math.max(0, foodCostCents);

  const hasCostData = foodCostCents > 0;
  const grossMarginCents = netSalesCents - foodCostCents;

  return {
    netSalesCents,
    foodCostCents,
    foodCostPct:
      netSalesCents > 0 && hasCostData
        ? (foodCostCents / netSalesCents) * 100
        : null,
    grossMarginCents,
    grossMarginPct:
      netSalesCents > 0 && hasCostData
        ? (grossMarginCents / netSalesCents) * 100
        : null,
    mermaCents,
    hasCostData,
  };
}

// ── Menu engineering (popularidad × rentabilidad) ─────────────────

export type MenuQuadrant = "estrella" | "vaca" | "puzzle" | "perro";

export type MenuEngineeringItem = {
  productId: string;
  productName: string;
  categoryName: string | null;
  unitsSold: number;
  marginPercent: number;
  marginCents: number;
  priceCents: number;
  revenueCents: number;
  quadrant: MenuQuadrant;
};

export type MenuEngineering = {
  items: MenuEngineeringItem[];
  avgUnits: number;
  avgMarginPct: number;
};

function classify(
  units: number,
  marginPct: number,
  avgUnits: number,
  avgMargin: number,
): MenuQuadrant {
  const popular = units >= avgUnits;
  const profitable = marginPct >= avgMargin;
  if (popular && profitable) return "estrella";
  if (popular && !profitable) return "vaca";
  if (!popular && profitable) return "puzzle";
  return "perro";
}

export async function getMenuEngineering(
  businessId: string,
  startIso: string,
  endIso: string,
): Promise<MenuEngineering> {
  const supabase = await createSupabaseServerClient();

  const [itemsRes, costeo] = await Promise.all([
    supabase
      .from("order_items")
      .select(
        "product_id, quantity, subtotal_cents, orders!inner(business_id, created_at, status)",
      )
      .eq("orders.business_id", businessId)
      .gte("orders.created_at", startIso)
      .lt("orders.created_at", endIso)
      .neq("orders.status", "cancelled")
      .neq("orders.lifecycle_status", "cancelled")
      // issue #190 — un plato anulado no se vendió: no cuenta ni en unidades ni
      // en facturado. Con él adentro, la ingeniería de menú mandaba al cuadrante
      // «estrella» productos que se dieron de baja.
      .is("cancelled_at", null),
    getCosteoOverview(businessId),
  ]);

  const soldByProduct = new Map<
    string,
    { units: number; revenueCents: number }
  >();
  for (const it of itemsRes.data ?? []) {
    const row = it as {
      product_id: string | null;
      quantity: number;
      subtotal_cents: number;
    };
    if (!row.product_id) continue;
    const existing = soldByProduct.get(row.product_id) ?? {
      units: 0,
      revenueCents: 0,
    };
    existing.units += Number(row.quantity) || 0;
    existing.revenueCents += Number(row.subtotal_cents) || 0;
    soldByProduct.set(row.product_id, existing);
  }

  // Solo productos con receta cargada (tienen margen real) y con ventas.
  //
  // El margen se calcula sobre lo EFECTIVAMENTE cobrado, no sobre
  // `products.price_cents` (spec 069): desde que el encargado puede pisar el
  // precio de una línea, el margen de catálogo y la facturación real pueden
  // divergir, y mezclarlos en la misma tarjeta manda un plato regalado al
  // cuadrante "estrella". `priceCents` sigue siendo el de la carta — es el
  // dato de referencia, no la base del margen.
  const base = costeo
    .filter((p) => p.hasRecipe && soldByProduct.has(p.productId))
    .map((p) => {
      const sold = soldByProduct.get(p.productId)!;
      const margin = effectiveMargin({
        revenueCents: sold.revenueCents,
        unitsSold: sold.units,
        foodCostCents: p.foodCostCents,
      });
      return {
        productId: p.productId,
        productName: p.productName,
        categoryName: p.categoryName,
        unitsSold: sold.units,
        marginPercent: margin.marginPercent,
        marginCents: margin.marginCents,
        priceCents: p.priceCents,
        revenueCents: sold.revenueCents,
      };
    });

  if (base.length === 0) {
    return { items: [], avgUnits: 0, avgMarginPct: 0 };
  }

  const avgUnits =
    base.reduce((s, p) => s + p.unitsSold, 0) / base.length;
  const avgMarginPct =
    base.reduce((s, p) => s + p.marginPercent, 0) / base.length;

  const items: MenuEngineeringItem[] = base
    .map((p) => ({
      ...p,
      quadrant: classify(p.unitsSold, p.marginPercent, avgUnits, avgMarginPct),
    }))
    .sort((a, b) => b.revenueCents - a.revenueCents);

  return { items, avgUnits, avgMarginPct };
}
