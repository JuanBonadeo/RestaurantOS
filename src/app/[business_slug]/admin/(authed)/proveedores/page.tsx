import { notFound } from "next/navigation";

import { PageShell } from "@/components/admin/shell/page-shell";
import { SuppliersShell } from "@/components/admin/proveedores/suppliers-shell";
import { getSuppliers, getIngredientsForLinking } from "@/lib/proveedores/queries";
import { getExpenseConcepts } from "@/lib/proveedores/cuenta-corriente-queries";
import { getCajasForBusiness } from "@/lib/caja/queries";
import { getBusiness } from "@/lib/tenant";

export default async function ProveedoresPage({
  params,
}: {
  params: Promise<{ business_slug: string }>;
}) {
  const { business_slug } = await params;
  const business = await getBusiness(business_slug);
  if (!business) notFound();

  const [suppliers, ingredientOptions, concepts, cajas] = await Promise.all([
    getSuppliers(business.id),
    getIngredientsForLinking(business.id),
    getExpenseConcepts(business.id, true),
    getCajasForBusiness(business.id),
  ]);

  return (
    <PageShell width="default">
      <SuppliersShell
        slug={business_slug}
        businessId={business.id}
        suppliers={suppliers}
        ingredientOptions={ingredientOptions}
        concepts={concepts}
        cajas={cajas.map((c) => ({ id: c.id, name: c.name }))}
      />
    </PageShell>
  );
}

export const dynamic = "force-dynamic";
