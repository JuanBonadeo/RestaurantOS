import { notFound, redirect } from "next/navigation";

import { EntidadesFiscalesClient } from "@/components/admin/facturacion/entidades-fiscales-client";
import { PageHeader, PageShell } from "@/components/admin/shell/page-shell";
import { ensureAdminAccess } from "@/lib/admin/context";
import { listFiscalEntities } from "@/lib/afip/fiscal-entities";
import { canGestionarEntidadesFiscales } from "@/lib/permissions/can";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { getBusiness } from "@/lib/tenant";

export const dynamic = "force-dynamic";

/**
 * Entidades fiscales — el ABM de a quién se le factura (spec 150).
 *
 * Vive en **Facturación** y no en la ficha del cliente, que es otra cosa: al
 * comensal lo identifica el teléfono y al receptor el CUIT, y son poblaciones
 * casi disjuntas (7 de 410 coinciden). Acá entra el encargado, que es quien
 * factura.
 */
export default async function EntidadesFiscalesPage({
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
  // Mismo círculo que factura y anula (#139): el encargado entra, el mozo no.
  const puedeGestionar =
    ctx.isPlatformAdmin ||
    (ctx.role != null && canGestionarEntidadesFiscales(ctx.role));
  if (!puedeGestionar) redirect(`/${business_slug}/admin/facturacion`);

  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q : "";
  const page = Math.max(1, Number(sp.page) || 1);

  const service = createSupabaseServiceClient();
  const { entities, count, totalPages } = await listFiscalEntities(
    service,
    business.id,
    { search: q || undefined, page },
  );

  return (
    <PageShell width="default">
      <PageHeader
        eyebrow="Facturación"
        title="Entidades fiscales"
        description="A quién se le emite un comprobante: CUIT, razón social y condición de IVA. Se cargan solas al facturar un CUIT nuevo."
        back={{ href: `/${business_slug}/admin/facturacion`, label: "Facturación" }}
      />
      <EntidadesFiscalesClient
        slug={business_slug}
        entities={entities}
        count={count}
        page={page}
        totalPages={totalPages}
        q={q}
      />
    </PageShell>
  );
}
