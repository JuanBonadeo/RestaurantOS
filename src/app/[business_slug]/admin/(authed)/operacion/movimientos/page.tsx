import { notFound, redirect } from "next/navigation";
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";

import { LibroClient } from "@/components/admin/local/libro-client";
import { PageHeader, PageShell } from "@/components/admin/shell/page-shell";
import { ensureAdminAccess } from "@/lib/admin/context";
import { getCajasConEstado, getLibroDeMovimientos } from "@/lib/caja/queries";
import type { LibroTipo, PaymentMethod } from "@/lib/caja/types";
import { getMozosByBusiness } from "@/lib/mozo/queries";
import { canCorregirCobro } from "@/lib/permissions/can";
import { canSee } from "@/lib/permissions/sections";
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

export default async function MovimientosPage({
  params,
  searchParams,
}: {
  params: Promise<{ business_slug: string }>;
  searchParams: Promise<{
    desde?: string;
    hasta?: string;
    caja?: string;
    tipo?: string;
    metodo?: string;
    mozo?: string;
    q?: string;
  }>;
}) {
  const { business_slug } = await params;
  const sp = await searchParams;
  const business = await getBusiness(business_slug);
  if (!business) notFound();

  const ctx = await ensureAdminAccess(business.id, business_slug);
  // El libro es de quien audita la caja: encargado y admin. El mozo opera
  // desde /mozo y no ve la caja de nadie más.
  // Mismo gate que la página de Operación (spec 140).
  if (!canSee("operacion", ctx.role, { isPlatformAdmin: ctx.isPlatformAdmin })) {
    redirect(`/${business_slug}/mozo`);
  }

  const tz = business.timezone || AR_TZ;
  const hoy = formatInTimeZone(new Date(), tz, "yyyy-MM-dd");
  const desde = sp.desde ?? hoy;
  const hasta = sp.hasta ?? desde;
  const { from, to } = bordesDelDia(desde, hasta, tz);

  const [cajas, mozos, libro] = await Promise.all([
    getCajasConEstado(business.id),
    getMozosByBusiness(business.id),
    getLibroDeMovimientos(business.id, {
      from,
      to,
      cajaId: sp.caja || null,
      tipo: (sp.tipo as LibroTipo) || null,
      method: (sp.metodo as PaymentMethod) || null,
      mozoId: sp.mozo || null,
      search: sp.q || null,
    }),
  ]);

  return (
    <PageShell width="wide">
      <PageHeader
        eyebrow="Caja"
        title="Movimientos"
        description="Todas las líneas de caja del período elegido — cobros, sangrías e ingresos, incluidos los anulados. Desde acá el encargado corrige lo que se cargó mal."
      />
      <LibroClient
        slug={business_slug}
        cajas={cajas.map((c) => ({ id: c.id, name: c.name }))}
        mozos={mozos.map((m) => ({ id: m.user_id, name: m.full_name ?? "Sin nombre" }))}
        entries={libro.entries}
        totales={libro.totales}
        truncado={libro.truncado}
        filtros={{
          desde,
          hasta,
          caja: sp.caja ?? "",
          tipo: sp.tipo ?? "",
          metodo: sp.metodo ?? "",
          mozo: sp.mozo ?? "",
          q: sp.q ?? "",
        }}
        puedeCorregir={
          ctx.isPlatformAdmin || (ctx.role !== null && canCorregirCobro(ctx.role))
        }
        // Facturación es admin-only (matriz de secciones): al encargado se le
        // muestra el comprobante, pero el link no lo llevaría a ningún lado.
        esAdmin={ctx.isPlatformAdmin || ctx.role === "admin"}
      />
    </PageShell>
  );
}
