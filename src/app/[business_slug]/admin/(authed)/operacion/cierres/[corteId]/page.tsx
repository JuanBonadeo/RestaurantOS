import { notFound, redirect } from "next/navigation";

import { ResumenDeCierre } from "@/components/admin/local/resumen-de-cierre";
import { PageShell } from "@/components/admin/shell/page-shell";
import { ensureAdminAccess } from "@/lib/admin/context";
import { getResumenDeCorte } from "@/lib/caja/queries";
import { canHacerCorte } from "@/lib/permissions/can";
import { getBusiness } from "@/lib/tenant";

export const dynamic = "force-dynamic";

const AR_TZ = "America/Argentina/Buenos_Aires";

export default async function ResumenDeCierrePage({
  params,
}: {
  params: Promise<{ business_slug: string; corteId: string }>;
}) {
  const { business_slug, corteId } = await params;
  const business = await getBusiness(business_slug);
  if (!business) notFound();

  const ctx = await ensureAdminAccess(business.id, business_slug);
  if (!ctx.isPlatformAdmin && (ctx.role === null || !canHacerCorte(ctx.role))) {
    redirect(`/${business_slug}/admin/operacion`);
  }

  // El scope por negocio vive en la query: un `corteId` válido de OTRO negocio
  // vuelve `null` y cae en 404, no en «no encontrado» después de haberlo leído.
  const resumen = await getResumenDeCorte(corteId, business.id);
  if (!resumen) notFound();

  return (
    <PageShell width="wide">
      <ResumenDeCierre
        slug={business_slug}
        timezone={business.timezone || AR_TZ}
        resumen={resumen}
      />
    </PageShell>
  );
}
