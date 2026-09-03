import { notFound, redirect } from "next/navigation";

import { EntidadFiscalDetalle } from "@/components/admin/facturacion/entidad-fiscal-detalle";
import { PageHeader, PageShell } from "@/components/admin/shell/page-shell";
import { ensureAdminAccess } from "@/lib/admin/context";
import { getFiscalEntity } from "@/lib/afip/fiscal-entities";
import { listInvoices } from "@/lib/afip/queries";
import { canGestionarEntidadesFiscales } from "@/lib/permissions/can";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { getBusiness } from "@/lib/tenant";

export const dynamic = "force-dynamic";

/**
 * Una entidad fiscal: sus datos (editables) y lo que se le facturó.
 *
 * El listado de facturas es lo que la encargada necesita para la liquidación
 * mensual del sanatorio, y recién existe porque `invoices.fiscal_entity_id`
 * vincula el comprobante con su receptor (D5).
 */
export default async function EntidadFiscalPage({
  params,
}: {
  params: Promise<{ business_slug: string; id: string }>;
}) {
  const { business_slug, id } = await params;
  const business = await getBusiness(business_slug);
  if (!business) notFound();

  const ctx = await ensureAdminAccess(business.id, business_slug);
  // Mismo círculo que factura y anula (#139): el encargado entra, el mozo no.
  const puedeGestionar =
    ctx.isPlatformAdmin ||
    (ctx.role != null && canGestionarEntidadesFiscales(ctx.role));
  if (!puedeGestionar) redirect(`/${business_slug}/admin/facturacion`);

  const service = createSupabaseServiceClient();
  const entidad = await getFiscalEntity(service, business.id, id);
  if (!entidad) notFound();

  const { invoices, count } = await listInvoices({
    businessId: business.id,
    fiscalEntityId: entidad.id,
    limit: 50,
  });

  return (
    <PageShell width="default">
      <PageHeader
        eyebrow="Entidad fiscal"
        title={entidad.razon_social}
        size="compact"
        back={{
          href: `/${business_slug}/admin/facturacion/entidades`,
          label: "Entidades fiscales",
        }}
      />
      <EntidadFiscalDetalle
        slug={business_slug}
        entidad={entidad}
        invoices={invoices}
        count={count}
      />
    </PageShell>
  );
}
