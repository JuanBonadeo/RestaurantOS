import { gateSection } from "@/lib/permissions/section-gate";

/**
 * Gate de la sección `pedidos` (spec 167 · D1). Cubre todas las páginas de
 * `pedidos/`, incluidas las que todavía no existen.
 */
export default async function PedidosLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ business_slug: string }>;
}) {
  const { business_slug } = await params;
  await gateSection("pedidos", business_slug);
  return children;
}
