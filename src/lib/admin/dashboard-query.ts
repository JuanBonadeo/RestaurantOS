import "server-only";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getProfitMetrics, type ProfitMetrics } from "@/lib/admin/profit-query";
import { isOrderAlive, isOrderDead } from "@/lib/orders/predicates";

export type DashboardOverview = {
  today: {
    orderCount: number;
    revenueCents: number;
    activeOrderCount: number;
    cancelledCount: number;
    averageTicketCents: number;
    newCustomerCount: number;
  };
  yesterday: {
    orderCount: number;
    revenueCents: number;
    averageTicketCents: number;
    newCustomerCount: number;
  };
  month: {
    orderCount: number;
    revenueCents: number;
    dailyRevenue: { date: string; revenueCents: number; orders: number }[];
  };
  channelBreakdown: {
    delivery: { count: number; revenueCents: number };
    pickup: { count: number; revenueCents: number };
    dine_in: { count: number; revenueCents: number };
  };
  topProducts: { name: string; quantity: number; revenueCents: number }[];
};

function startOfDayUtc(tz: string, daysAgo = 0): Date {
  const now = new Date();
  now.setUTCDate(now.getUTCDate() - daysAgo);
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
  const nowInTz = new Date(
    `${pick("year")}-${pick("month")}-${pick("day")}T${pick("hour")}:${pick("minute")}:${pick("second")}Z`,
  );
  const offsetMs = nowInTz.getTime() - now.getTime();
  const localMidnight = new Date(`${isoLocal}Z`);
  return new Date(localMidnight.getTime() - offsetMs);
}

function dayKey(date: Date, tz: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const pick = (type: string) =>
    parts.find((p) => p.type === type)?.value ?? "00";
  return `${pick("year")}-${pick("month")}-${pick("day")}`;
}

const DAYS_IN_MONTH_RANGE = 30;

export async function getDashboardOverview(
  businessId: string,
  timezone: string,
): Promise<DashboardOverview> {
  const supabase = await createSupabaseServerClient();

  const startToday = startOfDayUtc(timezone, 0);
  const startYesterday = startOfDayUtc(timezone, 1);
  const startMonth = startOfDayUtc(timezone, DAYS_IN_MONTH_RANGE - 1);

  const [ordersRes, todayItemsRes, customersRes] = await Promise.all([
    supabase
      .from("orders")
      .select("created_at, total_cents, tip_cents, status, lifecycle_status, delivery_type")
      .eq("business_id", businessId)
      .gte("created_at", startMonth.toISOString()),
    supabase
      .from("order_items")
      .select(
        "product_name, quantity, subtotal_cents, orders!inner(business_id, created_at, status, lifecycle_status)",
      )
      .eq("orders.business_id", businessId)
      .gte("orders.created_at", startToday.toISOString())
      // spec 091 — los dos ejes. Con uno solo, Top productos seguía mostrando
      // las 6 cervezas de una mesa anulada al día siguiente.
      .neq("orders.status", "cancelled")
      .neq("orders.lifecycle_status", "cancelled")
      // issue #190 — y el tercer eje: la **línea** anulada adentro de una mesa
      // viva. Las dos milanesas que se cayeron al piso seguían en Top productos.
      .is("cancelled_at", null),
    supabase
      .from("customers")
      .select("created_at")
      .eq("business_id", businessId)
      .gte("created_at", startYesterday.toISOString()),
  ]);

  type OrderRow = {
    created_at: string;
    total_cents: number;
    status: string;
    lifecycle_status: string;
    delivery_type: string;
  };
  const orders: OrderRow[] = (ordersRes.data ?? []).map((r) => ({
    created_at: r.created_at,
    total_cents: Number(r.total_cents) - (Number(r.tip_cents) || 0),
    status: r.status as string,
    lifecycle_status: (r.lifecycle_status as string) ?? "open",
    delivery_type: (r.delivery_type as string) ?? "delivery",
  }));

  const inRange = (r: OrderRow, start: Date, end?: Date) => {
    const t = new Date(r.created_at).getTime();
    return t >= start.getTime() && (!end || t < end.getTime());
  };

  const todayRows = orders.filter((r) => inRange(r, startToday));
  const yesterdayRows = orders.filter((r) =>
    inRange(r, startYesterday, startToday),
  );

  const todayNotCancelled = todayRows.filter(isOrderAlive);
  const todayRevenue = todayNotCancelled.reduce(
    (s, r) => s + r.total_cents,
    0,
  );
  const todayCancelled = todayRows.filter(isOrderDead).length;
  const activeStatuses = new Set([
    "pending",
    "confirmed",
    "preparing",
    "ready",
    "on_the_way",
  ]);
  // spec 091 — «Pedidos activos» miraba un solo eje, así que contaba las mesas
  // **cobradas** (que quedan en `pending` porque ningún flujo de salón escribe
  // `orders.status`) y las anuladas. El dueño abría el panel un martes a las 4
  // con el local vacío y leía «Pedidos activos: 47».
  const activeOrderCount = todayRows.filter(
    (r) => isOrderAlive(r) && r.lifecycle_status !== "closed" && activeStatuses.has(r.status),
  ).length;

  const yesterdayNotCancelled = yesterdayRows.filter(isOrderAlive);
  const yesterdayRevenue = yesterdayNotCancelled.reduce(
    (s, r) => s + r.total_cents,
    0,
  );

  const monthNotCancelled = orders.filter(isOrderAlive);
  const monthRevenue = monthNotCancelled.reduce(
    (s, r) => s + r.total_cents,
    0,
  );

  const dailyBuckets = new Map<
    string,
    { revenueCents: number; orders: number }
  >();
  for (let i = DAYS_IN_MONTH_RANGE - 1; i >= 0; i--) {
    const d = startOfDayUtc(timezone, i);
    dailyBuckets.set(dayKey(d, timezone), { revenueCents: 0, orders: 0 });
  }
  for (const r of monthNotCancelled) {
    const k = dayKey(new Date(r.created_at), timezone);
    const bucket = dailyBuckets.get(k);
    if (bucket) {
      bucket.revenueCents += r.total_cents;
      bucket.orders += 1;
    }
  }

  const channelBreakdown = {
    delivery: { count: 0, revenueCents: 0 },
    pickup: { count: 0, revenueCents: 0 },
    dine_in: { count: 0, revenueCents: 0 },
  };
  for (const r of monthNotCancelled) {
    const key = (r.delivery_type as keyof typeof channelBreakdown) ?? "delivery";
    if (key in channelBreakdown) {
      channelBreakdown[key].count += 1;
      channelBreakdown[key].revenueCents += r.total_cents;
    }
  }

  const productCounts = new Map<
    string,
    { quantity: number; revenueCents: number }
  >();
  for (const it of todayItemsRes.data ?? []) {
    const name = (it as { product_name: string }).product_name;
    const qty = Number((it as { quantity: number }).quantity) || 0;
    const sub = Number((it as { subtotal_cents: number }).subtotal_cents) || 0;
    const existing = productCounts.get(name) ?? {
      quantity: 0,
      revenueCents: 0,
    };
    existing.quantity += qty;
    existing.revenueCents += sub;
    productCounts.set(name, existing);
  }
  const topProducts = Array.from(productCounts.entries())
    .map(([name, v]) => ({
      name,
      quantity: v.quantity,
      revenueCents: v.revenueCents,
    }))
    .sort((a, b) => b.quantity - a.quantity)
    .slice(0, 5);

  const customers = customersRes.data ?? [];
  const newCustomersToday = customers.filter((c) => {
    const t = new Date(c.created_at as string).getTime();
    return t >= startToday.getTime();
  }).length;
  const newCustomersYesterday = customers.filter((c) => {
    const t = new Date(c.created_at as string).getTime();
    return t >= startYesterday.getTime() && t < startToday.getTime();
  }).length;

  return {
    today: {
      orderCount: todayNotCancelled.length,
      revenueCents: todayRevenue,
      activeOrderCount,
      cancelledCount: todayCancelled,
      averageTicketCents:
        todayNotCancelled.length > 0
          ? Math.round(todayRevenue / todayNotCancelled.length)
          : 0,
      newCustomerCount: newCustomersToday,
    },
    yesterday: {
      orderCount: yesterdayNotCancelled.length,
      revenueCents: yesterdayRevenue,
      averageTicketCents:
        yesterdayNotCancelled.length > 0
          ? Math.round(yesterdayRevenue / yesterdayNotCancelled.length)
          : 0,
      newCustomerCount: newCustomersYesterday,
    },
    month: {
      orderCount: monthNotCancelled.length,
      revenueCents: monthRevenue,
      dailyRevenue: Array.from(dailyBuckets.entries()).map(([date, v]) => ({
        date,
        revenueCents: v.revenueCents,
        orders: v.orders,
      })),
    },
    channelBreakdown,
    topProducts,
  };
}

export type HourlyHeatmapCell = {
  dow: number;
  hour: number;
  orderCount: number;
  revenueCents: number;
};

export type HourlyHeatmap = {
  cells: HourlyHeatmapCell[];
  maxCount: number;
  totalOrders: number;
  rangeDays: number;
};

const HEATMAP_DAYS = 90;

export async function getHourlyHeatmap(
  businessId: string,
  timezone: string,
): Promise<HourlyHeatmap> {
  const supabase = await createSupabaseServerClient();
  const start = startOfDayUtc(timezone, HEATMAP_DAYS - 1);

  const { data } = await supabase
    .from("orders")
    .select("created_at, total_cents, status")
    .eq("business_id", businessId)
    .neq("status", "cancelled")
    .neq("lifecycle_status", "cancelled")
    .gte("created_at", start.toISOString());

  const grid = new Map<string, HourlyHeatmapCell>();
  for (let dow = 0; dow < 7; dow++) {
    for (let hour = 0; hour < 24; hour++) {
      grid.set(`${dow}-${hour}`, {
        dow,
        hour,
        orderCount: 0,
        revenueCents: 0,
      });
    }
  }

  const dowFmt = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "short",
  });
  const hourFmt = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour: "2-digit",
    hour12: false,
  });
  const dowMap: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };

  for (const row of data ?? []) {
    const date = new Date(row.created_at as string);
    const dowName = dowFmt.format(date);
    const dow = dowMap[dowName] ?? 0;
    const hourStr = hourFmt.format(date).replace(/\D/g, "");
    const hour = Number(hourStr) % 24;
    const cell = grid.get(`${dow}-${hour}`);
    if (cell) {
      cell.orderCount += 1;
      cell.revenueCents += Number(row.total_cents) || 0;
    }
  }

  const cells = Array.from(grid.values());
  const maxCount = cells.reduce((m, c) => Math.max(m, c.orderCount), 0);
  const totalOrders = cells.reduce((s, c) => s + c.orderCount, 0);

  return { cells, maxCount, totalOrders, rangeDays: HEATMAP_DAYS };
}

// ── Rentabilidad del dashboard (últimos 30 días) ──────────────────

export async function getDashboardProfit(
  businessId: string,
  timezone: string,
): Promise<ProfitMetrics> {
  const start = startOfDayUtc(timezone, DAYS_IN_MONTH_RANGE - 1);
  const end = new Date();
  return getProfitMetrics(businessId, start.toISOString(), end.toISOString());
}

// ── Mix de medios de pago (últimos 30 días) ───────────────────────

export type PaymentMethodKey =
  | "cash"
  | "card_manual"
  | "mp_link"
  | "mp_qr"
  | "transfer"
  | "other";

export type PaymentMix = {
  byMethod: Record<PaymentMethodKey, { count: number; amountCents: number }>;
  totalCents: number;
  cashCents: number;
  digitalCents: number;
};

const EMPTY_MIX: Record<PaymentMethodKey, { count: number; amountCents: number }> =
  {
    cash: { count: 0, amountCents: 0 },
    card_manual: { count: 0, amountCents: 0 },
    mp_link: { count: 0, amountCents: 0 },
    mp_qr: { count: 0, amountCents: 0 },
    transfer: { count: 0, amountCents: 0 },
    other: { count: 0, amountCents: 0 },
  };

export async function getPaymentMix(
  businessId: string,
  timezone: string,
): Promise<PaymentMix> {
  const supabase = await createSupabaseServerClient();
  const start = startOfDayUtc(timezone, DAYS_IN_MONTH_RANGE - 1);

  const { data } = await supabase
    .from("payments")
    .select("method, amount_cents")
    .eq("business_id", businessId)
    .eq("payment_status", "paid")
    .gte("created_at", start.toISOString());

  const byMethod: Record<
    PaymentMethodKey,
    { count: number; amountCents: number }
  > = JSON.parse(JSON.stringify(EMPTY_MIX));
  let totalCents = 0;

  for (const p of data ?? []) {
    const row = p as { method: string; amount_cents: number };
    const key = (row.method as PaymentMethodKey) in byMethod
      ? (row.method as PaymentMethodKey)
      : "other";
    const amount = Number(row.amount_cents) || 0;
    byMethod[key].count += 1;
    byMethod[key].amountCents += amount;
    totalCents += amount;
  }

  const cashCents = byMethod.cash.amountCents;
  const digitalCents = totalCents - cashCents;

  return { byMethod, totalCents, cashCents, digitalCents };
}

// ── Control de caja (por rango) ───────────────────────────────────

export type CashControl = {
  corteCount: number;
  netDifferenceCents: number; // suma de diferencias (sobrante - faltante)
  shortageCents: number; // total faltante (diferencias negativas)
  surplusCents: number; // total sobrante (diferencias positivas)
  sangriaCents: number;
  ingresoCents: number;
};

export async function getCashControl(
  businessId: string,
  startIso: string,
  endIso: string,
): Promise<CashControl> {
  const supabase = await createSupabaseServerClient();

  const [cortesRes, movRes] = await Promise.all([
    supabase
      .from("caja_cortes")
      .select("difference_cents")
      .eq("business_id", businessId)
      .gte("created_at", startIso)
      .lt("created_at", endIso),
    supabase
      .from("caja_movimientos")
      .select("kind, amount_cents")
      .eq("business_id", businessId)
      .gte("created_at", startIso)
      .lt("created_at", endIso),
  ]);

  let netDifferenceCents = 0;
  let shortageCents = 0;
  let surplusCents = 0;
  const cortes = cortesRes.data ?? [];
  for (const c of cortes) {
    const diff = Number((c as { difference_cents: number }).difference_cents) || 0;
    netDifferenceCents += diff;
    if (diff < 0) shortageCents += Math.abs(diff);
    else surplusCents += diff;
  }

  let sangriaCents = 0;
  let ingresoCents = 0;
  for (const m of movRes.data ?? []) {
    const row = m as { kind: string; amount_cents: number };
    const amount = Number(row.amount_cents) || 0;
    if (row.kind === "sangria") sangriaCents += amount;
    else if (row.kind === "ingreso") ingresoCents += amount;
  }

  return {
    corteCount: cortes.length,
    netDifferenceCents,
    shortageCents,
    surplusCents,
    sangriaCents,
    ingresoCents,
  };
}
