import { gateSection } from "@/lib/permissions/section-gate";

/**
 * Gate de la sección `clientes` (spec 167 · D1). Cubre todas las páginas de
 * `clientes/`, incluidas las que todavía no existen.
 */
export default async function ClientesLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ business_slug: string }>;
}) {
  const { business_slug } = await params;
  await gateSection("clientes", business_slug);
  return children;
}
