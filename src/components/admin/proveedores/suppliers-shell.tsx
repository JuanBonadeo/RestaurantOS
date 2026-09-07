"use client";

import { useState } from "react";
import { AyudaChip } from "@/components/admin/ayuda-chip";
import { cn } from "@/lib/utils";
import type { SupplierWithStats } from "@/lib/proveedores/types";
import { SuppliersList } from "./suppliers-list";
import { SupplierStatsView } from "./supplier-stats";
import { VencimientosView } from "./vencimientos-view";
import { ProyeccionView } from "./proyeccion-view";
import { ConceptosView, type ConceptoRow } from "./conceptos-view";
import type { ConceptOption } from "./invoice-dialog";

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
  ingredientOptions: { id: string; name: string; unit: string }[];
  /** Todos, activos e inactivos: el selector de compra filtra, el ABM los muestra. */
  concepts: ConceptoRow[];
  cajaAdministrativa: { name: string } | null;
};

type Tab = "lista" | "vencimientos" | "proyeccion" | "estadistica" | "conceptos";

export function SuppliersShell({
  slug,
  businessId,
  suppliers,
  ingredientOptions,
  concepts,
  cajaAdministrativa,
}: Props) {
  const [tab, setTab] = useState<Tab>("lista");

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1">
          <h1 className="text-xl font-bold text-zinc-900">Proveedores</h1>
          <AyudaChip slug={slug} tema="proveedores" />
        </div>
        <div className="inline-flex rounded-lg bg-zinc-100 p-0.5 text-xs font-semibold">
          {(["lista", "vencimientos", "proyeccion", "estadistica", "conceptos"] as const).map((t) => (
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
          ))}
        </div>
      </div>

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
