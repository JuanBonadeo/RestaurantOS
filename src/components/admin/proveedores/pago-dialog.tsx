"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { formatCurrency } from "@/lib/currency";
import { registrarPagoProveedor } from "@/lib/proveedores/cuenta-corriente-actions";
import { etiquetaTipo, type ComprobanteConSaldo } from "@/lib/proveedores/cuenta-corriente";
import { SUPPLIER_PAYMENT_METHODS } from "@/lib/proveedores/schema";

const METODOS: Record<(typeof SUPPLIER_PAYMENT_METHODS)[number], string> = {
  cash: "Efectivo",
  transfer: "Transferencia",
  card_manual: "Tarjeta",
  other: "Otro",
};

type Props = {
  slug: string;
  supplierId: string;
  supplierName: string;
  saldoCents: number;
  impagos: ComprobanteConSaldo[];
  cajas: { id: string; name: string }[];
  onSuccess?: () => void;
  trigger: React.ReactElement;
};

export function PagoDialog({
  slug,
  supplierId,
  supplierName,
  saldoCents,
  impagos,
  cajas,
  onSuccess,
  trigger,
}: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [seleccion, setSeleccion] = useState<Set<string>>(new Set());
  const [method, setMethod] =
    useState<(typeof SUPPLIER_PAYMENT_METHODS)[number]>("cash");
  const [cajaId, setCajaId] = useState<string>(cajas[0]?.id ?? "");
  const [montoPesos, setMontoPesos] = useState<string>("");
  const [montoTocado, setMontoTocado] = useState(false);

  // Lo tildado manda el importe mientras nadie lo edite: el caso normal es
  // cancelar lo que se debe, no tipear el mismo número dos veces.
  const totalSeleccionado = useMemo(
    () =>
      impagos
        .filter((c) => seleccion.has(c.id))
        .reduce((n, c) => n + c.saldo_cents, 0),
    [impagos, seleccion],
  );

  const amountCents = montoTocado
    ? Math.round((parseFloat(montoPesos) || 0) * 100)
    : totalSeleccionado;

  const aCuenta = amountCents - Math.min(amountCents, totalSeleccionado);

  const toggle = (id: string) => {
    setSeleccion((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    setMontoTocado(false);
  };

  const submit = async () => {
    if (amountCents <= 0) {
      toast.error("Poné un importe mayor a 0.");
      return;
    }
    setSubmitting(true);
    try {
      const result = await registrarPagoProveedor(slug, {
        supplier_id: supplierId,
        amount_cents: amountCents,
        method,
        caja_id: method === "cash" ? cajaId || null : null,
        invoice_ids: Array.from(seleccion),
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(
        result.data.a_cuenta_cents > 0
          ? `Pago registrado · ${formatCurrency(result.data.a_cuenta_cents)} quedaron a cuenta`
          : "Pago registrado.",
      );
      setOpen(false);
      setSeleccion(new Set());
      setMontoPesos("");
      setMontoTocado(false);
      router.refresh();
      onSuccess?.();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={trigger} />
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Pagar a {supplierName}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="rounded-lg bg-zinc-50 p-3">
            <p className="text-xs font-medium text-zinc-500">Saldo</p>
            <p className="text-lg font-bold tabular-nums text-zinc-900">
              {formatCurrency(saldoCents)}
              {saldoCents < 0 && (
                <span className="ml-2 text-xs font-medium text-emerald-700">a favor</span>
              )}
            </p>
          </div>

          {impagos.length > 0 ? (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold text-zinc-900">Qué se cancela</p>
                <button
                  type="button"
                  className="text-xs font-medium text-zinc-500 underline"
                  onClick={() => {
                    setSeleccion(
                      seleccion.size === impagos.length
                        ? new Set()
                        : new Set(impagos.map((c) => c.id)),
                    );
                    setMontoTocado(false);
                  }}
                >
                  {seleccion.size === impagos.length ? "Ninguno" : "Todos"}
                </button>
              </div>
              <ul className="divide-y rounded-xl border bg-white">
                {impagos.map((c) => (
                  <li key={c.id}>
                    <label className="flex cursor-pointer items-center gap-3 p-3">
                      <input
                        type="checkbox"
                        className="size-4"
                        checked={seleccion.has(c.id)}
                        onChange={() => toggle(c.id)}
                      />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-zinc-900">
                          {c.invoice_number?.trim()
                            ? `#${c.invoice_number.trim()}`
                            : etiquetaTipo(c.document_type ?? "interno")}
                        </p>
                        <p className="text-xs text-zinc-500">
                          Vence {c.due_date ?? c.invoice_date}
                        </p>
                      </div>
                      <p className="text-sm font-semibold tabular-nums text-zinc-900">
                        {formatCurrency(c.saldo_cents)}
                      </p>
                    </label>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="rounded-lg bg-zinc-50 p-3 text-sm text-zinc-500">
              No hay comprobantes impagos: lo que cargues queda como pago a cuenta.
            </p>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Total a pagar ($)</label>
              <Input
                type="number"
                step={1}
                value={montoTocado ? montoPesos : amountCents ? amountCents / 100 : ""}
                onChange={(e) => {
                  setMontoTocado(true);
                  setMontoPesos(e.target.value);
                }}
                placeholder="0"
              />
              {aCuenta > 0 && (
                <p className="text-xs text-amber-700">
                  {formatCurrency(aCuenta)} van a quedar a cuenta.
                </p>
              )}
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Medio</label>
              <select
                className="h-9 w-full rounded-md border border-zinc-200 bg-white px-2 text-sm"
                value={method}
                onChange={(e) =>
                  setMethod(e.target.value as (typeof SUPPLIER_PAYMENT_METHODS)[number])
                }
              >
                {SUPPLIER_PAYMENT_METHODS.map((m) => (
                  <option key={m} value={m}>
                    {METODOS[m]}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {method === "cash" && (
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Caja *</label>
              <select
                className="h-9 w-full rounded-md border border-zinc-200 bg-white px-2 text-sm"
                value={cajaId}
                onChange={(e) => setCajaId(e.target.value)}
              >
                <option value="">Elegí la caja</option>
                {cajas.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              <p className="text-xs text-zinc-500">
                Sale como egreso de esta caja y el arqueo del turno lo descuenta.
              </p>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button
            type="button"
            onClick={submit}
            disabled={submitting || amountCents <= 0 || (method === "cash" && !cajaId)}
          >
            {submitting ? "Registrando…" : `Pagar ${formatCurrency(amountCents)}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
