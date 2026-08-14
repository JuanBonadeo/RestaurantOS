import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { formatInTimeZone, toZonedTime } from "date-fns-tz";

import { isOrderDead } from "@/lib/orders/predicates";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type GenericClient = SupabaseClient;

export const REPORT_RANGES = ["today", "yesterday", "7d", "30d"] as const;
export type ReportRange = (typeof REPORT_RANGES)[number];

export type CustomDateRange = { start: string; end: string };
export type ReportRangeInput = ReportRange | CustomDateRange;

export type ReportSummary = {
  range: ReportRange | "custom";
  startIso: string;
  endIso: string;
  orderCount: number;
  revenueCents: number;
  averageTicketCents: number;
  deliveryCount: number;
  pickupCount: number;
  dineInCount: number;
  cancelledCount: number;
};

export type DayBucket = {
  date: string;
  orderCount: number;
  revenueCents: number;
};

export type TopProduct = {
  product_name: string;
  quantity: number;
  revenueCents: number;
};

export type CategoryBreakdown = {
  categoryId: string | null;
  categoryName: string;
  productCount: number;
  quantity: number;
  revenueCents: number;
};

export type CustomerStats = {
  uniqueCount: number;
  newCount: number;
  returningCount: number;
  weekly: { weekStart: string; newCount: number; returningCount: number }[];
  topCustomers: {
    customerId: string;
    name: string;
    phone: string;
    orderCount: number;
    revenueCents: number;
    lastOrderAt: string;
  }[];
};

export type ReservationFunnel = {
  total: number;
  confirmed: number;
  seated: number;
  completed: number;
  noShow: number;
  cancelled: number;
  attendanceRate: number;
  /** Reservas por canal de origen (spec 22). Las anteriores a la migración
   *  caen como 'web'. */
  byChannel: { web: number; admin: number; chatbot: number };
  weekly: {
    weekStart: string;
    completed: number;
    noShow: number;
    cancelled: number;
  }[];
};

export type PrepTimeStats = {
  sampleSize: number;
  averageMinutes: number;
  medianMinutes: number;
  buckets: { label: string; count: number }[];
  daily: { date: string; averageMinutes: number; sampleSize: number }[];
};

export type ComparisonDelta = {
  current: number;
  previous: number;
  pct: number | null;
};

export type ReportComparison = {
  orderCount: ComparisonDelta;
  revenueCents: ComparisonDelta;
  averageTicketCents: ComparisonDelta;
  cancelledCount: ComparisonDelta;
};

export type ReportData = {
  summary: ReportSummary;
  comparison: ReportComparison;
  revenueByDay: DayBucket[];
  topProducts: TopProduct[];
  categories: CategoryBreakdown[];
  customers: CustomerStats;
  reservationFunnel: ReservationFunnel | null;
  prepTimes: PrepTimeStats;
};

function startOfDayInTz(date: Date, timezone: string): Date {
  const zoned = toZonedTime(date, timezone);
  zoned.setHours(0, 0, 0, 0);
  const offsetMs = toZonedTime(date, timezone).getTime() - date.getTime();
  return new Date(zoned.getTime() - offsetMs);
}

function computeRange(
  range: ReportRangeInput,
  timezone: string,
  now: Date = new Date(),
): { start: Date; end: Date; days: number } {
  if (typeof range === "object") {
    const s = new Date(range.start + "T12:00:00Z");
    const e = new Date(range.end + "T12:00:00Z");
    const start = startOfDayInTz(s, timezone);
    const endMidnight = startOfDayInTz(e, timezone);
    const oneDayMs = 24 * 60 * 60 * 1000;
    const end = new Date(endMidnight.getTime() + oneDayMs);
    const days = Math.round((end.getTime() - start.getTime()) / oneDayMs);
    return { start, end, days };
  }

  const todayStart = startOfDayInTz(now, timezone);
  const oneDayMs = 24 * 60 * 60 * 1000;
  switch (range) {
    case "today":
      return { start: todayStart, end: now, days: 1 };
    case "yesterday": {
      const start = new Date(todayStart.getTime() - oneDayMs);
      return { start, end: todayStart, days: 1 };
    }
    case "7d":
      return {
        start: new Date(todayStart.getTime() - 6 * oneDayMs),
        end: now,
        days: 7,
      };
    case "30d":
      return {
        start: new Date(todayStart.getTime() - 29 * oneDayMs),
        end: now,
        days: 30,
      };
  }
}

function previousRange(start: Date, end: Date): { start: Date; end: Date } {
  const span = end.getTime() - start.getTime();
  return { start: new Date(start.getTime() - span), end: start };
}

function delta(current: number, previous: number): ComparisonDelta {
  if (previous === 0) {
    return { current, previous, pct: current === 0 ? 0 : null };
  }
  return {
    current,
    previous,
    pct: ((current - previous) / previous) * 100,
  };
}

function weekStartIso(date: Date, timezone: string): string {
  const zoned = toZonedTime(date, timezone);
  const dow = zoned.getDay();
  const diff = (dow + 6) % 7; // monday-based
  const monday = new Date(zoned);
  monday.setDate(zoned.getDate() - diff);
  return formatInTimeZone(monday, timezone, "yyyy-MM-dd");
}

type OrderRowFull = {
  id: string;
  created_at: string;
  total_cents: number | string;
  tip_cents: number | string | null;
  status: string;
  delivery_type: string;
  customer_id: string | null;
  customer_name: string;
  customer_phone: string;
  order_items: Array<{
    product_id: string | null;
    product_name: string;
    quantity: number;
    subtotal_cents: number | string;
    /** issue #190 — la línea anulada no es venta, aunque la orden esté viva. */
    cancelled_at: string | null;
  }>;
};

export async function getReportData(
  businessId: string,
  timezone: string,
  range: ReportRangeInput,
): Promise<ReportData> {
  const { start, end, days } = computeRange(range, timezone);
  const prev = previousRange(start, end);
  const supabase = (await createSupabaseServerClient()) as unknown as GenericClient;

  // 1. Pedidos del rango (con items para top y categorías)
  const ordersSel =
    "id, created_at, total_cents, tip_cents, status, lifecycle_status, delivery_type, customer_id, customer_name, customer_phone, order_items(product_id, product_name, quantity, subtotal_cents, cancelled_at)";

  const [
    ordersRes,
    prevOrdersRes,
    statusHistoryRes,
    productsRes,
    categoriesRes,
    reservationsRes,
    customerFirstOrderRes,
    pastCustomerOrdersRes,
  ] = await Promise.all([
    supabase
      .from("orders")
      .select(ordersSel)
      .eq("business_id", businessId)
      .gte("created_at", start.toISOString())
      .lt("created_at", end.toISOString()),
    supabase
      .from("orders")
      .select("id, total_cents, tip_cents, status, lifecycle_status")
      .eq("business_id", businessId)
      .gte("created_at", prev.start.toISOString())
      .lt("created_at", prev.end.toISOString()),
    supabase
      .from("order_status_history")
      .select(
        "order_id, status, created_at, orders!inner(business_id, created_at, status)",
      )
      .eq("orders.business_id", businessId)
      .gte("orders.created_at", start.toISOString())
      .lt("orders.created_at", end.toISOString())
      .in("status", ["confirmed", "ready"]),
    supabase
      .from("products")
      .select("id, category_id")
      .eq("business_id", businessId),
    supabase
      .from("categories")
      .select("id, name")
      .eq("business_id", businessId),
    supabase
      .from("reservations")
      .select("id, status, starts_at, party_size, source")
      .eq("business_id", businessId)
      .gte("starts_at", start.toISOString())
      .lt("starts_at", end.toISOString()),
    supabase
      .from("orders")
      .select("customer_id, created_at")
      .eq("business_id", businessId)
      .neq("status", "cancelled")
      .neq("lifecycle_status", "cancelled")
      .not("customer_id", "is", null),
    supabase
      .from("orders")
      .select("customer_id, total_cents, tip_cents, created_at")
      .eq("business_id", businessId)
      .neq("status", "cancelled")
      .neq("lifecycle_status", "cancelled")
      .gte("created_at", start.toISOString())
      .lt("created_at", end.toISOString())
      .not("customer_id", "is", null),
  ]);

  const orders = (ordersRes.data ?? []) as OrderRowFull[];
  const prevOrders = prevOrdersRes.data ?? [];

  // ─── Summary ────────────────────────────────────────────────────────────
  let orderCount = 0;
  let revenueCents = 0;
  let deliveryCount = 0;
  let pickupCount = 0;
  let dineInCount = 0;
  let cancelledCount = 0;
  const dayMap = new Map<string, DayBucket>();
  const productMap = new Map<string, TopProduct>();

  for (let i = 0; i < days; i++) {
    const d = new Date(start.getTime() + i * 24 * 60 * 60 * 1000);
    const key = formatInTimeZone(d, timezone, "yyyy-MM-dd");
    dayMap.set(key, { date: key, orderCount: 0, revenueCents: 0 });
  }

  for (const o of orders) {
    // spec 091 — los dos ejes: una mesa anulada queda en `pending` porque
    // ningún flujo de salón escribe `orders.status`.
    if (isOrderDead(o)) {
      cancelledCount++;
      continue;
    }
    orderCount++;
    const cents = Number(o.total_cents) - (Number(o.tip_cents) || 0);
    revenueCents += cents;
    if (o.delivery_type === "delivery") deliveryCount++;
    else if (o.delivery_type === "pickup") pickupCount++;
    else if (o.delivery_type === "dine_in") dineInCount++;

    const key = formatInTimeZone(o.created_at, timezone, "yyyy-MM-dd");
    const bucket = dayMap.get(key);
    if (bucket) {
      bucket.orderCount++;
      bucket.revenueCents += cents;
    }

    for (const item of o.order_items ?? []) {
      if (item.cancelled_at) continue;
      const existing = productMap.get(item.product_name) ?? {
        product_name: item.product_name,
        quantity: 0,
        revenueCents: 0,
      };
      existing.quantity += item.quantity;
      existing.revenueCents += Number(item.subtotal_cents);
      productMap.set(item.product_name, existing);
    }
  }

  const summary: ReportSummary = {
    range: typeof range === "object" ? "custom" : range,
    startIso: start.toISOString(),
    endIso: end.toISOString(),
    orderCount,
    revenueCents,
    averageTicketCents:
      orderCount > 0 ? Math.round(revenueCents / orderCount) : 0,
    deliveryCount,
    pickupCount,
    dineInCount,
    cancelledCount,
  };

  // ─── Comparación período anterior ───────────────────────────────────────
  let prevOrderCount = 0;
  let prevRevenue = 0;
  let prevCancelled = 0;
  for (const o of prevOrders) {
    if (isOrderDead(o)) {
      prevCancelled++;
      continue;
    }
    prevOrderCount++;
    prevRevenue += Number(o.total_cents) - (Number(o.tip_cents) || 0);
  }
  const prevAvgTicket =
    prevOrderCount > 0 ? Math.round(prevRevenue / prevOrderCount) : 0;

  const comparison: ReportComparison = {
    orderCount: delta(orderCount, prevOrderCount),
    revenueCents: delta(revenueCents, prevRevenue),
    averageTicketCents: delta(summary.averageTicketCents, prevAvgTicket),
    cancelledCount: delta(cancelledCount, prevCancelled),
  };

  // ─── Top productos ──────────────────────────────────────────────────────
  const topProducts = [...productMap.values()]
    .sort((a, b) => b.quantity - a.quantity)
    .slice(0, 10);

  // ─── Categorías ─────────────────────────────────────────────────────────
  const productToCategory = new Map<string, string | null>();
  for (const p of productsRes.data ?? []) {
    productToCategory.set(p.id as string, (p.category_id as string) ?? null);
  }
  const categoryNames = new Map<string, string>();
  for (const c of categoriesRes.data ?? []) {
    categoryNames.set(c.id as string, c.name as string);
  }

  const categoryAgg = new Map<
    string,
    { quantity: number; revenueCents: number; products: Set<string> }
  >();
  for (const o of orders) {
    if (isOrderDead(o)) continue;
    for (const item of o.order_items ?? []) {
      if (item.cancelled_at) continue;
      const catId = item.product_id
        ? productToCategory.get(item.product_id) ?? null
        : null;
      const key = catId ?? "__none__";
      const existing = categoryAgg.get(key) ?? {
        quantity: 0,
        revenueCents: 0,
        products: new Set<string>(),
      };
      existing.quantity += item.quantity;
      existing.revenueCents += Number(item.subtotal_cents);
      existing.products.add(item.product_name);
      categoryAgg.set(key, existing);
    }
  }
  const categories: CategoryBreakdown[] = [...categoryAgg.entries()]
    .map(([key, v]) => ({
      categoryId: key === "__none__" ? null : key,
      categoryName:
        key === "__none__" ? "Sin categoría" : categoryNames.get(key) ?? "—",
      productCount: v.products.size,
      quantity: v.quantity,
      revenueCents: v.revenueCents,
    }))
    .sort((a, b) => b.revenueCents - a.revenueCents);

  // ─── Clientes (retención + top) ─────────────────────────────────────────
  const firstOrderByCustomer = new Map<string, number>();
  for (const r of customerFirstOrderRes.data ?? []) {
    const cid = r.customer_id as string;
    const t = new Date(r.created_at as string).getTime();
    const cur = firstOrderByCustomer.get(cid);
    if (cur === undefined || t < cur) firstOrderByCustomer.set(cid, t);
  }

  const customerInRange = new Map<
    string,
    { orderCount: number; revenueCents: number; firstAt: number; lastAt: number }
  >();
  for (const o of (pastCustomerOrdersRes.data ?? []) as Array<{
    customer_id: string | null;
    total_cents: number | string;
    tip_cents: number | string | null;
    created_at: string;
  }>) {
    if (!o.customer_id) continue;
    const t = new Date(o.created_at).getTime();
    const cents = Number(o.total_cents) - (Number(o.tip_cents) || 0);
    const existing = customerInRange.get(o.customer_id) ?? {
      orderCount: 0,
      revenueCents: 0,
      firstAt: t,
      lastAt: t,
    };
    existing.orderCount += 1;
    existing.revenueCents += cents;
    existing.firstAt = Math.min(existing.firstAt, t);
    existing.lastAt = Math.max(existing.lastAt, t);
    customerInRange.set(o.customer_id, existing);
  }

  let newCount = 0;
  let returningCount = 0;
  const weeklyMap = new Map<
    string,
    { newCount: number; returningCount: number }
  >();
  for (const [cid, info] of customerInRange) {
    const firstEver = firstOrderByCustomer.get(cid) ?? info.firstAt;
    const isNew = firstEver >= start.getTime();
    if (isNew) newCount++;
    else returningCount++;

    const wk = weekStartIso(new Date(info.firstAt), timezone);
    const w = weeklyMap.get(wk) ?? { newCount: 0, returningCount: 0 };
    if (isNew) w.newCount++;
    else w.returningCount++;
    weeklyMap.set(wk, w);
  }
  const weekly = [...weeklyMap.entries()]
    .map(([weekStart, v]) => ({ weekStart, ...v }))
    .sort((a, b) => a.weekStart.localeCompare(b.weekStart));

  // top customers — necesitamos nombre/phone, lo sacamos del map de orders del rango
  const customerMeta = new Map<string, { name: string; phone: string }>();
  for (const o of orders) {
    if (o.customer_id && !customerMeta.has(o.customer_id)) {
      customerMeta.set(o.customer_id, {
        name: o.customer_name,
        phone: o.customer_phone,
      });
    }
  }
  const topCustomers = [...customerInRange.entries()]
    .map(([cid, v]) => ({
      customerId: cid,
      name: customerMeta.get(cid)?.name ?? "—",
      phone: customerMeta.get(cid)?.phone ?? "",
      orderCount: v.orderCount,
      revenueCents: v.revenueCents,
      lastOrderAt: new Date(v.lastAt).toISOString(),
    }))
    .sort((a, b) => b.revenueCents - a.revenueCents)
    .slice(0, 8);

  const customers: CustomerStats = {
    uniqueCount: customerInRange.size,
    newCount,
    returningCount,
    weekly,
    topCustomers,
  };

  // ─── Funnel de reservas ─────────────────────────────────────────────────
  const reservations = reservationsRes.data ?? [];
  let funnel: ReservationFunnel | null = null;
  if (reservations.length > 0) {
    let confirmed = 0;
    let seated = 0;
    let completed = 0;
    let noShow = 0;
    let cancelled = 0;
    const byChannel = { web: 0, admin: 0, chatbot: 0 };
    const wkMap = new Map<
      string,
      { completed: number; noShow: number; cancelled: number }
    >();
    for (const r of reservations) {
      const status = r.status as string;
      if (status === "confirmed") confirmed++;
      else if (status === "seated") seated++;
      else if (status === "completed") completed++;
      else if (status === "no_show") noShow++;
      else if (status === "cancelled") cancelled++;

      const source = (r.source as string) ?? "web";
      if (source === "admin") byChannel.admin++;
      else if (source === "chatbot") byChannel.chatbot++;
      else byChannel.web++;

      const wk = weekStartIso(new Date(r.starts_at as string), timezone);
      const w = wkMap.get(wk) ?? { completed: 0, noShow: 0, cancelled: 0 };
      if (status === "completed") w.completed++;
      else if (status === "no_show") w.noShow++;
      else if (status === "cancelled") w.cancelled++;
      wkMap.set(wk, w);
    }
    const finalized = completed + noShow;
    funnel = {
      total: reservations.length,
      confirmed,
      seated,
      completed,
      noShow,
      cancelled,
      attendanceRate: finalized > 0 ? (completed / finalized) * 100 : 0,
      byChannel,
      weekly: [...wkMap.entries()]
        .map(([weekStart, v]) => ({ weekStart, ...v }))
        .sort((a, b) => a.weekStart.localeCompare(b.weekStart)),
    };
  }

  // ─── Tiempos de preparación (confirmed → ready) ─────────────────────────
  const history = (statusHistoryRes.data ?? []) as Array<{
    order_id: string;
    status: string;
    created_at: string;
  }>;
  const confirmedAt = new Map<string, number>();
  const readyAt = new Map<string, number>();
  for (const h of history) {
    const t = new Date(h.created_at).getTime();
    if (h.status === "confirmed") {
      const cur = confirmedAt.get(h.order_id);
      if (cur === undefined || t < cur) confirmedAt.set(h.order_id, t);
    } else if (h.status === "ready") {
      const cur = readyAt.get(h.order_id);
      if (cur === undefined || t > cur) readyAt.set(h.order_id, t);
    }
  }
  const minutes: number[] = [];
  const dailyAgg = new Map<string, { sum: number; count: number }>();
  for (const [orderId, c] of confirmedAt) {
    const r = readyAt.get(orderId);
    if (r === undefined || r < c) continue;
    const m = (r - c) / 60000;
    if (m > 240) continue; // descartamos outliers > 4 h
    minutes.push(m);
    const dayKey = formatInTimeZone(new Date(c), timezone, "yyyy-MM-dd");
    const agg = dailyAgg.get(dayKey) ?? { sum: 0, count: 0 };
    agg.sum += m;
    agg.count += 1;
    dailyAgg.set(dayKey, agg);
  }
  minutes.sort((a, b) => a - b);
  const avg =
    minutes.length > 0
      ? minutes.reduce((s, m) => s + m, 0) / minutes.length
      : 0;
  const median =
    minutes.length > 0
      ? minutes.length % 2 === 0
        ? (minutes[minutes.length / 2 - 1]! + minutes[minutes.length / 2]!) / 2
        : minutes[Math.floor(minutes.length / 2)]!
      : 0;
  const buckets = [
    { label: "< 15 min", count: minutes.filter((m) => m < 15).length },
    {
      label: "15–30 min",
      count: minutes.filter((m) => m >= 15 && m < 30).length,
    },
    {
      label: "30–45 min",
      count: minutes.filter((m) => m >= 30 && m < 45).length,
    },
    { label: "≥ 45 min", count: minutes.filter((m) => m >= 45).length },
  ];
  const prepTimes: PrepTimeStats = {
    sampleSize: minutes.length,
    averageMinutes: avg,
    medianMinutes: median,
    buckets,
    daily: [...dailyAgg.entries()]
      .map(([date, v]) => ({
        date,
        averageMinutes: v.count > 0 ? v.sum / v.count : 0,
        sampleSize: v.count,
      }))
      .sort((a, b) => a.date.localeCompare(b.date)),
  };

  const revenueByDay = [...dayMap.values()].sort((a, b) =>
    a.date.localeCompare(b.date),
  );

  return {
    summary,
    comparison,
    revenueByDay,
    topProducts,
    categories,
    customers,
    reservationFunnel: funnel,
    prepTimes,
  };
}

// ─── Salón / Dine-in ──────────────────────────────────────────────────────

export type SalonStats = {
  openTables: number;
  totalTables: number;
  todayDineInCount: number;
  todayDineInRevenueCents: number;
  todayDineInAverageTicketCents: number;
  todayDeliveryAverageTicketCents: number;
  tableTurnover: { tableLabel: string; turns: number; seats: number }[];
  averageStayMinutes: number;
};

export async function getSalonStats(
  businessId: string,
  timezone: string,
): Promise<SalonStats> {
  const supabase = (await createSupabaseServerClient()) as unknown as GenericClient;
  const todayStart = startOfDayInTz(new Date(), timezone);

  const [tablesRes, ordersRes] = await Promise.all([
    supabase
      .from("tables")
      .select(
        "id, label, seats, operational_status, opened_at, floor_plans!inner(business_id)",
      )
      .eq("floor_plans.business_id", businessId),
    supabase
      .from("orders")
      .select("id, total_cents, tip_cents, delivery_type, status, table_id, created_at")
      .eq("business_id", businessId)
      .gte("created_at", todayStart.toISOString())
      .neq("status", "cancelled")
      .neq("lifecycle_status", "cancelled"),
  ]);

  const tables = (tablesRes.data ?? []) as Array<{
    id: string;
    label: string;
    seats: number;
    operational_status: string | null;
    opened_at: string | null;
  }>;
  const orders = (ordersRes.data ?? []) as Array<{
    id: string;
    total_cents: number | string;
    tip_cents: number | string | null;
    delivery_type: string;
    table_id: string | null;
    created_at: string;
  }>;

  const openTables = tables.filter(
    (t) => t.operational_status && t.operational_status !== "libre",
  ).length;

  const rev = (o: (typeof orders)[number]) =>
    Number(o.total_cents) - (Number(o.tip_cents) || 0);
  const dineInOrders = orders.filter((o) => o.delivery_type === "dine_in");
  const deliveryOrders = orders.filter((o) => o.delivery_type !== "dine_in");
  const dineInRevenue = dineInOrders.reduce((s, o) => s + rev(o), 0);
  const deliveryRevenue = deliveryOrders.reduce((s, o) => s + rev(o), 0);

  const turnoverMap = new Map<string, number>();
  for (const o of dineInOrders) {
    if (!o.table_id) continue;
    turnoverMap.set(o.table_id, (turnoverMap.get(o.table_id) ?? 0) + 1);
  }
  const tableLookup = new Map<string, { label: string; seats: number }>();
  for (const t of tables) {
    tableLookup.set(t.id, { label: t.label, seats: t.seats });
  }
  const tableTurnover = [...turnoverMap.entries()]
    .map(([id, turns]) => ({
      tableLabel: tableLookup.get(id)?.label ?? "—",
      turns,
      seats: tableLookup.get(id)?.seats ?? 0,
    }))
    .sort((a, b) => b.turns - a.turns)
    .slice(0, 6);

  const stayMinutes: number[] = [];
  const now = Date.now();
  for (const t of tables) {
    if (t.opened_at) {
      const opened = new Date(t.opened_at).getTime();
      const m = (now - opened) / 60000;
      if (m > 0 && m < 480) stayMinutes.push(m);
    }
  }
  const averageStay =
    stayMinutes.length > 0
      ? stayMinutes.reduce((s, m) => s + m, 0) / stayMinutes.length
      : 0;

  return {
    openTables,
    totalTables: tables.length,
    todayDineInCount: dineInOrders.length,
    todayDineInRevenueCents: dineInRevenue,
    todayDineInAverageTicketCents:
      dineInOrders.length > 0
        ? Math.round(dineInRevenue / dineInOrders.length)
        : 0,
    todayDeliveryAverageTicketCents:
      deliveryOrders.length > 0
        ? Math.round(deliveryRevenue / deliveryOrders.length)
        : 0,
    tableTurnover,
    averageStayMinutes: averageStay,
  };
}
