import { gateSection } from "@/lib/permissions/section-gate";

/**
 * Gate de la sección `operacion` (spec 167 · D1). Cubre todas las páginas de
 * `mesa/`, incluidas las que todavía no existen.
 * el detalle de mesa del admin es Operación.
 */
export default async function MesaLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ business_slug: string }>;
}) {
  const { business_slug } = await params;
  await gateSection("operacion", business_slug);
  return children;
}
