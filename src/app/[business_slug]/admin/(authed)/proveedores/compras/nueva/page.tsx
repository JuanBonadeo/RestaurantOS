import { CargarCompraClient } from "./cargar-compra-client";
import { gateSection } from "@/lib/permissions/section-gate";
import { getIngredientsForLinking, getSuppliers } from "@/lib/proveedores/queries";
import { getExpenseConcepts } from "@/lib/proveedores/cuenta-corriente-queries";

/**
 * Cargar compra — spec 173.
 *
 * Es una página y no un diálogo porque el diálogo medía 384 px (`max-w-lg`
 * pierde contra el `sm:max-w-sm` del baseline de `DialogContent`, y
 * tailwind-merge no las considera en conflicto) y una lectura de 10 renglones
 * apila 2.300 px de contenido ahí adentro, con la foto ÚLTIMA, debajo de los
 * renglones: mientras se corregían las líneas, el papel no se veía.
 *
 * El permiso ya lo puso `proveedores/layout.tsx` con el mismo `gateSection`;
 * acá se lo llama de nuevo para tener el negocio y el contexto. No cuesta un
 * round-trip: `getBusiness` y `ensureAdminAccess` están envueltas en el
 * `cache()` de React justamente para que el layout y la página compartan la
 * resolución (spec 104).
 */
export default async function NuevaCompraPage({
  params,
  searchParams,
}: {
  params: Promise<{ business_slug: string }>;
  searchParams: Promise<{ proveedor?: string }>;
}) {
  const { business_slug } = await params;
  const { proveedor } = await searchParams;
  const { business } = await gateSection("proveedores", business_slug);

  const [suppliers, insumos, conceptos] = await Promise.all([
    getSuppliers(business.id),
    getIngredientsForLinking(business.id),
    // Sólo los activos: acá se está eligiendo el concepto de una compra nueva,
    // y un concepto apagado es uno que el negocio dejó de usar. El ABM de la
    // 162 los sigue viendo todos en su pestaña.
    getExpenseConcepts(business.id, true),
  ]);

  const fijadoId = proveedor ?? null;

  return (
    <CargarCompraClient
      slug={business_slug}
      businessId={business.id}
      // Los dados de baja no entran en el buscador —no se le carga una compra
      // nueva a un proveedor que se dejó de usar—, pero el que viene fijado por
      // la URL sí, aunque esté inactivo: se entró desde su ficha a propósito, y
      // un selector vacío con el proveedor ya elegido es peor que mostrarlo.
      proveedores={suppliers
        .filter((s) => s.isActive || s.id === fijadoId)
        .map((s) => ({
          id: s.id,
          name: s.name,
          cuit: s.cuit,
          defaultExpenseConceptId: s.defaultExpenseConceptId,
          paymentTermsDays: s.paymentTermsDays,
        }))}
      conceptos={conceptos.map((c) => ({ id: c.id, name: c.name, rubro: c.rubro }))}
      insumos={insumos}
      proveedorFijadoId={fijadoId}
    />
  );
}

export const dynamic = "force-dynamic";
