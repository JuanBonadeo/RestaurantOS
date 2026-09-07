import { gateSection } from "@/lib/permissions/section-gate";

/**
 * Gate de la sección `reservas` (spec 167 · D1). Cubre todas las páginas de
 * `reservas/`, incluidas las que todavía no existen.
 */
export default async function ReservasLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ business_slug: string }>;
}) {
  const { business_slug } = await params;
  await gateSection("reservas", business_slug);
  return children;
}
