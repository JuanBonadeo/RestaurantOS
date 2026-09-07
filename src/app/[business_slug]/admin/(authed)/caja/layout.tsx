import { gateSection } from "@/lib/permissions/section-gate";

/**
 * Gate de la sección `cajas` (spec 167 · D1). Cubre todas las páginas de
 * `caja/`, incluidas las que todavía no existen.
 * la 153 renombró la ruta a singular; la sección quedó en plural.
 */
export default async function CajaLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ business_slug: string }>;
}) {
  const { business_slug } = await params;
  await gateSection("cajas", business_slug);
  return children;
}
