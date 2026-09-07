import { gateSection } from "@/lib/permissions/section-gate";

/**
 * Gate de la sección `ayuda` (spec 167 · D1). Cubre todas las páginas de
 * `ayuda/`, incluidas las que todavía no existen.
 */
export default async function AyudaLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ business_slug: string }>;
}) {
  const { business_slug } = await params;
  await gateSection("ayuda", business_slug);
  return children;
}
