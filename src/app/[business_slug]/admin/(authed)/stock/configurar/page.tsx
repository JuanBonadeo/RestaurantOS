import { notFound, redirect } from "next/navigation";

import { PageHeader, PageShell } from "@/components/admin/shell/page-shell";
import { ensureAdminAccess, canManageBusiness } from "@/lib/admin/context";
import { getAllProductsForConfig } from "@/lib/stock/queries";
import { getBusiness } from "@/lib/tenant";

import { StockConfigClient } from "./stock-config-client";

export const dynamic = "force-dynamic";

export default async function StockConfigPage({
  params,
}: {
  params: Promise<{ business_slug: string }>;
}) {
  const { business_slug } = await params;
  const business = await getBusiness(business_slug);
  if (!business) notFound();

  const ctx = await ensureAdminAccess(business.id, business_slug);
  // Spec 167 — acá decía `void canManageBusiness(ctx)`: llamaba a la guarda y
  // tiraba el resultado, así que parecía defendida y no defendía nada. Un mozo
  // entraba tipeando la URL (probado). El gate de la sección vive ahora en
  // `stock/layout.tsx`; esto es la capa de adentro, que sí mira lo que pregunta.
  if (!canManageBusiness(ctx)) {
    redirect(`/${business_slug}/admin`);
  }

  const products = await getAllProductsForConfig(business.id);

  return (
    <PageShell width="default">
      <PageHeader
        eyebrow="Stock"
        title="Configurar productos"
        description="Activá el tracking de stock para los productos que querés controlar. Al activar, ingresá el stock inicial y el mínimo."
        back={{
          href: `/${business_slug}/admin/catalogo?tab=stock`,
          label: "Stock",
        }}
      />
      <StockConfigClient products={products} slug={business_slug} />
    </PageShell>
  );
}
