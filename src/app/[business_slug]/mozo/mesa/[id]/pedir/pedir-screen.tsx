"use client";

import { MozoPedirClient } from "./pedir-client";
import { MesaRouteSkeleton } from "@/components/skeletons/mesa-route-skeleton";
import type { ComandaConItems } from "@/lib/comandas/queries";
import type { BusinessRole } from "@/lib/admin/context";
import { useCatalogBundle } from "@/lib/mozo/use-catalog-bundle";

/**
 * Envuelve la pantalla de "pedir" resolviendo el **catálogo desde el cache del
 * dispositivo** (spec 105) en vez de recibirlo por props del server.
 *
 * Antes, el bundle business-level —catálogo, sectores, menús del día, top—
 * viajaba en el payload RSC de **cada** apertura de mesa: ~195 kB que no
 * cambian entre mesa y mesa. Ahora la ruta manda sólo lo de la mesa (su orden
 * abierta y sus comandas, que es chico) y el catálogo sale de
 * `useCatalogBundle`: instantáneo desde la segunda apertura del turno.
 *
 * El wrapper existe para no meterle estados de carga al cliente de 2200 líneas:
 * mientras no hay bundle se muestra el skeleton que ya usa el `loading.tsx` de
 * esta ruta, así la transición es la misma que el mozo ya conoce.
 */
export function MozoPedirScreen({
  slug,
  table,
  existingComandas,
  role,
  homeHref,
}: {
  slug: string;
  table: {
    id: string;
    label: string;
    operational_status: string;
    opened_at: string | null;
  };
  existingComandas: ComandaConItems[];
  role: BusinessRole;
  homeHref?: string;
}) {
  const { bundle, error } = useCatalogBundle(slug);

  if (!bundle) {
    if (error) {
      return (
        <div className="mx-auto flex max-w-md flex-col items-center justify-center gap-3 p-8 text-center">
          <p className="text-sm font-semibold text-red-800">{error}</p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="rounded-full bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700"
          >
            Reintentar
          </button>
        </div>
      );
    }
    return <MesaRouteSkeleton variant="pedir" />;
  }

  return (
    <MozoPedirClient
      slug={slug}
      businessName={bundle.businessName}
      table={table}
      catalog={bundle.catalog}
      stationNameById={bundle.stationNameById}
      existingComandas={existingComandas}
      topProductIds={bundle.topProductIds}
      dailyMenus={bundle.dailyMenus}
      role={role}
      homeHref={homeHref}
    />
  );
}
