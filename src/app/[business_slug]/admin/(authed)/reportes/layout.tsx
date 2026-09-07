import { gateSection } from "@/lib/permissions/section-gate";

/**
 * Gate de la sección `reportes` (spec 167 · D1). Cubre todas las páginas de
 * `reportes/`, incluidas las que todavía no existen.
 */
export default async function ReportesLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ business_slug: string }>;
}) {
  const { business_slug } = await params;
  await gateSection("reportes", business_slug);
  return children;
}
