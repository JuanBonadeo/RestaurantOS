import { gateSection } from "@/lib/permissions/section-gate";

/**
 * Gate de la sección `rrhh` (spec 167 · D1). Cubre todas las páginas de
 * `rrhh/`, incluidas las que todavía no existen.
 */
export default async function RrhhLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ business_slug: string }>;
}) {
  const { business_slug } = await params;
  await gateSection("rrhh", business_slug);
  return children;
}
