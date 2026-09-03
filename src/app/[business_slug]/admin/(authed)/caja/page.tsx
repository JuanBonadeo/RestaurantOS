import { notFound, redirect } from "next/navigation";

import { CajaShell } from "@/components/admin/caja/caja-shell";
import { PageShell } from "@/components/admin/shell/page-shell";
import { ensureAdminAccess } from "@/lib/admin/context";
import {
  getCajaLiveStats,
  getCajaUserAssignments,
  getCajasConEstado,
  getCortesDelRango,
} from "@/lib/caja/queries";
import { canSee } from "@/lib/permissions/sections";
import { getBusiness } from "@/lib/tenant";

import { CajasClient } from "./cajas-client";

export const dynamic = "force-dynamic";

const AR_TZ = "America/Argentina/Buenos_Aires";

export default async function CajaPage({
  params,
}: {
  params: Promise<{ business_slug: string }>;
}) {
  const { business_slug } = await params;
  const business = await getBusiness(business_slug);
  if (!business) notFound();

  const ctx = await ensureAdminAccess(business.id, business_slug);
  // Spec 153 · D6 — el encargado entra: acá vive también su historial.
  if (!canSee("cajas", ctx.role, { isPlatformAdmin: ctx.isPlatformAdmin })) {
    redirect(`/${business_slug}/admin/operacion`);
  }

  const cajas = await getCajasConEstado(business.id);

  // Spec 153 · D3 — la vista dejó de ser config pura. Lo que sigue es lo que
  // convierte «Caja Principal» en información: cuánto hay adentro, cómo cerró
  // la última vez y quién la opera. Todo ya se calculaba; no estaba junto.
  //
  // Las stats van en paralelo (una consulta por caja, como el board) y el
  // último corte sale de un solo `getCortesDelRango` sin filtro de caja.
  const [statsPorCaja, asignaciones, ultimosCortes] = await Promise.all([
    Promise.all(cajas.map((c) => getCajaLiveStats(c.id, business.id))),
    getCajaUserAssignments(business.id),
    getCortesDelRango(business.id, {
      // Un año para atrás alcanza para encontrar el último corte de cada caja
      // sin traer el historial entero de un local con años de operación.
      from: new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString(),
      to: new Date().toISOString(),
    }),
  ]);

  const ultimoPorCaja = new Map<string, (typeof ultimosCortes)[number]>();
  // Vienen del más nuevo al más viejo: el primero de cada caja es el suyo.
  for (const c of ultimosCortes) {
    if (!ultimoPorCaja.has(c.caja_id)) ultimoPorCaja.set(c.caja_id, c);
  }

  return (
    <PageShell width="wide">
      <CajaShell slug={business_slug} activa="cajas">
        <CajasClient
          slug={business_slug}
          timezone={business.timezone || AR_TZ}
          cajas={cajas.map((caja, i) => ({
            caja,
            stats: statsPorCaja[i],
            ultimoCorte: ultimoPorCaja.get(caja.id) ?? null,
            operadores: asignaciones
              .filter((a) => a.caja_id === caja.id)
              .map((a) => a.user_name ?? "Sin nombre"),
          }))}
          puedeConfigurar
        />
      </CajaShell>
    </PageShell>
  );
}
