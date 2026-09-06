"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Ban, Link2, Pencil, Plus, Wallet } from "lucide-react";
import { formatCurrency } from "@/lib/currency";
import { cn } from "@/lib/utils";
import type { SupplierWithStats } from "@/lib/proveedores/types";
import type { SupplierInvoice, SupplierIngredientLink } from "@/lib/proveedores/types";
import {
  getSupplierInvoices,
  getSupplierIngredients,
  getCuentaDeProveedor,
} from "@/lib/proveedores/actions-client";
import {
  anularComprobante,
  anularPagoProveedor,
} from "@/lib/proveedores/cuenta-corriente-actions";
import { toast } from "sonner";
import type { CuentaDeProveedor } from "@/lib/proveedores/cuenta-corriente-queries";
import { Button } from "@/components/ui/button";
import { SupplierDialog } from "./supplier-dialog";
import { InvoiceDialog } from "./invoice-dialog";
import { IngredientLinkDialog } from "./ingredient-link-dialog";
import { PagoDialog } from "./pago-dialog";
import { CuentaCorrientePanel } from "./cuenta-corriente-panel";
import type { ConceptOption } from "./invoice-dialog";

type Props = {
  slug: string;
  businessId: string;
  supplier: SupplierWithStats;
  ingredientOptions: { id: string; name: string; unit: string }[];
  concepts: ConceptOption[];
  cajaAdministrativa: { name: string } | null;
  onBack: () => void;
};

export function SupplierDetail({
  slug,
  businessId,
  supplier,
  ingredientOptions,
  concepts,
  cajaAdministrativa,
  onBack,
}: Props) {
  const router = useRouter();
  const [invoices, setInvoices] = useState<SupplierInvoice[]>([]);
  const [ingredients, setIngredients] = useState<SupplierIngredientLink[]>([]);
  const [cuenta, setCuenta] = useState<CuentaDeProveedor | null>(null);
  const [loading, setLoading] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      const [invs, ings, cta] = await Promise.all([
        getSupplierInvoices(supplier.id, businessId),
        getSupplierIngredients(supplier.id, businessId),
        getCuentaDeProveedor(businessId, supplier.id),
      ]);
      if (!cancelled) {
        setInvoices(invs);
        setIngredients(ings);
        setCuenta(cta);
        setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [supplier.id, businessId, reloadKey]);

  // La ficha se pinta con datos traídos del cliente. Setearlos sueltos acá no
  // alcanza: `router.refresh()` llega después con props nuevas, remonta y pisa
  // lo seteado — así se veía "Sin facturas cargadas" con la compra ya guardada.
  // Subir el contador hace que la recarga pase por el mismo effect que la carga
  // inicial, que es el único que gana esa carrera.
  const refreshData = () => {
    setReloadKey((k) => k + 1);
    router.refresh();
  };

  const saldo = cuenta?.saldo_cents ?? 0;
  const impagos = cuenta?.impagos ?? [];
  // Del libro sólo se listan acá los pagos: los comprobantes ya tienen su lista
  // arriba, con la foto y el vencimiento.
  const pagos = (cuenta?.libro ?? []).filter((m) => m.tipo === "pago");

  const anular = async (que: "comprobante" | "pago", id: string) => {
    const motivo = window.prompt(
      que === "pago"
        ? "¿Por qué se anula el pago? (vuelve la deuda y se anula el egreso de caja)"
        : "¿Por qué se anula el comprobante?",
    );
    if (!motivo || motivo.trim().length < 3) return;
    const result =
      que === "pago"
        ? await anularPagoProveedor(slug, { id, reason: motivo })
        : await anularComprobante(slug, { id, reason: motivo });
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success(que === "pago" ? "Pago anulado." : "Comprobante anulado.");
    refreshData();
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ArrowLeft className="size-4" />
        </Button>
        <div className="flex-1">
          <h2 className="text-lg font-bold text-zinc-900">{supplier.name}</h2>
          <p className="text-sm text-zinc-500">
            {[supplier.cuit, supplier.contact, supplier.phone, supplier.email]
              .filter(Boolean)
              .join(" · ") || "Sin datos de contacto"}
          </p>
        </div>
        <InvoiceDialog
          slug={slug}
          supplierId={supplier.id}
          businessId={businessId}
          concepts={concepts}
          defaultConceptId={supplier.defaultExpenseConceptId}
          paymentTermsDays={supplier.paymentTermsDays}
          onSuccess={refreshData}
          trigger={
            <Button variant="outline" size="sm">
              <Plus className="size-3.5 mr-1.5" />
              Cargar compra
            </Button>
          }
        />
        <PagoDialog
          slug={slug}
          supplierId={supplier.id}
          supplierName={supplier.name}
          saldoCents={saldo}
          impagos={impagos}
          cajaAdministrativa={cajaAdministrativa}
          onSuccess={refreshData}
          trigger={
            <Button size="sm">
              <Wallet className="size-3.5 mr-1.5" />
              Pagar
            </Button>
          }
        />
        <SupplierDialog
          slug={slug}
          supplier={supplier}
          concepts={concepts}
          trigger={
            <Button variant="outline" size="sm">
              <Pencil className="size-3.5 mr-1.5" />
              Editar
            </Button>
          }
        />
      </div>

      {supplier.notes && (
        <p className="rounded-lg bg-zinc-50 p-3 text-sm text-zinc-600">
          {supplier.notes}
        </p>
      )}

      {/* Saldo primero: "cuánto le debo" es lo que se pregunta antes que nada. */}
      <div className="grid grid-cols-4 gap-3">
        <div
          className={cn(
            "rounded-xl border p-4",
            saldo > 0 ? "border-amber-200 bg-amber-50" : "bg-white",
          )}
        >
          <p className="text-xs font-medium text-zinc-500">
            {saldo < 0 ? "Saldo a favor" : "Se le debe"}
          </p>
          <p className="text-lg font-bold tabular-nums text-zinc-900">
            {formatCurrency(Math.abs(saldo))}
          </p>
        </div>
        <div className="rounded-xl border bg-white p-4">
          <p className="text-xs font-medium text-zinc-500">Impagos</p>
          <p className="text-lg font-bold tabular-nums text-zinc-900">
            {impagos.length}
          </p>
        </div>
        <div className="rounded-xl border bg-white p-4">
          <p className="text-xs font-medium text-zinc-500">Total comprado</p>
          <p className="text-lg font-bold tabular-nums text-zinc-900">
            {formatCurrency(supplier.totalSpentCents)}
          </p>
        </div>
        <div className="rounded-xl border bg-white p-4">
          <p className="text-xs font-medium text-zinc-500">Última compra</p>
          <p className="text-lg font-bold text-zinc-900">
            {supplier.lastInvoiceDate ?? "—"}
          </p>
        </div>
      </div>

      {/* spec 159 · la Cta. Cte. como el «Manejo Integral» de MaxiRest: período,
          compras con su saldo, y los pagos de la que se selecciona. */}
      {loading ? (
        <p className="py-6 text-center text-sm text-zinc-400">Cargando…</p>
      ) : (
        <CuentaCorrientePanel
          saldoCents={saldo}
          compras={cuenta?.compras ?? []}
          pagos={cuenta?.pagos ?? []}
          imputaciones={cuenta?.imputaciones ?? []}
          fotos={Object.fromEntries(invoices.map((i) => [i.id, i.photoSignedUrl]))}
          onAnularComprobante={(id) => anular("comprobante", id)}
        />
      )}

      {/* Pagos: el otro lado del libro. Lo anulado queda a la vista, tachado. */}
      {pagos.length > 0 && (
        <div className="space-y-3">
          <h3 className="flex items-center gap-2 text-sm font-bold text-zinc-900">
            <Wallet className="size-4 text-zinc-500" />
            Pagos
          </h3>
          <div className="divide-y rounded-xl border bg-white">
            {pagos.map((p) => (
              <div
                key={p.id}
                className={cn("flex items-center gap-4 p-3", p.anulado && "bg-zinc-50")}
              >
                <div className="min-w-0 flex-1">
                  <p
                    className={cn(
                      "text-sm font-medium text-zinc-900",
                      p.anulado && "line-through text-zinc-400",
                    )}
                  >
                    {p.detalle}
                  </p>
                  <p className="text-xs text-zinc-500">
                    {p.anulado ? "Anulado" : p.fecha}
                  </p>
                </div>
                <p
                  className={cn(
                    "text-sm font-semibold tabular-nums text-zinc-900",
                    p.anulado && "line-through text-zinc-400",
                  )}
                >
                  −{formatCurrency(p.amount_cents)}
                </p>
                {!p.anulado && (
                  <button
                    type="button"
                    onClick={() => anular("pago", p.id)}
                    className="shrink-0 rounded-md p-1.5 text-zinc-400 transition hover:bg-red-50 hover:text-red-600"
                    aria-label="Anular pago"
                  >
                    <Ban className="size-4" />
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Linked ingredients */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="flex items-center gap-2 text-sm font-bold text-zinc-900">
            <Link2 className="size-4 text-zinc-500" />
            Insumos que provee
          </h3>
          <IngredientLinkDialog
            slug={slug}
            supplierId={supplier.id}
            businessId={businessId}
            ingredientOptions={ingredientOptions}
            currentLinks={ingredients}
            onSuccess={refreshData}
          />
        </div>

        {loading ? (
          <p className="py-4 text-center text-sm text-zinc-400">Cargando…</p>
        ) : ingredients.length === 0 ? (
          <p className="py-4 text-center text-sm text-zinc-400">
            Sin insumos vinculados.
          </p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {ingredients.map((link) => (
              <span
                key={link.ingredientId}
                className="rounded-full bg-zinc-100 px-3 py-1 text-xs font-medium text-zinc-700"
              >
                {link.ingredientName} ({link.ingredientUnit})
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
