import { notFound, redirect } from "next/navigation";

import { CashControlCard } from "@/components/admin/reports/cash-control";
import { CategoryBreakdownSection } from "@/components/admin/reports/category-breakdown";
import { CustomersAnalysis } from "@/components/admin/reports/customers-analysis";
import { FiscalSummarySection } from "@/components/admin/reports/fiscal-summary";
import { MarketingSummarySection } from "@/components/admin/reports/marketing-summary";
import { MenuEngineeringSection } from "@/components/admin/reports/menu-engineering";
import { MozoLeaderboard } from "@/components/admin/reports/mozo-leaderboard";
import { PrepTimes } from "@/components/admin/reports/prep-times";
import { RangeSelector } from "@/components/admin/reports/range-selector";
import { ReservationFunnelSection } from "@/components/admin/reports/reservation-funnel";
import { RevenueChart } from "@/components/admin/reports/revenue-chart";
import { StationTimingsSection } from "@/components/admin/reports/station-timings";
import { PriceOverridesSection } from "@/components/admin/reports/price-overrides";
import { SupplierOutflowSection } from "@/components/admin/reports/supplier-outflow";
import { SummaryCards } from "@/components/admin/reports/summary-cards";
import { TopProducts } from "@/components/admin/reports/top-products";
import { PageHeader, PageShell } from "@/components/admin/shell/page-shell";
import { getCashControl } from "@/lib/admin/dashboard-query";
import { getMenuEngineering } from "@/lib/admin/profit-query";
import {
  getFiscalSummary,
  getMarketingSummary,
  getStationTimings,
} from "@/lib/admin/reports-extra-query";
import {
  getReportData,
  REPORT_RANGES,
  type ReportRange,
  type ReportRangeInput,
} from "@/lib/admin/reports-query";
import { getMozoPerformance } from "@/lib/admin/staff-query";
import { ensureAdminAccess } from "@/lib/admin/context";
import { canSee } from "@/lib/permissions/sections";
import { getPriceOverrides } from "@/lib/admin/price-overrides-query";
import { getSupplierProductOutflow } from "@/lib/proveedores/queries";
import { getBusiness } from "@/lib/tenant";

export default async function ReportesPage({
  params,
  searchParams,
}: {
  params: Promise<{ business_slug: string }>;
  searchParams: Promise<{ range?: string; start?: string; end?: string }>;
}) {
  const { business_slug } = await params;
  const { range: rawRange, start: startParam, end: endParam } =
    await searchParams;
  const business = await getBusiness(business_slug);
  if (!business) notFound();

  // Reportes = solo admin/dueño (datos sensibles: fiscal, márgenes). El
  // encargado no entra ni por URL. Ver matriz en sections.ts.
  const ctx = await ensureAdminAccess(business.id, business_slug);
  if (!canSee("reportes", ctx.role, { isPlatformAdmin: ctx.isPlatformAdmin })) {
    redirect(`/${business_slug}/admin`);
  }

  let rangeInput: ReportRangeInput;
  let activeRange: ReportRange | "custom";

  if (startParam && endParam) {
    rangeInput = { start: startParam, end: endParam };
    activeRange = "custom";
  } else {
    const preset: ReportRange = (REPORT_RANGES as readonly string[]).includes(
      rawRange ?? "",
    )
      ? (rawRange as ReportRange)
      : "7d";
    rangeInput = preset;
    activeRange = preset;
  }

  const data = await getReportData(business.id, business.timezone, rangeInput);
  const { startIso, endIso } = data.summary;

  const [
    menuEng,
    mozos,
    cash,
    fiscal,
    marketing,
    stations,
    supplierOutflow,
    priceOverrides,
  ] = await Promise.all([
      getMenuEngineering(business.id, startIso, endIso),
      getMozoPerformance(business.id, startIso, endIso),
      getCashControl(business.id, startIso, endIso),
      getFiscalSummary(business.id, startIso, endIso),
      getMarketingSummary(business.id, startIso, endIso),
      getStationTimings(business.id, startIso, endIso),
      getSupplierProductOutflow(business.id, startIso, endIso),
      getPriceOverrides(business.id, startIso, endIso),
    ]);

  const isEmpty =
    data.summary.orderCount === 0 && data.summary.cancelledCount === 0;

  return (
    <PageShell width="wide" className="space-y-8">
      <PageHeader
        eyebrow="Analítica"
        title="Reportes"
        description="Cómo viene el negocio: ingresos, clientes, catálogo y reservas con comparación contra el período anterior."
        action={
          <RangeSelector
            slug={business_slug}
            active={activeRange}
            customStart={startParam}
            customEnd={endParam}
          />
        }
      />

      <SummaryCards summary={data.summary} comparison={data.comparison} />

      {isEmpty ? (
        <p className="rounded-2xl bg-white p-10 text-center text-sm italic text-zinc-500 ring-1 ring-zinc-200/70">
          No hay pedidos en el período seleccionado.
        </p>
      ) : (
        <>
          <div className="grid gap-5 lg:grid-cols-[2fr_1fr]">
            <RevenueChart data={data.revenueByDay} />
            <TopProducts products={data.topProducts} />
          </div>

          <MenuEngineeringSection data={menuEng} />

          <MozoLeaderboard data={mozos} />

          <CustomersAnalysis data={data.customers} />

          <div className="grid gap-5 lg:grid-cols-2">
            {data.categories.length > 0 ? (
              <CategoryBreakdownSection data={data.categories} />
            ) : null}
            <PrepTimes data={data.prepTimes} />
          </div>

          <StationTimingsSection data={stations} />

          <PriceOverridesSection
            data={priceOverrides}
            timezone={business.timezone}
          />
          <SupplierOutflowSection data={supplierOutflow} />

          <div className="grid gap-5 lg:grid-cols-2">
            <FiscalSummarySection data={fiscal} />
            <MarketingSummarySection data={marketing} />
          </div>

          <CashControlCard data={cash} />

          {data.reservationFunnel ? (
            <ReservationFunnelSection data={data.reservationFunnel} />
          ) : null}
        </>
      )}
    </PageShell>
  );
}

export const dynamic = "force-dynamic";
