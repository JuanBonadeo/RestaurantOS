import { notFound, redirect } from "next/navigation";

import { FacturacionClient } from "@/components/admin/facturacion/facturacion-client";
import { PageHeader, PageShell } from "@/components/admin/shell/page-shell";
import { ensureAdminAccess } from "@/lib/admin/context";
import { canSee } from "@/lib/permissions/sections";
import { getInvoiceKPIs, listInvoices } from "@/lib/afip/queries";
import type { InvoiceStatus, TipoComprobante } from "@/lib/afip/types";
import { getBusiness } from "@/lib/tenant";

export const dynamic = "force-dynamic";

type RangeKey = "today" | "7d" | "30d" | "all";

function rangeToDates(range: RangeKey): { from?: string; to?: string } {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  switch (range) {
    case "today":
      return { from: todayStart.toISOString() };
    case "7d":
      return { from: new Date(todayStart.getTime() - 6 * 86_400_000).toISOString() };
    case "30d":
      return { from: new Date(todayStart.getTime() - 29 * 86_400_000).toISOString() };
    default:
      return {};
  }
}

export default async function FacturacionPage({
  params,
  searchParams,
}: {
  params: Promise<{ business_slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { business_slug } = await params;
  const business = await getBusiness(business_slug);
  if (!business) notFound();

  const ctx = await ensureAdminAccess(business.id, business_slug);
  // Gate por sección, no por `canManageBusiness` (#139): el encargado entra —
  // es quien cobra y quien tiene que reintentar o anular un comprobante. La
  // config AFIP no vive acá, vive en `configuracion` (admin-only).
  if (!canSee("facturacion", ctx.role, { isPlatformAdmin: ctx.isPlatformAdmin }))
    redirect(`/${business_slug}/admin`);

  const sp = await searchParams;
  const range = (["today", "7d", "30d", "all"].includes(sp.range as string)
    ? sp.range
    : "30d") as RangeKey;
  const status = (sp.status as InvoiceStatus) || undefined;
  const tipo = (sp.tipo as TipoComprobante) || undefined;
  const q = typeof sp.q === "string" ? sp.q : "";
  const page = Math.max(1, Number(sp.page) || 1);

  const dates = rangeToDates(range);
  const biz = business as Record<string, unknown>;
  const afipConfigured = !!(biz.afip_cuit && biz.afip_punto_venta);

  const [invoiceResult, kpis] = await Promise.all([
    listInvoices({
      businessId: business.id,
      status,
      tipo,
      from: dates.from,
      to: dates.to,
      search: q || undefined,
      page,
    }),
    getInvoiceKPIs(business.id, dates.from, dates.to),
  ]);

  return (
    <PageShell width="default">
      <PageHeader
        eyebrow="Administración"
        title="Facturación"
        description="Comprobantes electrónicos AFIP"
      />
      <FacturacionClient
        slug={business_slug}
        invoices={invoiceResult.invoices}
        count={invoiceResult.count}
        page={invoiceResult.page}
        totalPages={invoiceResult.totalPages}
        kpis={kpis}
        afipConfigured={afipConfigured}
        currentFilters={{
          range,
          status: status ?? "",
          tipo: tipo ?? "",
          q,
          page,
        }}
      />
    </PageShell>
  );
}
