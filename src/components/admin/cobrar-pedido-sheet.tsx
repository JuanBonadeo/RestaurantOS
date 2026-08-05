"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import {
  ComprobanteFields,
  comprobanteEsValido,
  comprobanteInicial,
  comprobanteToInvoiceInput,
  type ComprobanteState,
} from "@/components/billing/comprobante-fields";
import { CobroForm } from "@/components/billing/cobro-form";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import type { AdminOrder } from "@/lib/admin/orders-query";
import { emitInvoice } from "@/lib/afip/emit-invoice";
import {
  iniciarCobro,
  iniciarPagoMp,
  registrarPago,
  type IniciarCobroResult,
} from "@/lib/billing/cobro-actions";
import { useCajaPreferida } from "@/lib/caja/use-caja-preferida";
import { formatCurrency } from "@/lib/currency";

/**
 * Cobrar / facturar un pedido para llevar o delivery **sin mesa**, desde el
 * board (spec 054).
 *
 * Ya no tiene formulario propio: monta el `CobroForm` compartido (spec 062).
 * Ese cambio es el que trae lo que acá faltaba — **el recargo/descuento por
 * método**, que hacía que el mismo negocio cobrara la misma tarjeta a distinto
 * precio en la mesa y en el pedido —, más pago mixto, propina, MP y la guarda
 * de efectivo.
 *
 * Lo que queda propio de este caller: de dónde sale lo que hay que cobrar
 * (`iniciarCobro` sobre una orden sin `table_id`), qué action registra el pago
 * y cuándo se emite el comprobante.
 */
export function CobrarPedidoSheet({
  order,
  slug,
  open,
  onClose,
  onDone,
}: {
  order: AdminOrder;
  slug: string;
  open: boolean;
  onClose: () => void;
  /** Corre tras cobrar con éxito (ej: cerrar el detalle del pedido). */
  onDone?: () => void;
}) {
  const [init, setInit] = useState<IniciarCobroResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [cajaId, setCajaId] = useCajaPreferida(slug, init?.cajas ?? []);
  const [comprobante, setComprobante] = useState<ComprobanteState>(
    comprobanteInicial(),
  );

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setLoadError(null);
    iniciarCobro(order.id, slug).then((r) => {
      if (r.ok) {
        // La caja la resuelve `useCajaPreferida` cuando llega la lista.
        setInit(r.data);
      } else {
        setLoadError(r.error);
      }
      setLoading(false);
    });
  }, [open, order.id, slug]);

  // Lo que falta cobrar. Un pedido normalmente no tiene splits, pero si tuviera
  // un pago parcial el saldo es el que manda — no el total.
  const amountDueCents = init
    ? Math.max(0, init.order.total_cents - init.order.total_paid_cents)
    : order.total_cents;

  /** El comprobante es best-effort: si falla, el pago ya quedó registrado y se
   *  puede re-facturar desde Facturación. Nunca bloquea el cobro. */
  async function facturar() {
    if (!comprobanteEsValido(comprobante)) {
      toast.warning(
        "Pago registrado. Faltaba el CUIT para la Factura A — emitila desde Facturación.",
      );
      return;
    }
    const factura = await emitInvoice({
      orderId: order.id,
      slug,
      ...comprobanteToInvoiceInput(comprobante),
    });
    if (!factura.ok) {
      toast.warning(
        `Pago registrado. La factura no se emitió: ${factura.error}. Reintentá desde Facturación.`,
      );
    }
  }

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent
        side="right"
        showCloseButton
        className="flex w-full flex-col gap-0 p-0 sm:max-w-md"
      >
        <SheetTitle className="border-border/60 border-b px-5 py-4 text-lg font-bold">
          Cobrar pedido #{order.order_number}
        </SheetTitle>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {loading ? (
            <div className="flex h-32 items-center justify-center text-muted-foreground">
              <Loader2 className="size-6 animate-spin" />
            </div>
          ) : loadError ? (
            <div className="rounded-lg bg-rose-50 p-3 text-sm text-rose-800 ring-1 ring-rose-200">
              {loadError}
            </div>
          ) : init ? (
            <div className="space-y-5">
              <div className="flex items-baseline justify-between rounded-xl bg-muted/50 px-4 py-3">
                <span className="text-sm font-medium text-muted-foreground">
                  Total a cobrar
                </span>
                <span className="text-2xl font-extrabold tabular-nums">
                  {formatCurrency(amountDueCents)}
                </span>
              </div>

              <CobroForm
                amountDueCents={amountDueCents}
                cajas={init.cajas}
                cajaId={cajaId}
                onCajaChange={setCajaId}
                methodConfigs={init.methodConfigs}
                // spec 097 — la propina sale de la cuenta, no se tipea al
                // cobrar. En `editable` el monto quedaba en el saldo y la
                // propina se sumaba **por encima**, así que el pago guardaba
                // `amount` sin la plata que de verdad entró: el cadete volvía
                // con $11.000, la caja esperaba $10.000 y el arqueo cerraba con
                // sobrante todos los días.
                tip={{ mode: "fixed", cents: init.order.tip_cents ?? 0 }}
                onSubmit={(input) =>
                  registrarPago({
                    orderId: order.id,
                    splitId: null,
                    method: input.method,
                    amount_cents: input.amountCents,
                    tip_cents: input.tipCents,
                    caja_id: input.cajaId,
                    last_four: input.lastFour,
                    card_brand: input.cardBrand,
                    notes: input.notes,
                    adjustment_percent: input.adjustmentPercent,
                    adjustment_cents: input.adjustmentCents,
                    slug,
                    requestId: input.requestId,
                  })
                }
                onPaid={async () => {
                  await facturar();
                  toast.success(`Pedido #${order.order_number} cobrado.`);
                  onDone?.();
                  onClose();
                }}
                mp={{
                  start: (input) =>
                    iniciarPagoMp({
                      orderId: order.id,
                      splitId: null,
                      method: input.method,
                      amount_cents: input.amountCents,
                      tip_cents: input.tipCents,
                      caja_id: input.cajaId,
                      slug,
                    }).then((r) =>
                      r.ok
                        ? {
                            ok: true as const,
                            data: {
                              paymentId: r.data.paymentId,
                              initPoint: r.data.initPoint,
                            },
                          }
                        : r,
                    ),
                  onConfirmed: () => {
                    onDone?.();
                    onClose();
                  },
                }}
              />

              <div className="border-border/60 border-t pt-4">
                <ComprobanteFields
                  value={comprobante}
                  onChange={setComprobante}
                />
              </div>
            </div>
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}
