import { notFound, redirect } from "next/navigation";

import { CajaShell } from "@/components/admin/caja/caja-shell";
import { FiltroFechas } from "@/components/admin/caja/filtro-fechas";
import { LibroClient } from "@/components/admin/local/libro-client";
import { PageShell } from "@/components/admin/shell/page-shell";
import { ensureAdminAccess } from "@/lib/admin/context";
import { getCajasConEstado, getLibroDeMovimientos } from "@/lib/caja/queries";
import type { LibroTipo, PaymentMethod } from "@/lib/caja/types";
import { getMozosByBusiness } from "@/lib/mozo/queries";
import { canCorregirCobro } from "@/lib/permissions/can";
import {
  parseAncla,
  parseGranularidad,
  rangoDe,
} from "@/lib/caja/rango-fechas";
import { canSee } from "@/lib/permissions/sections";
import { getBusiness } from "@/lib/tenant";

export const dynamic = "force-dynamic";

const AR_TZ = "America/Argentina/Buenos_Aires";

export default async function MovimientosPage({
  params,
  searchParams,
}: {
  params: Promise<{ business_slug: string }>;
  searchParams: Promise<{
    gran?: string;
    fecha?: string;
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
  // Spec 153 · el libro se mudó a la sección Caja, así que ahora usa SU gate.
  // Antes usaba el de `operacion`, que le da `limited` al rol `terminal` — la
  // compu compartida del salón — y por ahí se le escapaba el libro entero
  // (issue #228). Con el gate de la sección eso se cierra.
  if (!canSee("cajas", ctx.role, { isPlatformAdmin: ctx.isPlatformAdmin })) {
    redirect(`/${business_slug}/admin/operacion`);
  }

  const tz = business.timezone || AR_TZ;
  const gran = parseGranularidad(sp.gran);
  const ancla = parseAncla(gran, sp.fecha, tz);
  const { from, to } = rangoDe(gran, ancla, tz);

  const [cajas, mozos, libro] = await Promise.all([
    // spec 160 · el filtro del libro tiene que poder aislar la caja administrativa.
    getCajasConEstado(business.id, true),
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
      <CajaShell slug={business_slug} activa="movimientos">
        <FiltroFechas
          basePath={`/${business_slug}/admin/caja/movimientos`}
          gran={gran}
          ancla={ancla}
          timezone={tz}
          extra={{
            caja: sp.caja,
            tipo: sp.tipo,
            metodo: sp.metodo,
            mozo: sp.mozo,
            q: sp.q,
          }}
        />
        <LibroClient
        slug={business_slug}
        cajas={cajas.map((c) => ({ id: c.id, name: c.name }))}
        mozos={mozos.map((m) => ({ id: m.user_id, name: m.full_name ?? "Sin nombre" }))}
        entries={libro.entries}
        totales={libro.totales}
        truncado={libro.truncado}
        filtros={{
          gran,
          fecha: ancla,
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
      </CajaShell>
    </PageShell>
  );
}
