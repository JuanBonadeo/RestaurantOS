import { notFound, redirect } from "next/navigation";
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";

import { CierresClient } from "@/components/admin/local/cierres-client";
import { PageHeader, PageShell } from "@/components/admin/shell/page-shell";
import { ensureAdminAccess } from "@/lib/admin/context";
import { getAllCajasForBusiness, getCortesDelRango } from "@/lib/caja/queries";
import { canHacerCorte } from "@/lib/permissions/can";
import { getBusiness } from "@/lib/tenant";

export const dynamic = "force-dynamic";

const AR_TZ = "America/Argentina/Buenos_Aires";

/** `yyyy-MM-dd` (en la TZ del negocio) → los bordes del día en UTC. */
function bordesDelDia(desde: string, hasta: string, tz: string) {
  return {
    from: fromZonedTime(`${desde}T00:00:00`, tz).toISOString(),
    to: fromZonedTime(`${hasta}T23:59:59.999`, tz).toISOString(),
  };
}

export default async function CierresPage({
  params,
  searchParams,
}: {
  params: Promise<{ business_slug: string }>;
  searchParams: Promise<{ desde?: string; hasta?: string; caja?: string }>;
}) {
  const { business_slug } = await params;
  const sp = await searchParams;
  const business = await getBusiness(business_slug);
  if (!business) notFound();

  const ctx = await ensureAdminAccess(business.id, business_slug);
  // El mismo círculo que puede cerrar la caja: encargado y admin.
  //
  // A propósito NO se reusa `canSee("operacion", …)` como hace el libro: esa
  // matriz le da `limited` al rol `terminal` —la compu compartida del salón—
  // y la spec 140 · D2 decidió que ese puesto no ve la plata de supervisión.
  if (!ctx.isPlatformAdmin && (ctx.role === null || !canHacerCorte(ctx.role))) {
    redirect(`/${business_slug}/admin/operacion`);
  }

  const tz = business.timezone || AR_TZ;
  const hoy = formatInTimeZone(new Date(), tz, "yyyy-MM-dd");
  // Una semana para atrás: un cierre se mira al día siguiente, pero la pregunta
  // «¿cuánto viene faltando?» necesita más de un día a la vista.
  const haceUnaSemana = formatInTimeZone(
    new Date(Date.now() - 6 * 24 * 60 * 60 * 1000),
    tz,
    "yyyy-MM-dd",
  );
  const desde = sp.desde ?? haceUnaSemana;
  const hasta = sp.hasta ?? hoy;
  const { from, to } = bordesDelDia(desde, hasta, tz);

  const [cajas, cortes] = await Promise.all([
    getAllCajasForBusiness(business.id),
    getCortesDelRango(business.id, { from, to, cajaId: sp.caja || null }),
  ]);

  return (
    <PageShell width="wide">
      <PageHeader
        eyebrow="Caja"
        title="Cierres de caja"
        description="Cada cierre queda archivado con los números del turno que cerró. Entrá a uno para ver de dónde salía el efectivo esperado, qué se contó y qué se retiró."
        back={{ href: `/${business_slug}/admin/operacion?tab=caja`, label: "Operación" }}
      />
      <CierresClient
        slug={business_slug}
        timezone={tz}
        cajas={cajas.map((c) => ({ id: c.id, name: c.name }))}
        cortes={cortes}
        filtros={{ desde, hasta, caja: sp.caja ?? "" }}
      />
    </PageShell>
  );
}
