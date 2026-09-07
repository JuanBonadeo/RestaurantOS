import { gateSection } from "@/lib/permissions/section-gate";

/**
 * Gate de la sección `proveedores` (spec 167 · D1). Cubre todas las páginas de
 * `proveedores/`, incluidas las que todavía no existen.
 */
export default async function ProveedoresLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ business_slug: string }>;
}) {
  const { business_slug } = await params;
  await gateSection("proveedores", business_slug);
  return children;
}
