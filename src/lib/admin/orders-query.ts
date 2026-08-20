import "server-only";

import { createSupabaseServerClient } from "@/lib/supabase/server";

import type { OrderStatus } from "@/lib/orders/status";

export type AdminOrder = {
  id: string;
  /** Correlativo global del negocio: no se reinicia nunca, sirve para buscar
   *  un pedido en el historial. */
  order_number: number;
  /** Número del pedido DEL DÍA (`orders.daily_number`): arranca en 1 cada
   *  jornada y es el que sale impreso en la comanda. Es el que se muestra en
   *  la operación en vivo, para que coincida con el papel de cocina. */
  daily_number: number;
  created_at: string;
  customer_name: string;
  customer_phone: string;
  delivery_type: "delivery" | "pickup" | "dine_in";
  total_cents: number;
  status: OrderStatus;
  payment_method: string;
  payment_status: string;
  cancelled_reason: string | null;
  /** Pedido diferido (spec 31): instante de retiro futuro. Null = para ahora. */
  scheduled_at: string | null;
  /** Indicación del encargado para cocina («21:30», «junto con la mesa 5»).
   *  Es el «para cuándo» real del encargue telefónico: sale en la comanda como
   *  «ENTREGAR …» y el board la muestra en lugar del tiempo transcurrido. */
  kitchen_notes: string | null;
  items: { product_name: string; quantity: number }[];
};

export function startOfTodayUtc(tz: string): Date {
  // Midnight in the business timezone, converted to UTC for the query.
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const pick = (type: string) =>
    parts.find((p) => p.type === type)?.value ?? "00";
  const isoLocal = `${pick("year")}-${pick("month")}-${pick("day")}T00:00:00`;
  // Need to offset by the difference between the tz-local time and UTC.
  const nowInTz = new Date(
    `${pick("year")}-${pick("month")}-${pick("day")}T${pick("hour")}:${pick("minute")}:${pick("second")}Z`,
  );
  const offsetMs = nowInTz.getTime() - now.getTime();
  const localMidnight = new Date(`${isoLocal}Z`);
  return new Date(localMidnight.getTime() - offsetMs);
}

export async function getTodayOrders(
  businessId: string,
  timezone: string,
): Promise<AdminOrder[]> {
  const supabase = await createSupabaseServerClient();
  const since = startOfTodayUtc(timezone).toISOString();
  // Filtramos `dine_in` afuera: las orders de mesa viven en otra pantalla
  // (Salón). Aquí solo queremos delivery / pickup (canal online).
  //
  // Diferidos (spec 31): además de lo creado hoy, traemos lo agendado para hoy
  // en adelante (`scheduled_at >= hoy`) — así un pedido cargado ayer para hoy
  // entra a la operación, y la sección "Próximos" del board (client-side)
  // separa los que todavía no marcharon. Un agendado para dentro de 3 días
  // entra por `created_at` pero el board lo manda a Próximos, no al kanban.
  const { data } = await supabase
    .from("orders")
    .select(
      "id, order_number, daily_number, created_at, customer_name, customer_phone, delivery_type, total_cents, status, payment_method, payment_status, cancelled_reason, scheduled_at, kitchen_notes, order_items(product_name, quantity, is_combo_component)",
    )
    .eq("business_id", businessId)
    .neq("delivery_type", "dine_in")
    .or(`created_at.gte.${since},scheduled_at.gte.${since}`)
    .order("created_at", { ascending: false });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data ?? []).map((o: any) => ({
    id: o.id,
    order_number: o.order_number,
    daily_number: o.daily_number,
    created_at: o.created_at,
    customer_name: o.customer_name,
    customer_phone: o.customer_phone,
    delivery_type: o.delivery_type as "delivery" | "pickup" | "dine_in",
    total_cents: Number(o.total_cents),
    status: o.status as OrderStatus,
    payment_method: o.payment_method,
    payment_status: o.payment_status,
    cancelled_reason: o.cancelled_reason,
    scheduled_at: o.scheduled_at,
    kitchen_notes: o.kitchen_notes,
    items: (o.order_items ?? [])
      .filter((i: any) => !i.is_combo_component)
      .map((i: any) => ({
        product_name: i.product_name,
        quantity: i.quantity,
      })),
  }));
}

const ACTIVE_STATUSES = [
  "pending",
  "confirmed",
  "preparing",
  "ready",
  "on_the_way",
] as const;

export async function getPendingOrderCount(
  businessId: string,
  timezone: string,
): Promise<number> {
  const supabase = await createSupabaseServerClient();
  const since = startOfTodayUtc(timezone).toISOString();
  const { count } = await supabase
    .from("orders")
    .select("id", { count: "exact", head: true })
    .eq("business_id", businessId)
    // Excluimos dine_in: el badge cuenta pedidos online (mismo universo que
    // el board), no mesas — así el número inicial coincide con la realtime.
    .neq("delivery_type", "dine_in")
    .in("status", ACTIVE_STATUSES as unknown as string[])
    .gte("created_at", since);
  return count ?? 0;
}

// ─── Historial / list view (with filters + pagination) ───────────────────────

export type OrderListRange = "today" | "7d" | "30d" | "all";
export type OrderListPaymentStatus = "all" | "paid" | "pending" | "failed";
export type OrderListDeliveryType = "all" | "delivery" | "pickup";

export type OrderListFilters = {
  range?: OrderListRange;
  status?: OrderStatus | "all";
  deliveryType?: OrderListDeliveryType;
  paymentStatus?: OrderListPaymentStatus;
  search?: string;
  page?: number; // 1-based
  limit?: number;
};

export type OrderListResult = {
  orders: AdminOrder[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
};

function rangeStart(tz: string, range: OrderListRange): string | null {
  if (range === "all") return null;
  const today = startOfTodayUtc(tz);
  if (range === "today") return today.toISOString();
  const days = range === "7d" ? 7 : 30;
  const since = new Date(today.getTime() - (days - 1) * 24 * 60 * 60 * 1000);
  return since.toISOString();
}

export async function getOrdersList(
  businessId: string,
  timezone: string,
  filters: OrderListFilters = {},
): Promise<OrderListResult> {
  const supabase = await createSupabaseServerClient();

  const range: OrderListRange = filters.range ?? "today";
  const page = Math.max(1, filters.page ?? 1);
  const pageSize = Math.max(1, Math.min(100, filters.limit ?? 24));
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  let query = supabase
    .from("orders")
    .select(
      "id, order_number, daily_number, created_at, customer_name, customer_phone, delivery_type, total_cents, status, payment_method, payment_status, cancelled_reason, scheduled_at, kitchen_notes, order_items(product_name, quantity, is_combo_component)",
      { count: "exact" },
    )
    .eq("business_id", businessId);

  const since = rangeStart(timezone, range);
  if (since) query = query.gte("created_at", since);

  if (filters.status && filters.status !== "all") {
    query = query.eq("status", filters.status);
  }
  if (filters.deliveryType && filters.deliveryType !== "all") {
    query = query.eq("delivery_type", filters.deliveryType);
  }
  if (filters.paymentStatus && filters.paymentStatus !== "all") {
    query = query.eq("payment_status", filters.paymentStatus);
  }
  if (filters.search && filters.search.trim()) {
    const q = filters.search.trim();
    // Search across customer name and phone (OR). Numeric search also
    // matches order_number.
    const numeric = Number(q);
    if (Number.isFinite(numeric) && /^\d+$/.test(q)) {
      query = query.or(
        `customer_name.ilike.%${q}%,customer_phone.ilike.%${q}%,order_number.eq.${numeric}`,
      );
    } else {
      query = query.or(
        `customer_name.ilike.%${q}%,customer_phone.ilike.%${q}%`,
      );
    }
  }

  query = query.order("created_at", { ascending: false }).range(from, to);

  const { data, count } = await query;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const orders: AdminOrder[] = (data ?? []).map((o: any) => ({
    id: o.id,
    order_number: o.order_number,
    daily_number: o.daily_number,
    created_at: o.created_at,
    customer_name: o.customer_name,
    customer_phone: o.customer_phone,
    delivery_type: o.delivery_type as "delivery" | "pickup" | "dine_in",
    total_cents: Number(o.total_cents),
    status: o.status as OrderStatus,
    payment_method: o.payment_method,
    payment_status: o.payment_status,
    cancelled_reason: o.cancelled_reason,
    scheduled_at: o.scheduled_at,
    kitchen_notes: o.kitchen_notes,
    items: (o.order_items ?? [])
      .filter((i: any) => !i.is_combo_component)
      .map((i: any) => ({
        product_name: i.product_name,
        quantity: i.quantity,
      })),
  }));

  const total = count ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));

  return { orders, total, page, pageSize, pageCount };
}

export async function getOrderDetail(orderId: string) {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("orders")
    .select(
      `id, order_number, daily_number, created_at, updated_at,
       customer_name, customer_phone,
       delivery_type, delivery_address, delivery_notes,
       subtotal_cents, delivery_fee_cents, total_cents,
       status, cancelled_reason, payment_method, payment_status,
       order_items(id, product_name, quantity, unit_price_cents, subtotal_cents, notes,
         daily_menu_id, daily_menu_snapshot, is_combo_component, parent_order_item_id,
         order_item_modifiers(modifier_name, price_delta_cents)),
       order_status_history(status, notes, created_at)`,
    )
    .eq("id", orderId)
    .maybeSingle();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return data as any;
}
