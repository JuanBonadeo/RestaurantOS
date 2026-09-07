"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { editarComprobante } from "@/lib/proveedores/cuenta-corriente-actions";
import type { ComprobanteConSaldo } from "@/lib/proveedores/cuenta-corriente";

import type { ConceptOption } from "./invoice-dialog";

/**
 * Corregir un comprobante — spec 163.
 *
 * La guarda está partida y **se ve**: con pagos vivos, los campos de plata
 * quedan deshabilitados con el motivo escrito, en vez de desaparecer o de
 * fallar recién al guardar. El server la vuelve a chequear igual: filtrar un
 * `<input>` no cierra un POST directo.
 */
export function EditarComprobanteDialog({
  slug,
  comprobante,
  conceptos,
  tienePagoVivo,
  onClose,
}: {
  slug: string;
  comprobante: ComprobanteConSaldo;
  conceptos: ConceptOption[];
  tienePagoVivo: boolean;
  onClose: () => void;
}) {
  const [conceptId, setConceptId] = useState(comprobante.expense_concept_id ?? "");
  const [numero, setNumero] = useState(comprobante.invoice_number ?? "");
  const [venc, setVenc] = useState(comprobante.due_date ?? "");
  const [total, setTotal] = useState(String(comprobante.total_cents / 100));
  const [fecha, setFecha] = useState(comprobante.invoice_date);
  const [pending, start] = useTransition();

  function guardar() {
    const input: Record<string, unknown> = {
      id: comprobante.id,
      expense_concept_id: conceptId || null,
      invoice_number: numero.trim() || null,
      due_date: venc || null,
    };

    if (!tienePagoVivo) {
      const cents = Math.round(Number(total.replace(",", ".")) * 100);
      if (!Number.isFinite(cents)) {
        toast.error("El importe no es un número.");
        return;
      }
      input.total_cents = cents;
      input.invoice_date = fecha;
    }

    start(async () => {
      const r = await editarComprobante(slug, input);
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      toast.success("Comprobante corregido.");
      onClose();
    });
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Corregir comprobante</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="ec-concepto">Concepto de gasto</Label>
            <select
              id="ec-concepto"
              value={conceptId}
              onChange={(e) => setConceptId(e.target.value)}
              className="h-9 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm"
            >
              <option value="">Sin concepto</option>
              {conceptos.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1.5">
              <Label htmlFor="ec-numero">Nº de comprobante</Label>
              <Input
                id="ec-numero"
                value={numero}
                onChange={(e) => setNumero(e.target.value)}
                placeholder="A-0001-00012345"
                maxLength={50}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ec-venc">Vence</Label>
              <Input
                id="ec-venc"
                type="date"
                value={venc}
                onChange={(e) => setVenc(e.target.value)}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1.5">
              <Label htmlFor="ec-total">Importe</Label>
              <Input
                id="ec-total"
                value={total}
                onChange={(e) => setTotal(e.target.value)}
                disabled={tienePagoVivo}
                inputMode="decimal"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ec-fecha">Fecha</Label>
              <Input
                id="ec-fecha"
                type="date"
                value={fecha}
                onChange={(e) => setFecha(e.target.value)}
                disabled={tienePagoVivo}
              />
            </div>
          </div>

          {tienePagoVivo && (
            <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800">
              Este comprobante ya tiene pagos: el importe y la fecha no se tocan.
              Para cambiarlos hay que anular el pago primero.
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={pending}>
            Cancelar
          </Button>
          <Button onClick={guardar} disabled={pending}>
            {pending ? "Guardando…" : "Guardar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
