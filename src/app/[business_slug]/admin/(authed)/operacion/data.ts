import type { SupabaseClient } from "@supabase/supabase-js";

import type {
  SalonOrderRef,
  SalonReservationRef,
} from "@/components/admin/local/salon-desktop";
import type { AdminRow } from "@/components/reservations/admin-day-list";
import { getFloorPlansForBusiness } from "@/lib/admin/floor-plan/queries";
import type { FloorPlanWithTables } from "@/lib/admin/floor-plan/queries";
import {
  getActiveComandas,
  getPrintAgentHealth,
  getStationsForLocal,
} from "@/lib/admin/local-query";
import type { LocalComanda, LocalStation } from "@/lib/admin/local-query";
import { getTodayOrders } from "@/lib/admin/orders-query";
import type { AdminOrder } from "@/lib/admin/orders-query";
import {
  getCajasConEstado,
  getCajaUserAssignments,
  getRendicionesHistorial,
  getRendicionesPendientesTodosLosMozos,
} from "@/lib/caja/queries";
import type {
  CajaConEstado,
  CajaUserAssignment,
  MozoRendicion,
  RendicionMozoPendiente,
} from "@/lib/caja/types";
import { getMozosByBusiness } from "@/lib/mozo/queries";
import type { MozoMember } from "@/lib/mozo/queries";
import { orderSlotsForDay } from "@/lib/orders/scheduled";
import {
  getReservationServices,
  getReservationSettings,
} from "@/lib/reservations/queries";
import type { FloorTable } from "@/lib/reservations/types";
import { getCurrentPresent } from "@/lib/rrhh/clock-actions";
import type { PresentEmployee } from "@/lib/rrhh/clock-actions";
import { getTodaySummary } from "@/lib/rrhh/clock-queries";
import type { TodaySummary } from "@/lib/rrhh/clock-queries";

/**
 * Loaders de `/admin/operacion` agrupados por tab (spec 39, F2).
 *
 * Cada loader devuelve una promesa **independiente** con exactamente los datos
 * de su tab; la page los crea sin `await` y los pasa a `LocalShell`, que los
 * lee con `use()` dentro de un `<Suspense>` por tab. Así Salón pinta apenas
 * resuelven sus 4 queries, sin quedar bloqueado por la query más lenta de las
 * otras tabs (antes: un `Promise.all` de 15).
 *
 * Invariante multi-tenant (FR-010): toda query conserva su `business_id`; los
 * loaders corren server-side y sólo el dato ya scopeado cruza al cliente.
 */

export type SalonData = {
  floorPlans: FloorPlanWithTables[];
  dineInOrders: SalonOrderRef[];
  reservations: SalonReservationRef[];
  mozos: MozoMember[];
};

export type ComandasData = {
  initialComandas: LocalComanda[];
  stations: LocalStation[];
  // `mozos` lo necesita ComandasKanban; se recarga acá (query barata) en vez de
  // acoplar la tab Comandas a la promesa pesada de Salón (dine-in + transform).
  mozos: MozoMember[];
  printAgentLastSeenAt: string | null;
};

/**
 * Tab Pedidos. Además del board, lleva lo que necesita «Cargar pedido» para
 * **programar** (spec 085): los horarios que el negocio ofrece hoy —los mismos
 * chips que ve el cliente al programar (spec 064)— y el lead de marcha por
 * tipo, para que la UI diga cuánto antes va a salir la comanda con el número
 * real del negocio y no con un 40 escrito a mano.
 */
export type PedidosData = {
  initialOrders: AdminOrder[];
  scheduledSlots: string[];
  marchLeadPickupMin: number;
  marchLeadDeliveryMin: number;
};

export type CajaData = { cajas: CajaConEstado[] };

export type RendicionData = {
  rendicionPendientes: RendicionMozoPendiente[];
  rendicionHistorial: (MozoRendicion & {
    mozo_name: string;
    registered_by_name: string | null;
  })[];
  cajaAssignments: (CajaUserAssignment & {
    user_name: string | null;
    caja_name: string;
  })[];
  businessMembers: { user_id: string; full_name: string | null }[];
};

export type FichajeData = {
  initialPresent: PresentEmployee[];
  todaySummary?: TodaySummary;
};

/**
 * Libro de reservas del día elegido (`?date=`, default hoy en la TZ del negocio).
 * Es el MISMO dato que sirve `/admin/reservas`: la tab reusa `AdminDayList`.
 */
export type ReservasData = {
  date: string;
  rows: AdminRow[];
  floorPlans: Array<{ id: string; name: string }>;
  activeTables: FloorTable[];
};

// ─────────────────────────────────────────────────────────────────────────────
// Salón (default): plano + órdenes dine-in + reservas de hoy + mozos.
// ─────────────────────────────────────────────────────────────────────────────

/** Aplana la fila cruda de `orders` (con comandas anidadas) a `SalonOrderRef`. */
function mapDineInOrders(rows: unknown[]): SalonOrderRef[] {
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

  return rows.map((raw) => {
    const o = raw as Record<string, unknown>;
    const rawComandas = (o as { comandas?: RawComanda[] }).comandas ?? [];
    return {
      id: o.id as string,
      order_number: o.order_number as number,
      table_id: o.table_id as string | null,
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
    } as SalonOrderRef;
  });
}

export async function loadSalon(
  businessId: string,
  service: SupabaseClient,
  window: { todayStart: Date; tomorrowStart: Date },
): Promise<SalonData> {
  const [floorPlans, dineInRes, reservationsRes, mozos] = await Promise.all([
    getFloorPlansForBusiness(businessId),
    service
      .from("orders")
      .select(
        "id, order_number, table_id, total_cents, created_at, status, customer_name, order_items(product_name, quantity, cancelled_at), comandas(id, batch, status, station_id, emitted_at, delivered_at, cancelled_at, stations(name), comanda_items(order_items(product_name, quantity, cancelled_at, products(prep_time_minutes))))",
      )
      .eq("business_id", businessId)
      .eq("delivery_type", "dine_in")
      .eq("lifecycle_status", "open"),
    service
      .from("reservations")
      .select(
        "id, table_id, customer_name, customer_phone, party_size, starts_at, status, notes",
      )
      .eq("business_id", businessId)
      .in("status", ["confirmed", "seated"])
      .gte("starts_at", window.todayStart.toISOString())
      .lt("starts_at", window.tomorrowStart.toISOString())
      .order("starts_at", { ascending: true }),
    getMozosByBusiness(businessId),
  ]);

  return {
    floorPlans,
    dineInOrders: mapDineInOrders(dineInRes.data ?? []),
    reservations: (reservationsRes.data ?? []) as SalonReservationRef[],
    mozos,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Resto de las tabs.
// ─────────────────────────────────────────────────────────────────────────────

export async function loadComandas(
  businessId: string,
): Promise<ComandasData> {
  const [initialComandas, stations, mozos, printAgentHealth] =
    await Promise.all([
      getActiveComandas(businessId),
      getStationsForLocal(businessId),
      getMozosByBusiness(businessId),
      getPrintAgentHealth(businessId),
    ]);
  return {
    initialComandas,
    stations,
    mozos,
    printAgentLastSeenAt: printAgentHealth.lastSeenAt,
  };
}

export async function loadPedidos(
  businessId: string,
  timezone: string,
  marchLead: { pickupMin: number; deliveryMin: number },
): Promise<PedidosData> {
  const [initialOrders, reservationSettings, reservationServices] =
    await Promise.all([
      getTodayOrders(businessId, timezone),
      getReservationSettings(businessId),
      getReservationServices(businessId),
    ]);

  // Los horarios se resuelven acá (server) con "hoy" en la TZ del local, igual
  // que en el checkout: el chip que ve el encargado no puede depender del reloj
  // ni de la zona del navegador. El filtro por anticipación mínima corre en el
  // cliente, que es donde el tiempo sigue pasando mientras el sheet está
  // abierto.
  const scheduledSlots = orderSlotsForDay(
    {
      mode: reservationSettings.mode ?? null,
      schedule: reservationSettings.schedule,
      services: reservationServices,
    },
    new Date(),
    timezone,
  );

  return {
    initialOrders,
    scheduledSlots,
    marchLeadPickupMin: marchLead.pickupMin,
    marchLeadDeliveryMin: marchLead.deliveryMin,
  };
}

export async function loadCaja(businessId: string): Promise<CajaData> {
  return { cajas: await getCajasConEstado(businessId) };
}

export async function loadRendicion(
  businessId: string,
  service: SupabaseClient,
): Promise<RendicionData> {
  const [
    rendicionPendientes,
    rendicionHistorial,
    cajaAssignments,
    membersRes,
  ] = await Promise.all([
    getRendicionesPendientesTodosLosMozos(businessId),
    getRendicionesHistorial(businessId),
    getCajaUserAssignments(businessId),
    service
      .from("business_users")
      .select("user_id, full_name")
      .eq("business_id", businessId)
      .is("disabled_at", null),
  ]);
  return {
    rendicionPendientes,
    rendicionHistorial,
    cajaAssignments,
    businessMembers: (membersRes.data ?? []) as {
      user_id: string;
      full_name: string | null;
    }[],
  };
}

export async function loadReservas(
  businessId: string,
  service: SupabaseClient,
  window: { date: string; dayStart: Date; dayEnd: Date },
): Promise<ReservasData> {
  const [rowsRes, fpRes] = await Promise.all([
    service
      .from("reservations")
      .select("*, tables(label, floor_plans(id, name))")
      .eq("business_id", businessId)
      .gte("starts_at", window.dayStart.toISOString())
      .lt("starts_at", window.dayEnd.toISOString())
      .order("starts_at", { ascending: true }),
    service
      .from("floor_plans")
      .select("id, name")
      .eq("business_id", businessId)
      .order("created_at", { ascending: true }),
  ]);

  const floorPlans = (fpRes.data ?? []) as Array<{ id: string; name: string }>;

  // Mesas activas: sólo para el modal "Nueva reserva". Sin salones no hay mesas
  // que buscar (y el `.in()` con lista vacía sería una query al vacío).
  let activeTables: FloorTable[] = [];
  if (floorPlans.length > 0) {
    const { data } = await service
      .from("tables")
      .select("*")
      .in(
        "floor_plan_id",
        floorPlans.map((fp) => fp.id),
      )
      .eq("status", "active");
    activeTables = (data ?? []) as FloorTable[];
  }

  return {
    date: window.date,
    rows: (rowsRes.data ?? []) as AdminRow[],
    floorPlans,
    activeTables,
  };
}

export async function loadFichaje(
  businessId: string,
  businessSlug: string,
): Promise<FichajeData> {
  const [initialPresent, todaySummary] = await Promise.all([
    getCurrentPresent(businessSlug),
    getTodaySummary(businessId),
  ]);
  return { initialPresent, todaySummary };
}
