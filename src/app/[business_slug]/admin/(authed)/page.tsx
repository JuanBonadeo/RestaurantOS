import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import {
  ArrowUpRight,
  CircleDollarSign,
  Coins,
  Flame,
  Receipt,
  Timer,
  Trash2,
  Users,
  Wallet,
} from "lucide-react";

import { ChannelDonut } from "@/components/admin/dashboard/channel-donut";
import { DailyMenuPreview } from "@/components/admin/dashboard/daily-menu-preview";
import { DashboardHeader } from "@/components/admin/dashboard/dashboard-header";
import { HealthGauges } from "@/components/admin/dashboard/health-gauges";
import { HourlyHeatmap } from "@/components/admin/dashboard/hourly-heatmap";
import { PaymentMixDonut } from "@/components/admin/dashboard/payment-mix-donut";
import { RecentOrders } from "@/components/admin/dashboard/recent-orders";
import { RevenueChart } from "@/components/admin/dashboard/revenue-chart";
import { SalonStatsSection } from "@/components/admin/dashboard/salon-stats";
import { StatTile } from "@/components/admin/dashboard/stat-tile";
import { TopProductsList } from "@/components/admin/dashboard/top-products-list";
import { PageShell } from "@/components/admin/shell/page-shell";
import { ensureAdminAccess } from "@/lib/admin/context";
import { getAdminDailyMenus } from "@/lib/admin/daily-menu-query";
import {
  getDashboardOverview,
  getDashboardProfit,
  getHourlyHeatmap,
  getPaymentMix,
} from "@/lib/admin/dashboard-query";
import { getTodayOrders } from "@/lib/admin/orders-query";
import { getSalonStats } from "@/lib/admin/reports-query";
import { currentDayOfWeek } from "@/lib/day-of-week";
import { formatCurrency } from "@/lib/currency";
import { canSee } from "@/lib/permissions/sections";
import { getBusiness } from "@/lib/tenant";

function trend(
  today: number,
  yesterday: number,
): { direction: "up" | "down" | "flat"; label: string } {
  if (yesterday === 0 && today === 0) {
    return { direction: "flat", label: "sin datos ayer" };
  }
  if (yesterday === 0) {
    return { direction: "up", label: "primer día" };
  }
  const diff = today - yesterday;
  const pct = Math.round((diff / yesterday) * 100);
  const direction: "up" | "down" | "flat" =
    diff > 0 ? "up" : diff < 0 ? "down" : "flat";
  const sign = diff > 0 ? "+" : "";
  return { direction, label: `${sign}${pct}% vs ayer` };
}

export default async function AdminDashboardPage({
  params,
}: {
  params: Promise<{ business_slug: string }>;
}) {
  const { business_slug } = await params;
  const business = await getBusiness(business_slug);
  if (!business) notFound();

  const ctx = await ensureAdminAccess(business.id, business_slug);

  // Dashboard = analítica del negocio (ingresos, márgenes, CMV): admin/dueño.
  // Quien no lo ve arranca en Operación — y ese gate resuelve el resto
  // (mozo/personal caen de ahí a /mozo). Ver matriz en sections.ts.
  if (!canSee("dashboard", ctx.role, { isPlatformAdmin: ctx.isPlatformAdmin })) {
    redirect(`/${business_slug}/admin/operacion`);
  }

  const [overview, heatmap, menus, orders, salon, profit, paymentMix] =
    await Promise.all([
      getDashboardOverview(business.id, business.timezone),
      getHourlyHeatmap(business.id, business.timezone),
      getAdminDailyMenus(business.id),
      getTodayOrders(business.id, business.timezone),
      getSalonStats(business.id, business.timezone),
      getDashboardProfit(business.id, business.timezone),
      getPaymentMix(business.id, business.timezone),
    ]);

  const todayDow = currentDayOfWeek(business.timezone);

  return (
    <PageShell width="wide" className="space-y-8 sm:space-y-10">
      <DashboardHeader
        businessName={business.name}
        userName={ctx.userName}
        timezone={business.timezone}
        slug={business_slug}
        isActive={business.is_active ?? true}
      />

      <section className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-2 xl:grid-cols-6">
        <StatTile
          eyebrow="Pedidos hoy"
          value={overview.today.orderCount.toString()}
          sub="sin cancelados"
          icon={<Receipt className="size-4" strokeWidth={1.75} />}
          trend={trend(overview.today.orderCount, overview.yesterday.orderCount)}
          accent="brand"
        />
        <StatTile
          eyebrow="Ingresos hoy"
          value={formatCurrency(overview.today.revenueCents)}
          icon={<CircleDollarSign className="size-4" strokeWidth={1.75} />}
          trend={trend(
            overview.today.revenueCents,
            overview.yesterday.revenueCents,
          )}
        />
        <StatTile
          eyebrow="Ticket promedio"
          value={formatCurrency(overview.today.averageTicketCents)}
          icon={<Wallet className="size-4" strokeWidth={1.75} />}
          trend={trend(
            overview.today.averageTicketCents,
            overview.yesterday.averageTicketCents,
          )}
        />
        <StatTile
          eyebrow="Clientes nuevos"
          value={overview.today.newCustomerCount.toString()}
          sub="primer registro hoy"
          icon={<Users className="size-4" strokeWidth={1.75} />}
          trend={trend(
            overview.today.newCustomerCount,
            overview.yesterday.newCustomerCount,
          )}
        />
        <StatTile
          eyebrow="En curso"
          value={overview.today.activeOrderCount.toString()}
          sub={
            overview.today.activeOrderCount === 0
              ? "cocina tranquila"
              : "pedidos abiertos"
          }
          icon={<Flame className="size-4" strokeWidth={1.75} />}
        />
        <StatTile
          eyebrow="Cancelados hoy"
          value={overview.today.cancelledCount.toString()}
          sub="no facturados"
          icon={<Timer className="size-4" strokeWidth={1.75} />}
        />
      </section>

      <HealthGauges
        foodCostPct={profit.foodCostPct}
        grossMarginPct={profit.grossMarginPct}
        grossMarginCents={profit.grossMarginCents}
        hasCostData={profit.hasCostData}
      />

      <section className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-2">
        <StatTile
          eyebrow="CMV · 30 días"
          value={formatCurrency(profit.foodCostCents)}
          sub="costo de mercadería vendida"
          icon={<Coins className="size-4" strokeWidth={1.75} />}
        />
        <StatTile
          eyebrow="Merma · 30 días"
          value={formatCurrency(profit.mermaCents)}
          sub="insumos perdidos"
          icon={<Trash2 className="size-4" strokeWidth={1.75} />}
        />
      </section>

      <section className="grid gap-5 lg:grid-cols-5">
        <div className="lg:col-span-3">
          <RevenueChart data={overview.month.dailyRevenue} />
        </div>
        <div className="lg:col-span-2">
          <DailyMenuPreview
            slug={business_slug}
            menus={menus}
            todayDow={todayDow}
          />
        </div>
      </section>

      {salon.totalTables > 0 ? (
        <SalonStatsSection data={salon} />
      ) : null}

      <section className="grid gap-5 lg:grid-cols-2">
        <ChannelDonut data={overview.channelBreakdown} rangeDays={30} />
        <PaymentMixDonut data={paymentMix} />
      </section>

      <HourlyHeatmap
        cells={heatmap.cells}
        maxCount={heatmap.maxCount}
        totalOrders={heatmap.totalOrders}
        rangeDays={heatmap.rangeDays}
      />

      <section className="grid gap-5 lg:grid-cols-5">
        <div className="lg:col-span-3">
          <RecentOrders orders={orders} slug={business_slug} />
        </div>
        <div className="space-y-5 lg:col-span-2">
          <TopProductsList products={overview.topProducts} />
          <Link
            href={`/${business_slug}/admin/reportes`}
            className="group flex items-center justify-between rounded-2xl bg-zinc-900 p-5 text-zinc-50 transition hover:bg-zinc-800"
          >
            <div>
              <p className="text-[0.65rem] font-semibold uppercase tracking-[0.14em] text-zinc-400">
                Reportes
              </p>
              <p className="mt-1 text-base font-semibold">
                Analítica completa
              </p>
              <p className="mt-0.5 text-xs text-zinc-400">
                Rango custom · top productos · ingresos diarios
              </p>
            </div>
            <span className="flex size-9 items-center justify-center rounded-full bg-white/10 transition group-hover:bg-white/20">
              <ArrowUpRight className="size-4" />
            </span>
          </Link>
        </div>
      </section>
    </PageShell>
  );
}

export const dynamic = "force-dynamic";
