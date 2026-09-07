import { gateSection } from "@/lib/permissions/section-gate";

/**
 * Gate de la sección `salones` (spec 167 · D1). Cubre todas las páginas de
 * `salones/`, incluidas las que todavía no existen.
 */
export default async function SalonesLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ business_slug: string }>;
}) {
  const { business_slug } = await params;
  await gateSection("salones", business_slug);
  return children;
}
