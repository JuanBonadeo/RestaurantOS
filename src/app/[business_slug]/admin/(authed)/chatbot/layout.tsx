import { gateSection } from "@/lib/permissions/section-gate";

/**
 * Gate de la sección `chatbot` (spec 167 · D1). Cubre todas las páginas de
 * `chatbot/`, incluidas las que todavía no existen.
 * deja pasar al encargado en «limited»: el panel recortado lo decide la página.
 */
export default async function ChatbotLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ business_slug: string }>;
}) {
  const { business_slug } = await params;
  await gateSection("chatbot", business_slug);
  return children;
}
