"use client";

import { useState } from "react";
import { Plus } from "lucide-react";

import { AyudaChip } from "@/components/admin/ayuda-chip";
import { BrandButton } from "@/components/admin/shell/brand-button";
import { cn } from "@/lib/utils";
import type { SupplierWithStats } from "@/lib/proveedores/types";
import { SuppliersList } from "./suppliers-list";
import { SupplierStatsView } from "./supplier-stats";
import { VencimientosView } from "./vencimientos-view";
import { ProyeccionView } from "./proyeccion-view";
import { ConceptosView, type ConceptoRow } from "./conceptos-view";
import type { ConceptOption } from "./invoice-dialog";
import type { IngredientOption } from "@/lib/proveedores/queries";
import type { SaldoCajaAdministrativa } from "@/lib/caja/queries";
import { CajaMayorCard } from "./caja-mayor-card";

const TAB_LABELS: Record<Tab, string> = {
  lista: "Lista",
  vencimientos: "Vencimientos",
  proyeccion: "Proyección",
  estadistica: "Estadística",
  conceptos: "Conceptos",
};

type Props = {
  slug: string;
  businessId: string;
  suppliers: SupplierWithStats[];
  ingredientOptions: IngredientOption[];
  /** Todos, activos e inactivos: el selector de compra filtra, el ABM los muestra. */
  concepts: ConceptoRow[];
  cajaAdministrativa: { name: string } | null;
  /** spec 168 · el saldo de la Caja Mayor, para la tarjeta de arriba. */
  saldoCajaMayor: SaldoCajaAdministrativa | null;
  puedeFondear: boolean;
};

type Tab = "lista" | "vencimientos" | "proyeccion" | "estadistica" | "conceptos";

export function SuppliersShell({
  slug,
  businessId,
  suppliers,
  ingredientOptions,
  concepts,
  cajaAdministrativa,
  saldoCajaMayor,
  puedeFondear,
}: Props) {
  const [tab, setTab] = useState<Tab>("lista");

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1">
          <h1 className="text-xl font-bold text-zinc-900">Proveedores</h1>
          <AyudaChip slug={slug} tema="proveedores" />
        </div>
        <div className="flex items-center gap-2">
          <div className="inline-flex rounded-lg bg-zinc-100 p-0.5 text-xs font-semibold">
            {(["lista", "vencimientos", "proyeccion", "estadistica", "conceptos"] as const).map(
              (t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setTab(t)}
                  className={cn(
                    "rounded-md px-3 py-1.5 transition",
                    tab === t
                      ? "bg-white text-zinc-900 shadow-sm"
                      : "text-zinc-500 hover:text-zinc-900",
                  )}
                >
                  {TAB_LABELS[t]}
                </button>
              ),
            )}
          </div>
          {/* spec 173 · el botón general. Hasta acá, cargar una compra empezaba
              por acordarse del proveedor, buscarlo en la lista, entrar a su
              ficha y recién ahí apretar «Cargar compra» — cuatro pasos antes de
              tocar el papel que ya se tiene en la mano. Ahora el proveedor es un
              campo de la pantalla de carga, y la foto lo propone. */}
          <BrandButton
            href={`/${slug}/admin/proveedores/compras/nueva`}
            size="md"
            leadingIcon={<Plus />}
          >
            Cargar compra
          </BrandButton>
        </div>
      </div>

      {/* spec 168 · la plata con la que se les paga, antes que la lista de a
          quién. Es lo primero que el encargado necesita saber. */}
      <CajaMayorCard slug={slug} saldo={saldoCajaMayor} puedeFondear={puedeFondear} />

      {tab === "lista" ? (
        <SuppliersList
          slug={slug}
          businessId={businessId}
          suppliers={suppliers}
          ingredientOptions={ingredientOptions}
          concepts={concepts.filter((c) => c.is_active) as ConceptOption[]}
          cajaAdministrativa={cajaAdministrativa}
        />
      ) : tab === "vencimientos" ? (
        <VencimientosView businessId={businessId} />
      ) : tab === "proyeccion" ? (
        <ProyeccionView businessId={businessId} />
      ) : tab === "conceptos" ? (
        <ConceptosView slug={slug} conceptos={concepts} />
      ) : (
        <SupplierStatsView slug={slug} businessId={businessId} />
      )}
    </div>
  );
}
