import { gateSection } from "@/lib/permissions/section-gate";

/**
 * Gate de la sección `facturacion` (spec 167 · D1). Cubre todas las páginas de
 * `facturacion/`, incluidas las que todavía no existen.
 */
export default async function FacturacionLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ business_slug: string }>;
}) {
  const { business_slug } = await params;
  await gateSection("facturacion", business_slug);
  return children;
}
