import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { getFloorPlansForBusiness } from "@/lib/admin/floor-plan/queries";
import type { FloorPlanWithTables } from "@/lib/admin/floor-plan/queries";
import { getMozosByBusiness } from "@/lib/mozo/queries";
import type { MozoMember } from "@/lib/mozo/queries";
// Los tipos viven en el cliente que los consume (mismo criterio que
// `SalonOrderRef` en `salon-desktop`). Import de tipo: se borra al compilar.
import type {
  OrderForMozo,
  ReservationForMozo,
} from "@/app/[business_slug]/mozo/mozo-client";

/**
 * Lo que el home del mozo ("Mis mesas" / "Salón") necesita del server.
 *
 * Vive acá y no en la page para que la page y el refetch del cliente corran
 * **exactamente** las mismas queries (spec 107) — el mismo criterio que
 * `loadSalon` + `getSalonTabData` en el operativo del encargado.
 */
export type MozoHomeData = {
  floorPlans: FloorPlanWithTables[];
  reservations: ReservationForMozo[];
  activeOrders: OrderForMozo[];
  mozos: MozoMember[];
};

type RawProduct = { prep_time_minutes: number | null };
type RawOrderItem = {
  product_name: string;
  quantity: number;
  cancelled_at: string | null;
  products: RawProduct | RawProduct[] | null;
};
type RawComandaItem = { order_items: RawOrderItem | RawOrderItem[] | null };
type RawComanda = {
  id: string;
  batch: number;
  status: "pendiente" | "en_preparacion" | "entregado";
  station_id: string | null;
  emitted_at: string;
  delivered_at: string | null;
  cancelled_at: string | null;
  stations: { name: string } | { name: string }[] | null;
  comanda_items: RawComandaItem[];
};

/**
 * Aplana los joins anidados de PostgREST a la forma que consume el cliente.
 *
 * Vivía inline en la page (spec 107 lo movió acá): si el refetch devolviera las
 * filas crudas y la page las mapeadas, el home se rompería en cuanto se
 * re-sincronizara. Una sola forma, un solo lugar.
 */
function mapActiveOrders(rows: unknown[]): OrderForMozo[] {
  return rows.map((raw) => {
    const o = raw as Record<string, unknown>;
    const rawComandas = (o as { comandas?: RawComanda[] }).comandas ?? [];
    return {
      id: o.id as string,
      order_number: o.order_number as number,
      daily_number: o.daily_number as number,
      table_id: o.table_id as string | null,
      delivery_type: o.delivery_type as string,
      total_cents: Number(o.total_cents),
      created_at: o.created_at as string,
      status: o.status as string,
      customer_name: (o as { customer_name: string | null }).customer_name,
      items:
        (
          o as {
            order_items?: Array<{
              product_name: string;
              quantity: number;
              cancelled_at: string | null;
            }>;
          }
        ).order_items ?? [],
      comandas: rawComandas.map((c) => {
        const station = Array.isArray(c.stations) ? c.stations[0] : c.stations;
        const items = (c.comanda_items ?? [])
          .map((ci) =>
            Array.isArray(ci.order_items) ? ci.order_items[0] : ci.order_items,
          )
          .filter(
            (oi): oi is RawOrderItem => oi != null && oi.cancelled_at === null,
          )
          .map((oi) => {
            const product = Array.isArray(oi.products)
              ? oi.products[0]
              : oi.products;
            return {
              product_name: oi.product_name,
              quantity: oi.quantity,
              prep_time_minutes: product?.prep_time_minutes ?? null,
            };
          });
        return {
          id: c.id,
          batch: c.batch,
          status: c.status,
          station_name: station?.name ?? "—",
          emitted_at: c.emitted_at,
          delivered_at: c.delivered_at,
          cancelled_at: c.cancelled_at,
          items,
        };
      }),
    } as OrderForMozo;
  });
}

export async function loadMozoHome(
  businessId: string,
  service: SupabaseClient,
): Promise<MozoHomeData> {
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const tomorrowStart = new Date(todayStart);
  tomorrowStart.setDate(tomorrowStart.getDate() + 1);

  const [floorPlans, reservationsRes, activeOrdersRes, mozos] =
    await Promise.all([
      getFloorPlansForBusiness(businessId),

      // Reservas confirmadas de hoy.
      service
        .from("reservations")
        .select(
          "id, table_id, customer_name, customer_phone, party_size, starts_at, status, notes",
        )
        .eq("business_id", businessId)
        .in("status", ["confirmed", "seated"])
        .gte("starts_at", todayStart.toISOString())
        .lt("starts_at", tomorrowStart.toISOString())
        .order("starts_at", { ascending: true }),

      // Órdenes dine_in **abiertas** (la "open" actual de cada mesa). Una por
      // mesa garantizada por el partial unique `orders_one_open_per_table`.
      // Traemos customer_name + items + comandas con su estado para alimentar
      // card y drawer (resumen del pedido + tracking de cocina).
      service
        .from("orders")
        .select(
          "id, order_number, daily_number, table_id, delivery_type, total_cents, created_at, status, customer_name, order_items(product_name, quantity, cancelled_at), comandas(id, batch, status, station_id, emitted_at, delivered_at, cancelled_at, stations(name), comanda_items(order_items(product_name, quantity, cancelled_at, products(prep_time_minutes))))",
        )
        .eq("business_id", businessId)
        .eq("delivery_type", "dine_in")
        .eq("lifecycle_status", "open"),

      getMozosByBusiness(businessId),
    ]);

  return {
    floorPlans,
    reservations: (reservationsRes.data ?? []) as ReservationForMozo[],
    activeOrders: mapActiveOrders(activeOrdersRes.data ?? []),
    mozos,
  };
}
