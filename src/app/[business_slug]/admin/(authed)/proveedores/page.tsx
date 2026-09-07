import { notFound, redirect } from "next/navigation";

import { PageShell } from "@/components/admin/shell/page-shell";
import { SuppliersShell } from "@/components/admin/proveedores/suppliers-shell";
import { ensureAdminAccess } from "@/lib/admin/context";
import { canSee } from "@/lib/permissions/sections";
import { getSuppliers, getIngredientsForLinking } from "@/lib/proveedores/queries";
import { getExpenseConcepts } from "@/lib/proveedores/cuenta-corriente-queries";
import { getCajaAdministrativa } from "@/lib/caja/queries";
import { getBusiness } from "@/lib/tenant";

export default async function ProveedoresPage({
  params,
}: {
  params: Promise<{ business_slug: string }>;
}) {
  const { business_slug } = await params;
  const business = await getBusiness(business_slug);
  if (!business) notFound();

  // Issue #247 — la única página de plata del admin que no tenía gate de
  // sección. El layout de `(authed)` deja pasar al mozo (por la Ayuda, spec
  // 142) y al terminal (por Operación, spec 140) contando con que "cada otra
  // página lo sigue rebotando por su propio gate" —el comentario está en
  // `sections.test.ts`—, y ésta no rebotaba a nadie: las cuatro queries de abajo
  // corren con service role, así que la lista de proveedores, los saldos y el
  // catálogo de conceptos se renderizaban para cualquiera que tipeara la URL.
  // La matriz ya decía `mozo: none, terminal: none`; sólo faltaba usarla.
  const ctx = await ensureAdminAccess(business.id, business_slug);
  if (!canSee("proveedores", ctx.role, { isPlatformAdmin: ctx.isPlatformAdmin })) {
    redirect(`/${business_slug}/admin`);
  }

  const [suppliers, ingredientOptions, concepts, cajaAdministrativa] = await Promise.all([
    getSuppliers(business.id),
    getIngredientsForLinking(business.id),
    // Todos, no sólo los activos: el ABM de la 162 necesita ver los apagados,
    // y el selector de compra filtra en el cliente.
    getExpenseConcepts(business.id),
    getCajaAdministrativa(business.id),
  ]);

  return (
    <PageShell width="default">
      <SuppliersShell
        slug={business_slug}
        businessId={business.id}
        suppliers={suppliers}
        ingredientOptions={ingredientOptions}
        concepts={concepts}
        cajaAdministrativa={cajaAdministrativa && { name: cajaAdministrativa.name }}
      />
    </PageShell>
  );
}

export const dynamic = "force-dynamic";
