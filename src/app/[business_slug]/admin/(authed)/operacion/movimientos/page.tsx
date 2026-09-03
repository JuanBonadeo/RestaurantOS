import { permanentRedirect } from "next/navigation";

/** `/admin/operacion/movimientos` → `/admin/caja/movimientos` (spec 153 · D2). */
export default async function MovimientosRedirect({
  params,
  searchParams,
}: {
  params: Promise<{ business_slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { business_slug } = await params;
  const sp = await searchParams;
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) {
    if (typeof v === "string") qs.set(k, v);
  }
  const cola = qs.toString();
  permanentRedirect(
    `/${business_slug}/admin/caja/movimientos${cola ? `?${cola}` : ""}`,
  );
}
