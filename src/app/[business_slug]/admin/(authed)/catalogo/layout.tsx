import { gateSection } from "@/lib/permissions/section-gate";

/**
 * Gate de la sección `catalogo` (spec 167 · D1). Cubre todas las páginas de
 * `catalogo/`, incluidas las que todavía no existen.
 */
export default async function CatalogoLayout({
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
