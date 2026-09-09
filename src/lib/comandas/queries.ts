import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { createSupabaseServiceClient } from "@/lib/supabase/service";

import type {
  Comanda,
  ComandaConItems,
  ComandaItemSnapshot,
  ComandaStatus,
  KitchenItemStatus,
  Station,
} from "./types";

type GenericClient = SupabaseClient;

type RawOrderItem = {
  id: string;
  product_id: string | null;
  product_name: string;
  quantity: number;
  notes: string | null;
  station_id: string | null;
  unit_price_cents: number;
  subtotal_cents: number;
  price_original_cents: number | null;
  price_override_reason: string | null;
  daily_menu_id: string | null;
  seat_number: number | null;
  kitchen_status: KitchenItemStatus;
  cancelled_at: string | null;
  cancelled_reason: string | null;
  order_item_modifiers: { modifier_name: string }[] | null;
};

function toItemSnapshot(row: RawOrderItem): ComandaItemSnapshot {
  return {
    order_item_id: row.id,
    product_id: row.product_id,
    product_name: row.product_name,
    quantity: row.quantity,
    notes: row.notes,
    modifiers: row.order_item_modifiers ?? [],
    station_id: row.station_id,
    unit_price_cents: row.unit_price_cents,
    subtotal_cents: row.subtotal_cents,
    price_original_cents: row.price_original_cents,
    price_override_reason: row.price_override_reason,
    daily_menu_id: row.daily_menu_id,
    seat_number: row.seat_number,
    kitchen_status: row.kitchen_status,
    cancelled_at: row.cancelled_at,
    cancelled_reason: row.cancelled_reason,
  };
}

export async function getStationsByBusiness(
  businessId: string,
): Promise<Station[]> {
  const service = createSupabaseServiceClient() as unknown as GenericClient;
  const { data, error } = await service
    .from("stations")
    .select("id, business_id, name, sort_order, is_active, created_at")
    .eq("business_id", businessId)
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });
  if (error) {
    console.error("getStationsByBusiness", error);
    return [];
  }
  return (data ?? []) as Station[];
}

/**
 * Devuelve la única orden con `lifecycle_status='open'` de la mesa, o null.
 * El partial unique index `orders_one_open_per_table` garantiza la unicidad.
 *
 * Cross-tenant: filtra por `business_id` además del `table_id`.
 */
export async function getActiveOrderByTable(
  tableId: string,
  businessId: string,
): Promise<{ id: string; mozo_id: string | null } | null> {
  const service = createSupabaseServiceClient() as unknown as GenericClient;
  const { data, error } = await service
    .from("orders")
    .select("id, mozo_id, business_id, table_id, lifecycle_status")
    .eq("table_id", tableId)
    .eq("business_id", businessId)
    .eq("lifecycle_status", "open")
    .maybeSingle();
  if (error) {
    console.error("getActiveOrderByTable", error);
    return null;
  }
  if (!data) return null;
  return { id: data.id as string, mozo_id: (data.mozo_id ?? null) as string | null };
}

/**
 * Comandas activas de un sector con sus items propios + "combina con".
 *
 * "Combina con" se calcula joinando `order_items` de la misma `order_id` +
 * mismo `batch` que apuntan a otro `station_id`. No se persiste — siempre
 * fresco (D-CU00-6).
 *
 * Cross-tenant: valida que la station pertenezca al business antes de leer
 * comandas. Sin esta validación, alguien con un `stationId` foráneo + slug
 * propio podría leer comandas de otro negocio.
 */
export async function getComandasBySector(
  stationId: string,
  businessId: string,
  opts: { onlyActive?: boolean } = {},
): Promise<ComandaConItems[]> {
  const service = createSupabaseServiceClient() as unknown as GenericClient;

  const { data: station } = await service
    .from("stations")
    .select("id, business_id")
    .eq("id", stationId)
    .maybeSingle();
  if (
    !station ||
    (station as { business_id: string } | null)?.business_id !== businessId
  ) {
    return [];
  }

  const baseSelect = `
    id, order_id, station_id, batch, status, emitted_at, delivered_at,
    comanda_items (
      order_item_id,
      order_items (
        id, product_id, product_name, quantity, notes, station_id,
        unit_price_cents, subtotal_cents, seat_number,
        price_original_cents, price_override_reason, daily_menu_id,
        kitchen_status, cancelled_at, cancelled_reason,
        order_item_modifiers ( modifier_name )
      )
    ),
    orders!inner ( id, business_id, table_id, lifecycle_status )
  `;

  let query = service
    .from("comandas")
    .select(baseSelect)
    .eq("station_id", stationId)
    .eq("orders.business_id", businessId);

  if (opts.onlyActive ?? true) {
    query = query.in("status", ["pendiente", "en_preparacion"]);
  }

  const { data, error } = await query.order("emitted_at", { ascending: true });
  if (error) {
    console.error("getComandasBySector", error);
    return [];
  }

  type RawComanda = {
    id: string;
    order_id: string;
    station_id: string;
    batch: number;
    status: ComandaStatus;
    emitted_at: string;
    delivered_at: string | null;
    comanda_items: { order_item_id: string; order_items: RawOrderItem | null }[] | null;
  };

  const comandas = (data ?? []) as unknown as RawComanda[];

  // "Combina con": resolvemos en una segunda query agrupada por (order_id, batch).
  const orderBatchKeys = comandas.map((c) => ({ order_id: c.order_id, batch: c.batch }));
  const combinaMap = await loadCombinaCon(service, orderBatchKeys, stationId);

  return comandas.map((c) => ({
    id: c.id,
    order_id: c.order_id,
    station_id: c.station_id,
    batch: c.batch,
    status: c.status,
    emitted_at: c.emitted_at,
    delivered_at: c.delivered_at,
    items: (c.comanda_items ?? [])
      .map((ci) => ci.order_items)
      .filter((it): it is RawOrderItem => Boolean(it))
      .map(toItemSnapshot),
    combina_con: combinaMap.get(`${c.order_id}:${c.batch}`) ?? [],
  }));
}

async function loadCombinaCon(
  service: GenericClient,
  keys: { order_id: string; batch: number }[],
  excludeStationId: string,
): Promise<Map<string, ComandaItemSnapshot[]>> {
  if (keys.length === 0) return new Map();

  const orderIds = [...new Set(keys.map((k) => k.order_id))];

  const { data, error } = await service
    .from("comandas")
    .select(`
      order_id, batch, station_id,
      comanda_items (
        order_items (
          id, product_id, product_name, quantity, notes, station_id,
          unit_price_cents, subtotal_cents, seat_number,
          price_original_cents, price_override_reason, daily_menu_id,
          kitchen_status, cancelled_at, cancelled_reason,
          order_item_modifiers ( modifier_name )
        )
      )
    `)
    .in("order_id", orderIds)
    .neq("station_id", excludeStationId);

  if (error) {
    console.error("loadCombinaCon", error);
    return new Map();
  }

  const wantedKeys = new Set(keys.map((k) => `${k.order_id}:${k.batch}`));
  type RawSibling = {
    order_id: string;
    batch: number;
    station_id: string;
    comanda_items: { order_items: RawOrderItem | null }[] | null;
  };
  const result = new Map<string, ComandaItemSnapshot[]>();

  for (const row of (data ?? []) as unknown as RawSibling[]) {
    const key = `${row.order_id}:${row.batch}`;
    if (!wantedKeys.has(key)) continue;
    const bucket = result.get(key) ?? [];
    for (const ci of row.comanda_items ?? []) {
      if (ci.order_items) bucket.push(toItemSnapshot(ci.order_items));
    }
    result.set(key, bucket);
  }
  return result;
}

/**
 * Comandas de una orden específica (vista de mozo / admin).
 *
 * Cross-tenant: filtra orders.business_id antes de devolver.
 */
export async function getComandasByOrder(
  orderId: string,
  businessId: string,
): Promise<ComandaConItems[]> {
  const service = createSupabaseServiceClient() as unknown as GenericClient;

  const { data: order } = await service
    .from("orders")
    .select("id, business_id")
    .eq("id", orderId)
    .maybeSingle();
  if (
    !order ||
    (order as { business_id: string } | null)?.business_id !== businessId
  ) {
    return [];
  }

  const { data, error } = await service
    .from("comandas")
    .select(`
      id, order_id, station_id, batch, status, emitted_at, delivered_at, cancelled_at,
      comanda_items (
        order_items (
          id, product_id, product_name, quantity, notes, station_id,
          unit_price_cents, subtotal_cents, seat_number,
          price_original_cents, price_override_reason, daily_menu_id,
          kitchen_status, cancelled_at, cancelled_reason,
          order_item_modifiers ( modifier_name )
        )
      )
    `)
    .eq("order_id", orderId)
    .order("batch", { ascending: true })
    .order("emitted_at", { ascending: true });

  if (error) {
    console.error("getComandasByOrder", error);
    return [];
  }

  type RawComanda = {
    id: string;
    order_id: string;
    station_id: string;
    batch: number;
    status: ComandaStatus;
    emitted_at: string;
    delivered_at: string | null;
    comanda_items: { order_items: RawOrderItem | null }[] | null;
  };

  const comandas = (data ?? []) as unknown as RawComanda[];

  // Para cada comanda, "combina con" son los items de la misma order+batch
  // que van a otro station. Como ya cargamos todas las comandas de la order
  // arriba, lo computamos en memoria sin segunda query.
  return comandas.map((c) => {
    const own = (c.comanda_items ?? [])
      .map((ci) => ci.order_items)
      .filter((it): it is RawOrderItem => Boolean(it))
      .map(toItemSnapshot);

    const combina = comandas
      .filter((other) => other.batch === c.batch && other.station_id !== c.station_id)
      .flatMap((other) =>
        (other.comanda_items ?? [])
          .map((ci) => ci.order_items)
          .filter((it): it is RawOrderItem => Boolean(it))
          .map(toItemSnapshot),
      );

    return {
      id: c.id,
      order_id: c.order_id,
      station_id: c.station_id,
      batch: c.batch,
      status: c.status,
      emitted_at: c.emitted_at,
      delivered_at: c.delivered_at,
      items: own,
      combina_con: combina,
    };
  });
}

export type { Comanda, ComandaConItems, Station };
