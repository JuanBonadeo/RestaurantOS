import { gateSection } from "@/lib/permissions/section-gate";

/**
 * Gate de la sección `cajas` (spec 167 · D1). Cubre todas las páginas de
 * `cajas/`, incluidas las que todavía no existen.
 * es el redirect del link viejo a `caja/`.
 */
export default async function CajasLayout({
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
