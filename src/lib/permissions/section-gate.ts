import { notFound, redirect } from "next/navigation";

import { ensureAdminAccess, type AdminContext } from "@/lib/admin/context";
import { canSee, type AdminSection } from "@/lib/permissions/sections";
import { getBusiness, type Business } from "@/lib/tenant";

/**
 * El gate de una sección del panel, para usar desde el `layout.tsx` de la
 * carpeta que la contiene (spec 167 · D1).
 *
 * Por qué en el layout y no en la página: el layout corre antes que **toda**
 * página de su subrama, incluidas las que todavía no se escribieron. Ese era el
 * modo de falla real — `reservas/configuracion/page.tsx` se agregó después de
 * la spec 140 y nadie se acordó de gatearla, mientras que las cinco páginas de
 * `configuracion/` nunca gatearon y están cubiertas igual porque su layout sí
 * lo hace. Esta función generaliza lo que `conversaciones/layout.tsx` (spec 32)
 * ya venía haciendo bien.
 *
 * No cuesta un round-trip extra: `getBusiness` y `ensureAdminAccess` están
 * envueltas en el `cache()` de React justamente para que el layout y la página
 * compartan la misma resolución (spec 104).
 *
 * La sección se pasa como literal, nunca derivada del nombre de la carpeta: el
 * mapeo no es 1:1 (`caja/` → `cajas`, `stock/` → `catalogo`, `mesa/` →
 * `operacion`) y derivarlo escondería justo los casos raros.
 */
export async function gateSection(
  section: AdminSection,
  businessSlug: string,
): Promise<{ business: Business; ctx: AdminContext }> {
  const business = await getBusiness(businessSlug);
  if (!business) notFound();

  const ctx = await ensureAdminAccess(business.id, businessSlug);
  const opts = { isPlatformAdmin: ctx.isPlatformAdmin };
  if (!canSee(section, ctx.role, opts)) {
    redirect(landingPath(businessSlug, ctx.role, opts));
  }

  return { business, ctx };
}

/**
 * A dónde mandar a quien no puede ver la sección que pidió.
 *
 * **El destino se calcula; no es fijo.** La primera versión de esta spec
 * redirigía siempre a `/{slug}/admin`, copiando lo que hacían `rrhh` y
 * `reportes`, y colgó el navegador en un ciclo infinito apenas se probó con un
 * mozo:
 *
 *     GET /demo/admin → GET /demo/admin/operacion → GET /demo/admin → …
 *
 * El dashboard rebota a Operación a quien no lo ve, y `operacion/layout.tsx`
 * rebotaba de vuelta al dashboard. Antes no pasaba porque quien cortaba la
 * cadena era `operacion/page.tsx`, mandando a `/mozo` — y un layout corre
 * **antes** que su página, así que ese corte dejó de existir en cuanto el gate
 * se mudó al layout. El bug es hijo directo de la decisión de mudarlo.
 *
 * Por construcción no puede haber ciclo: sólo se devuelve un destino que el rol
 * efectivamente ve, y nunca la sección que se acaba de rechazar.
 */
export function landingPath(
  businessSlug: string,
  role: AdminContext["role"],
  opts: { isPlatformAdmin: boolean },
): string {
  if (canSee("dashboard", role, opts)) return `/${businessSlug}/admin`;
  if (canSee("operacion", role, opts)) return `/${businessSlug}/admin/operacion`;
  // Mozo: su superficie es /mozo. Es lo que ya hacía `operacion/page.tsx`.
  return `/${businessSlug}/mozo`;
}
