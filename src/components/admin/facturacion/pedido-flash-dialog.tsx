"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Receipt } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { emitInvoice } from "@/lib/afip/emit-invoice";
import { waitForInvoiceTerminal } from "@/lib/afip/poll";
import { crearPedidoFlash } from "@/lib/billing/pedido-flash";

type Props = {
  slug: string;
};

/**
 * Pedido flash (spec 09): factura un evento por monto total sin desglose. Crea
 * una orden de un único renglón (concepto libre) y emite la factura por ese
 * total, sin dar de alta el producto en la carta.
 *
 * En pantalla se llama **«Facturar un monto»**: «pedido flash» describía el
 * mecanismo (una orden de un renglón) y no el resultado, y la encargada de golf
 * lo buscaba como «cargar un artículo que no existe» —el botón equivalente de
 * MaxiRest— sin encontrarlo. Los identificadores quedan: renombrarlos arrastra
 * permisos, actions y specs para no cambiar nada que el usuario vea.
 */
export function PedidoFlashDialog({ slug }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [concepto, setConcepto] = useState("");
  const [monto, setMonto] = useState("");
  const [pending, startTransition] = useTransition();

  const reset = () => {
    setConcepto("");
    setMonto("");
  };

  const handleSubmit = () => {
    const conceptoTrim = concepto.trim();
    const montoNum = Number(monto.replace(",", "."));
    if (!conceptoTrim) {
      toast.error("Ingresá un concepto para facturar.");
      return;
    }
    if (!Number.isFinite(montoNum) || montoNum <= 0) {
      toast.error("Ingresá un monto mayor a 0.");
      return;
    }
    const montoCents = Math.round(montoNum * 100);

    startTransition(async () => {
      const created = await crearPedidoFlash({
        slug,
        concepto: conceptoTrim,
        montoCents,
      });
      if (!created.ok) {
        toast.error(created.error);
        return;
      }

      const invoiced = await emitInvoice({
        orderId: created.data.orderId,
        slug,
      });
      if (!invoiced.ok) {
        toast.error(
          `Monto registrado, pero la factura falló: ${invoiced.error}`,
        );
        router.refresh();
        return;
      }

      // El gateway es asíncrono: esperamos el CAE (o el rechazo) por polling.
      const terminal =
        invoiced.data.invoice.status === "pending"
          ? await waitForInvoiceTerminal(invoiced.data.invoice.id, slug)
          : invoiced.data.invoice;

      if (!terminal || terminal.status === "pending") {
        toast.message(
          "Monto registrado. La factura sigue en proceso en ARCA — revisá el listado en unos segundos.",
        );
      } else if (terminal.status === "authorized") {
        toast.success("Facturado.");
      } else {
        toast.error(
          `Monto registrado, pero la factura falló: ${terminal.error_message ?? "error"}`,
        );
      }
      reset();
      setOpen(false);
      router.refresh();
    });
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset();
      }}
    >
      <DialogTrigger
        render={
          <Button size="sm" variant="outline">
            <Receipt className="size-3.5" />
            Facturar un monto
          </Button>
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Facturar un monto</DialogTitle>
          <DialogDescription>
            Para lo que no está en la carta: un evento, un servicio, un acuerdo
            mensual. Va una sola línea con el concepto que escribas.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="flash-concepto">Concepto</Label>
            <Input
              id="flash-concepto"
              placeholder="Ej: Almuerzos médicos - agosto"
              value={concepto}
              onChange={(e) => setConcepto(e.target.value)}
              disabled={pending}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="flash-monto">Monto total (ARS)</Label>
            <Input
              id="flash-monto"
              inputMode="decimal"
              placeholder="250000"
              value={monto}
              onChange={(e) => setMonto(e.target.value)}
              disabled={pending}
            />
          </div>
        </div>

        <DialogFooter>
          <DialogClose render={<Button variant="outline" disabled={pending} />}>
            Cancelar
          </DialogClose>
          <Button onClick={handleSubmit} disabled={pending}>
            {pending ? "Facturando…" : "Crear y facturar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
