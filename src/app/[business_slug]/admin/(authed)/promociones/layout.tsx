import { gateSection } from "@/lib/permissions/section-gate";

/**
 * Gate de la sección `promociones` (spec 167 · D1). Cubre todas las páginas de
 * `promociones/`, incluidas las que todavía no existen.
 */
export default async function PromocionesLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ business_slug: string }>;
}) {
  const { business_slug } = await params;
  await gateSection("promociones", business_slug);
  return children;
}
