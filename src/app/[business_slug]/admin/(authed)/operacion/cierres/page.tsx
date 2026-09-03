import { permanentRedirect } from "next/navigation";

/**
 * `/admin/operacion/cierres` → `/admin/caja/cierres` (spec 153 · D2).
 *
 * La spec 149 se implementó el mismo día que ésta, así que esta URL puede estar
 * pegada en una issue o en el historial de alguien. Se conservan los filtros.
 */
export default async function CierresRedirect({
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
  permanentRedirect(`/${business_slug}/admin/caja/cierres${cola ? `?${cola}` : ""}`);
}
