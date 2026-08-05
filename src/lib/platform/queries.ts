import "server-only";

import { isOrderDead } from "@/lib/orders/predicates";
import {
  getReportData,
  getSalonStats,
  type ComparisonDelta,
  type ReportData,
  type ReportRangeInput,
  type SalonStats,
} from "@/lib/admin/reports-query";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

export type PlatformBusiness = {
  id: string;
  slug: string;
  name: string;
  timezone: string;
  is_active: boolean;
  created_at: string;
  logo_url: string | null;
  member_count: number;
  orders_30d: number;
  revenue_30d_cents: number;
};

export type PlatformOverview = {
  businesses: PlatformBusiness[];
  totals: {
    businesses: number;
    active_businesses: number;
    members: number;
    orders_30d: number;
    revenue_30d_cents: number;
  };
};

export async function ensurePlatformAdmin() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const service = createSupabaseServiceClient();
  const { data: profile } = await service
    .from("users")
    .select("is_platform_admin, email")
    .eq("id", user.id)
    .maybeSingle();
  if (!profile?.is_platform_admin) return null;
  return { user, email: profile.email };
}

export async function getPlatformOverview(): Promise<PlatformOverview> {
  const service = createSupabaseServiceClient();
  const sinceIso = new Date(
    Date.now() - 30 * 24 * 60 * 60 * 1000,
  ).toISOString();

  const [{ data: businesses }, { data: recentOrders }] = await Promise.all([
    service
      .from("businesses")
      .select(
        "id, slug, name, timezone, is_active, created_at, logo_url, business_users(user_id)",
      )
      .order("created_at", { ascending: false }),
    service
      .from("orders")
      .select("business_id, total_cents, status, lifecycle_status")
      .gte("created_at", sinceIso),
  ]);

  const rows = businesses ?? [];
  const orders = recentOrders ?? [];

  const statsByBiz = new Map<
    string,
    { orders_30d: number; revenue_30d_cents: number }
  >();
  for (const o of orders) {
    if (isOrderDead(o)) continue;
    const cur = statsByBiz.get(o.business_id) ?? {
      orders_30d: 0,
      revenue_30d_cents: 0,
    };
    cur.orders_30d += 1;
    cur.revenue_30d_cents += Number(o.total_cents);
    statsByBiz.set(o.business_id, cur);
  }

  const list: PlatformBusiness[] = rows.map((b) => {
    const stats = statsByBiz.get(b.id) ?? {
      orders_30d: 0,
      revenue_30d_cents: 0,
    };
    return {
      id: b.id,
      slug: b.slug,
      name: b.name,
      timezone: b.timezone,
      is_active: b.is_active,
      created_at: b.created_at,
      logo_url: b.logo_url,
      member_count: b.business_users?.length ?? 0,
      orders_30d: stats.orders_30d,
      revenue_30d_cents: stats.revenue_30d_cents,
    };
  });

  const totals = {
    businesses: list.length,
    active_businesses: list.filter((b) => b.is_active).length,
    members: list.reduce((a, b) => a + b.member_count, 0),
    orders_30d: list.reduce((a, b) => a + b.orders_30d, 0),
    revenue_30d_cents: list.reduce((a, b) => a + b.revenue_30d_cents, 0),
  };

  return { businesses: list, totals };
}

// ── "Mis locales" — consolidado del dueño multi-local (spec 14) ─────────
//
// Modelo derivado, SIN tabla de grupos: el "grupo" del dueño = los locales
// donde es `role = 'admin'`. Acceso al consolidado ⇔ es admin de ≥2 locales.
// Ver wiki/specs/14-multi-local-y-deploy-onsite/dashboard-y-permisos.md §0.

export type MiLocal = {
  id: string;
  slug: string;
  name: string;
  timezone: string;
  logo_url: string | null;
};

/** Locales donde el usuario autenticado es `admin` (su grupo derivado). */
export async function getMyAdminBusinesses(): Promise<MiLocal[]> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [];

  const service = createSupabaseServiceClient();
  const { data } = await service
    .from("business_users")
    .select(
      "role, businesses(id, slug, name, timezone, logo_url, is_active)",
    )
    .eq("user_id", user.id)
    .eq("role", "admin");

  const list = (data ?? [])
    .map((r) => r.businesses as unknown as (MiLocal & { is_active: boolean }) | null)
    .filter((b): b is MiLocal & { is_active: boolean } => Boolean(b) && b!.is_active)
    .map((b) => ({
      id: b.id,
      slug: b.slug,
      name: b.name,
      timezone: b.timezone,
      logo_url: b.logo_url,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return list;
}

export type LocalReport = { local: MiLocal; data: ReportData; salon: SalonStats };

export type GroupTopProduct = {
  product_name: string;
  quantity: number;
  revenueCents: number;
};

export type SharedCustomers = {
  sharedCount: number;
  uniqueCount: number;
  top: {
    name: string;
    phone: string;
    localesCount: number;
    orderCount: number;
    revenueCents: number;
  }[];
};

export type MisLocalesData = {
  locales: LocalReport[];
  totals: {
    revenueCents: number;
    orderCount: number;
    averageTicketCents: number;
    cancelledCount: number;
    deliveryCount: number;
    pickupCount: number;
    dineInCount: number;
  };
  comparison: {
    revenueCents: ComparisonDelta;
    orderCount: ComparisonDelta;
    averageTicketCents: ComparisonDelta;
  };
  topProducts: GroupTopProduct[];
  sharedCustomers: SharedCustomers;
};

function delta(current: number, previous: number): ComparisonDelta {
  if (previous === 0) return { current, previous, pct: current === 0 ? 0 : null };
  return { current, previous, pct: ((current - previous) / previous) * 100 };
}

/**
 * Clientes que compran en ≥2 de los locales del grupo (insight imposible local
 * por local). Cruza `customer_id` entre los negocios del dueño en el rango.
 * Scopeado a los `businessIds` del usuario-admin → sin fuga cross-tenant.
 */
async function getSharedCustomers(
  businessIds: string[],
  startIso: string,
  endIso: string,
): Promise<SharedCustomers> {
  const service = createSupabaseServiceClient();
  const { data } = await service
    .from("orders")
    .select(
      "business_id, customer_id, total_cents, tip_cents, customer_name, customer_phone",
    )
    .in("business_id", businessIds)
    .neq("status", "cancelled")
    .neq("lifecycle_status", "cancelled")
    .not("customer_id", "is", null)
    .gte("created_at", startIso)
    .lt("created_at", endIso);

  type Agg = {
    locales: Set<string>;
    orderCount: number;
    revenueCents: number;
    name: string;
    phone: string;
  };
  const byCustomer = new Map<string, Agg>();
  for (const o of data ?? []) {
    const cid = o.customer_id as string | null;
    if (!cid) continue;
    const cur = byCustomer.get(cid) ?? {
      locales: new Set<string>(),
      orderCount: 0,
      revenueCents: 0,
      name: o.customer_name ?? "—",
      phone: o.customer_phone ?? "",
    };
    cur.locales.add(o.business_id);
    cur.orderCount += 1;
    cur.revenueCents += Number(o.total_cents) - (Number(o.tip_cents) || 0);
    byCustomer.set(cid, cur);
  }

  const shared = [...byCustomer.values()].filter((c) => c.locales.size >= 2);
  const top = shared
    .map((c) => ({
      name: c.name,
      phone: c.phone,
      localesCount: c.locales.size,
      orderCount: c.orderCount,
      revenueCents: c.revenueCents,
    }))
    .sort((a, b) => b.revenueCents - a.revenueCents)
    .slice(0, 8);

  return {
    sharedCount: shared.length,
    uniqueCount: byCustomer.size,
    top,
  };
}

/**
 * Consolidado comparativo del dueño. Corre `getReportData` por cada local-admin
 * en paralelo (bajo RLS: el usuario es admin de todos) y agrega totales + top
 * del grupo. Devuelve null si el usuario no es admin de ≥2 locales.
 */
export async function getMisLocalesData(
  range: ReportRangeInput,
): Promise<MisLocalesData | null> {
  const locales = await getMyAdminBusinesses();
  if (locales.length < 2) return null;

  const reports = await Promise.all(
    locales.map(async (local) => {
      const [data, salon] = await Promise.all([
        getReportData(local.id, local.timezone, range),
        getSalonStats(local.id, local.timezone),
      ]);
      return { local, data, salon };
    }),
  );

  const sum = (f: (r: LocalReport) => number) => reports.reduce((a, r) => a + f(r), 0);

  const revenueCents = sum((r) => r.data.summary.revenueCents);
  const orderCount = sum((r) => r.data.summary.orderCount);
  const prevRevenue = sum((r) => r.data.comparison.revenueCents.previous);
  const prevOrders = sum((r) => r.data.comparison.orderCount.previous);
  const averageTicketCents = orderCount > 0 ? Math.round(revenueCents / orderCount) : 0;
  const prevAvgTicket = prevOrders > 0 ? Math.round(prevRevenue / prevOrders) : 0;

  // Top productos del grupo: merge por nombre.
  const productMap = new Map<string, GroupTopProduct>();
  for (const r of reports) {
    for (const p of r.data.topProducts) {
      const cur = productMap.get(p.product_name) ?? {
        product_name: p.product_name,
        quantity: 0,
        revenueCents: 0,
      };
      cur.quantity += p.quantity;
      cur.revenueCents += p.revenueCents;
      productMap.set(p.product_name, cur);
    }
  }
  const topProducts = [...productMap.values()]
    .sort((a, b) => b.quantity - a.quantity)
    .slice(0, 10);

  // Clientes compartidos: rango común (mín start / máx end de los locales).
  const startIso = reports
    .map((r) => r.data.summary.startIso)
    .sort()[0]!;
  const endIso = reports
    .map((r) => r.data.summary.endIso)
    .sort()
    .at(-1)!;
  const sharedCustomers = await getSharedCustomers(
    locales.map((l) => l.id),
    startIso,
    endIso,
  );

  return {
    locales: reports,
    totals: {
      revenueCents,
      orderCount,
      averageTicketCents,
      cancelledCount: sum((r) => r.data.summary.cancelledCount),
      deliveryCount: sum((r) => r.data.summary.deliveryCount),
      pickupCount: sum((r) => r.data.summary.pickupCount),
      dineInCount: sum((r) => r.data.summary.dineInCount),
    },
    comparison: {
      revenueCents: delta(revenueCents, prevRevenue),
      orderCount: delta(orderCount, prevOrders),
      averageTicketCents: delta(averageTicketCents, prevAvgTicket),
    },
    topProducts,
    sharedCustomers,
  };
}

export type PlatformBusinessDetail = {
  id: string;
  slug: string;
  name: string;
  timezone: string;
  is_active: boolean;
  members: {
    user_id: string;
    email: string;
    role: string;
    created_at: string;
  }[];
};

export async function getBusinessDetail(
  id: string,
): Promise<PlatformBusinessDetail | null> {
  const service = createSupabaseServiceClient();
  const { data } = await service
    .from("businesses")
    .select(
      "id, slug, name, timezone, is_active, business_users(user_id, role, created_at, users:user_id(email))",
    )
    .eq("id", id)
    .maybeSingle();
  if (!data) return null;
  return {
    id: data.id,
    slug: data.slug,
    name: data.name,
    timezone: data.timezone,
    is_active: data.is_active,
    members: (data.business_users ?? []).map((m) => ({
      user_id: m.user_id,
      email: m.users?.email ?? "—",
      role: m.role,
      created_at: m.created_at,
    })),
  };
}
