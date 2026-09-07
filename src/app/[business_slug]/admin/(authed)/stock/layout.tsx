import { gateSection } from "@/lib/permissions/section-gate";

/**
 * Gate de la sección `catalogo` (spec 167 · D1). Cubre todas las páginas de
 * `stock/`, incluidas las que todavía no existen.
 * el stock de bebidas se fusionó en «Productos e inventario» (`?tab=stock`).
 */
export default async function StockLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ business_slug: string }>;
}) {
  const { business_slug } = await params;
  await gateSection("catalogo", business_slug);
  return children;
}
