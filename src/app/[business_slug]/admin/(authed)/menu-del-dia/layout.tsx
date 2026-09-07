import { gateSection } from "@/lib/permissions/section-gate";

/**
 * Gate de la sección `catalogo` (spec 167 · D1). Cubre todas las páginas de
 * `menu-del-dia/`, incluidas las que todavía no existen.
 * se fusionó en «Productos e inventario».
 */
export default async function MenuDelDiaLayout({
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
