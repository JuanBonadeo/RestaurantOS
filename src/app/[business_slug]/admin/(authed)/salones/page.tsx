import { notFound } from "next/navigation";

import { SalonesList } from "@/components/admin/salones/salones-list";
import { PageHeader, PageShell } from "@/components/admin/shell/page-shell";
import { ensureAdminAccess } from "@/lib/admin/context";
import { getFloorPlansForBusiness } from "@/lib/admin/floor-plan/queries";
import { sectionAccess } from "@/lib/permissions/sections";
import { getBusiness } from "@/lib/tenant";

export default async function SalonesPage({
  params,
}: {
  params: Promise<{ business_slug: string }>;
}) {
  const { business_slug } = await params;
  const business = await getBusiness(business_slug);
  if (!business) notFound();

  const ctx = await ensureAdminAccess(business.id, business_slug);
  // Gestionar el plano (crear/editar/borrar salones) = acceso "full" a la
  // sección. Admin y encargado; el mozo ni entra al panel admin.
  const canManage =
    sectionAccess("salones", ctx.role, {
      isPlatformAdmin: ctx.isPlatformAdmin,
    }) === "full";

  const plans = await getFloorPlansForBusiness(business.id);

  return (
    <PageShell width="wide">
      <PageHeader
        eyebrow="Operación"
        title="Salones"
        description="Gestioná los planos del local. Cada salón tiene su propio dibujo de mesas y se usa para la toma de pedido y reservas."
      />
      <SalonesList
        slug={business_slug}
        plans={plans}
        canManage={canManage}
      />
    </PageShell>
  );
}

export const dynamic = "force-dynamic";
