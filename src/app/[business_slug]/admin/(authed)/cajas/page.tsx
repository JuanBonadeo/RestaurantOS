import { permanentRedirect } from "next/navigation";

/**
 * `/admin/cajas` → `/admin/caja` (spec 153 · D2).
 *
 * La sección dejó de ser sólo config y pasó a ser todo lo de la plata, así que
 * el nombre en singular es el que corresponde. El link viejo está en el sidebar
 * de sesiones abiertas y en marcadores.
 */
export default async function CajasRedirect({
  params,
}: {
  params: Promise<{ business_slug: string }>;
}) {
  const { business_slug } = await params;
  permanentRedirect(`/${business_slug}/admin/caja`);
}
