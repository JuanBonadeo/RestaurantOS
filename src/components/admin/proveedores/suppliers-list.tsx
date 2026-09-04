"use client";

import { useMemo, useState } from "react";
import { Plus, Search, Truck } from "lucide-react";
import { formatCurrency } from "@/lib/currency";
import { cn } from "@/lib/utils";
import type { SupplierWithStats } from "@/lib/proveedores/types";
import { BrandButton } from "@/components/admin/shell/brand-button";
import { Input } from "@/components/ui/input";
import { SupplierDialog } from "./supplier-dialog";
import { SupplierDetail } from "./supplier-detail";
import { ImportDialog } from "./import-dialog";
import type { ConceptOption } from "./invoice-dialog";

type Props = {
  slug: string;
  businessId: string;
  suppliers: SupplierWithStats[];
  ingredientOptions: { id: string; name: string; unit: string }[];
  concepts: ConceptOption[];
  cajas: { id: string; name: string }[];
};

export function SuppliersList({
  slug,
  businessId,
  suppliers,
  ingredientOptions,
  concepts,
  cajas,
}: Props) {
  const [search, setSearch] = useState("");
  const [filterActive, setFilterActive] = useState<"all" | "active" | "inactive">(
    "all",
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    let list = suppliers;
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(
        (s) =>
          s.name.toLowerCase().includes(q) ||
          s.cuit?.toLowerCase().includes(q) ||
          s.contact?.toLowerCase().includes(q),
      );
    }
    if (filterActive === "active") list = list.filter((s) => s.isActive);
    if (filterActive === "inactive") list = list.filter((s) => !s.isActive);
    return list;
  }, [suppliers, search, filterActive]);

  const selected = selectedId
    ? suppliers.find((s) => s.id === selectedId) ?? null
    : null;

  if (selected) {
    return (
      <SupplierDetail
        slug={slug}
        businessId={businessId}
        supplier={selected}
        ingredientOptions={ingredientOptions}
        concepts={concepts}
        cajas={cajas}
        onBack={() => setSelectedId(null)}
      />
    );
  }

  return (
    <div className="space-y-3">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Truck className="h-4 w-4 text-zinc-500" />
          <h2 className="text-base font-bold text-zinc-900">Proveedores</h2>
          <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-semibold tabular-nums text-zinc-600">
            {suppliers.length}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <ImportDialog slug={slug} />
          <SupplierDialog
            slug={slug}
            concepts={concepts}
            trigger={
              <BrandButton size="md" leadingIcon={<Plus />}>
                Nuevo proveedor
              </BrandButton>
            }
          />
        </div>
      </header>

      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400" />
          <Input
            placeholder="Buscar proveedor…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8"
          />
        </div>
        <div className="inline-flex rounded-lg bg-zinc-100 p-0.5 text-xs font-semibold">
          {(["all", "active", "inactive"] as const).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFilterActive(f)}
              className={cn(
                "rounded-md px-2.5 py-1 transition",
                filterActive === f
                  ? "bg-white text-zinc-900 shadow-sm"
                  : "text-zinc-500 hover:text-zinc-900",
              )}
            >
              {f === "all" ? "Todos" : f === "active" ? "Activos" : "Inactivos"}
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-2">
        {filtered.length === 0 ? (
          <div className="py-12 text-center text-sm text-zinc-500">
            Sin resultados.
          </div>
        ) : (
          filtered.map((supplier) => (
            <button
              key={supplier.id}
              type="button"
              onClick={() => setSelectedId(supplier.id)}
              className={cn(
                "flex items-center gap-4 rounded-xl border border-zinc-200 bg-white p-4 text-left transition",
                "hover:border-zinc-300 hover:shadow-sm",
                !supplier.isActive && "opacity-50",
              )}
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-zinc-900">
                  {supplier.name}
                </p>
                <p className="truncate text-xs text-zinc-500">
                  {[supplier.contact, supplier.phone].filter(Boolean).join(" · ") ||
                    "Sin contacto"}
                </p>
              </div>
              <div className="text-right">
                <p className="text-sm font-semibold tabular-nums text-zinc-900">
                  {formatCurrency(supplier.totalSpentCents)}
                </p>
                <p className="text-xs text-zinc-500">
                  {supplier.invoiceCount}{" "}
                  {supplier.invoiceCount === 1 ? "factura" : "facturas"}
                </p>
              </div>
            </button>
          ))
        )}
      </div>
    </div>
  );
}
