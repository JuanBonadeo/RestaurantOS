import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { actionError, actionOk, type ActionResult } from "@/lib/actions";
import { createComandasForItems } from "@/lib/comandas/route-items";
import { resolveStation } from "@/lib/comandas/routing";
import { emitControlTicket } from "@/lib/print/control-ticket-emit";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

type GenericClient = SupabaseClient;

export type RouteOrderResult = {
  order_id: string;
  comanda_ids: string[];
  items_without_station: number;
};

/**
 * Rutea items por sector, crea comandas y avanza el pedido a `preparing`.
 * Sin auth — usado tanto por auto-march como por el fallback manual.
 * Idempotente: si ya tiene comandas, no-op.
 */
export async function routeOrderToCocina(
  orderId: string,
  businessId: string,
): Promise<ActionResult<RouteOrderResult>> {
  const service = createSupabaseServiceClient() as unknown as GenericClient;

  // Idempotencia: si ya tiene comandas, alguien confirmó/auto-marchó antes.
  const { count: existingComandas } = await service
    .from("comandas")
    .select("id", { count: "exact", head: true })
    .eq("order_id", orderId);
  if ((existingComandas ?? 0) > 0) {
    return actionOk({
      order_id: orderId,
      comanda_ids: [],
      items_without_station: 0,
    });
  }

  const { data: items } = await service
    .from("order_items")
    .select("id, product_id")
    .eq("order_id", orderId)
    .is("cancelled_at", null);
  type ItemRow = { id: string; product_id: string | null };
  const itemRows = (items ?? []) as ItemRow[];
  if (itemRows.length === 0) {
    return actionError("El pedido no tiene items.");
  }

  const productIds = [
    ...new Set(itemRows.map((i) => i.product_id).filter((id): id is string => !!id)),
  ];
  type ProductRow = {
    id: string;
    station_id: string | null;
    category: { station_id: string | null } | null;
  };
  let productById = new Map<string, ProductRow>();
  if (productIds.length > 0) {
    const { data: productRows } = await service
      .from("products")
      .select("id, station_id, category:categories(station_id)")
      .in("id", productIds);
    productById = new Map(
      ((productRows ?? []) as unknown as ProductRow[]).map((p) => [p.id, p]),
    );
  }

  const itemsByStation = new Map<string, string[]>();
  let withoutStation = 0;

  for (const item of itemRows) {
    const product = item.product_id ? productById.get(item.product_id) : null;
    const stationId = product
      ? resolveStation(
          { station_id: product.station_id, category: product.category },
          null,
        )
      : null;

    const { error: updErr } = await service
      .from("order_items")
      .update({
        station_id: stationId,
        kitchen_status: "pending",
      })
      .eq("id", item.id);
    if (updErr) {
      console.error("routeOrderToCocina · order_item update", updErr);
      return actionError("No pudimos rutear los items.");
    }

    if (stationId) {
      const bucket = itemsByStation.get(stationId) ?? [];
      bucket.push(item.id);
      itemsByStation.set(stationId, bucket);
    } else {
      withoutStation += 1;
    }
  }

  const route = await createComandasForItems(service, orderId, itemsByStation);
  if (!route.ok) return actionError(route.error);

  const { error: orderErr } = await service
    .from("orders")
    .update({ status: "preparing" })
    .eq("id", orderId);
  if (orderErr) {
    console.error("routeOrderToCocina · order update", orderErr);
    return actionError("No pudimos avanzar el pedido.");
  }

  // Control de pedido (spec 063): el papel del repartidor sale junto con las
  // comandas de cocina. Best-effort a propósito — si falla, la comida entra a
  // cocina igual. Perder el control es un papel menos; abortar la marcha por
  // eso sería dejar el pedido sin cocinar.
  try {
    await emitControlTicket(service, orderId, businessId);
  } catch (e) {
    console.error("routeOrderToCocina · emitControlTicket", orderId, e);
  }

  return actionOk({
    order_id: orderId,
    comanda_ids: route.comanda_ids,
    items_without_station: withoutStation,
  });
}
