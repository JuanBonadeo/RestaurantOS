"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  Check,
  CheckCircle2,
  FileText,
  Loader2,
  RotateCcw,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";

import type { BusinessRole } from "@/lib/admin/context";
import {
  CONDICION_IVA_LABEL,
  condicionesValidasPara,
} from "@/lib/afip/condicion-iva";
import { emitInvoice, retryInvoice } from "@/lib/afip/emit-invoice";
import { waitForInvoiceTerminal } from "@/lib/afip/poll";
import type {
  CondicionIvaReceptor,
  Invoice,
  TipoComprobante,
} from "@/lib/afip/types";
import {
  anularCobro,
  iniciarPagoMp,
  registrarPago,
  type IniciarCobroResult,
} from "@/lib/billing/cobro-actions";
import {
  applyPayment,
  type CobroMergeState,
  type RegistrarPagoResult,
} from "@/lib/billing/split-merge";
import type { CuentaState, OrderSplit } from "@/lib/billing/types";
import { CobroForm } from "@/components/billing/cobro-form";
import type { PaymentMethodConfig } from "@/lib/caja/types";
import { useCajaPreferida } from "@/lib/caja/use-caja-preferida";
import { formatCurrency } from "@/lib/currency";
import { cn } from "@/lib/utils";

import { PageShell } from "@/components/admin/shell/page-shell";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";

type Props = {
  slug: string;
  tableId: string;
  tableLabel: string;
  role: BusinessRole;
  cuenta: CuentaState;
  init: IniciarCobroResult;
  existingInvoice: Invoice | null;
  afipConfigured: boolean;
};

export function CobrarClient({
  slug,
  tableId,
  tableLabel,
  role,
  cuenta,
  init,
  existingInvoice,
  afipConfigured,
}: Props) {
  const router = useRouter();

  // Estado local de cobro (spec 41). Reflejamos el pago que el server YA
  // persistió mergeando su fila, en vez de `router.refresh()`. `closed` lo
  // marca el server (lifecycle / orderClosed), nunca una suma del cliente.
  const buildInitial = useCallback(
    (): CobroMergeState => ({
      splits: init.hasImplicitSplit
        ? [
            implicitSplit(
              cuenta.order.id,
              cuenta.order.business_id,
              cuenta.totals.total_cents,
            ),
          ]
        : init.splits,
      appliedPaymentIds: [],
      closed: cuenta.order.lifecycle_status !== "open",
    }),
    [
      init,
      cuenta.order.id,
      cuenta.order.business_id,
      cuenta.order.lifecycle_status,
      cuenta.totals.total_cents,
    ],
  );

  const [merge, setMerge] = useState<CobroMergeState>(buildInitial);
  // Re-sync tras `router.refresh()` (MP / anulación): props nuevas del server
  // → resetear a su verdad, sin conservar merges viejos ni pagos ya contados.
  // En un merge local (efectivo/tarjeta) `init`/`cuenta` no cambian → no corre.
  useEffect(() => {
    setMerge(buildInitial());
  }, [buildInitial]);

  const splits = merge.splits;
  const closed = merge.closed;

  const [activeSplitId, setActiveSplitId] = useState<string | null>(null);
  const [cajaId, setCajaId] = useCajaPreferida(slug, init.cajas);
  const activeSplit = splits.find((s) => s.id === activeSplitId) ?? null;

  // Stats globales para el header.
  const total = cuenta.totals.total_cents;
  const splitsActivos = splits.filter((s) => s.status !== "cancelled");
  const totalPaid = splitsActivos.reduce(
    (acc, s) => acc + s.paid_amount_cents,
    0,
  );
  const totalPending = Math.max(0, total - totalPaid);
  const progressPct = total === 0 ? 0 : Math.min(100, (totalPaid / total) * 100);
  // Cobrado/cierre = señal del server, NO math del cliente (FR-005).
  const allPaid = closed;

  // Redirigir al salón cuando el server cierra la orden — pero SOLO si el
  // negocio no factura. Con AFIP configurado, la sección de facturación se
  // monta con la misma condición (`allPaid`) que dispara este timer, así que
  // el mozo tenía 1,5s para cargar CUIT y emitir: imposible, y por eso nunca
  // se emitió un comprobante (#136). Ahí sale a mano.
  useEffect(() => {
    if (closed && !afipConfigured) {
      const t = setTimeout(() => router.push(`/${slug}/mozo`), 1500);
      return () => clearTimeout(t);
    }
  }, [closed, afipConfigured, slug, router]);

  return (
    <div className="min-h-dvh bg-zinc-100/60 pb-12">
      {/* Top bar */}
      <header className="sticky top-0 z-20 border-b border-zinc-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-screen-md items-center gap-3 px-4 py-3">
          <button
            type="button"
            onClick={() =>
              router.push(`/${slug}/mozo/mesa/${tableId}/cuenta`)
            }
            className="inline-flex size-9 items-center justify-center rounded-full text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-900"
            aria-label="Volver a la cuenta"
          >
            <ArrowRight className="size-4 rotate-180" />
          </button>
          <div className="min-w-0 flex-1">
            <p className="text-[0.6rem] font-semibold uppercase tracking-[0.18em] text-zinc-500">
              {tableLabel}
            </p>
            <h1 className="text-base font-semibold tracking-tight text-zinc-900">
              Cobrar
            </h1>
          </div>
        </div>
      </header>

      <PageShell width="narrow" className="!py-4 sm:!py-6">
        {/* KPI principal: progreso global */}
        <section
          className="rounded-2xl p-5"
          style={{ background: "var(--brand-soft, #F4F4F5)" }}
        >
          <p className="text-[0.65rem] font-semibold uppercase tracking-[0.14em] text-zinc-600">
            {allPaid ? "Cobrado" : "Falta cobrar"}
          </p>
          <p className="mt-1 text-4xl font-bold tracking-tight text-zinc-900 tabular-nums">
            {formatCurrency(allPaid ? total : totalPending)}
          </p>
          <p className="mt-1 text-xs text-zinc-600">
            de {formatCurrency(total)} total
            {totalPaid > 0 && !allPaid && (
              <> · ya cobrado {formatCurrency(totalPaid)}</>
            )}
          </p>
          {/* Barra de progreso */}
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/80">
            <div
              className="h-full rounded-full transition-all"
              style={{
                width: `${progressPct}%`,
                background: allPaid
                  ? "rgb(16 185 129)" // emerald-500
                  : "var(--brand, #18181B)",
              }}
            />
          </div>
        </section>

        {/* Selector de caja (si hay >1 activa) */}
        {init.cajas.length > 1 && (
          <section className="rounded-2xl bg-white p-4 ring-1 ring-zinc-200/70">
            <Label className="text-[0.6rem] font-semibold uppercase tracking-[0.18em] text-zinc-500">
              Caja para registrar el cobro
            </Label>
            <Select
              value={cajaId}
              onValueChange={(v) => v && setCajaId(v)}
            >
              <SelectTrigger className="mt-1.5">
                <SelectValue placeholder="Seleccionar caja">
                  {init.cajas.find((c) => c.id === cajaId)?.name ?? "Caja"}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {init.cajas.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name || `Caja #${c.sort_order + 1}`}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </section>
        )}

        {/* Splits */}
        <section className="space-y-2.5">
          <p className="px-1 text-[0.6rem] font-semibold uppercase tracking-[0.18em] text-zinc-500">
            {splits.length === 1 ? "Pago único" : `${splits.length} sub-cuentas`}
          </p>
          <ul className="space-y-2.5">
            {splits.map((s) => (
              <li key={s.id}>
                <SplitRow
                  split={s}
                  onCobrar={() => setActiveSplitId(s.id)}
                  total={total}
                />
              </li>
            ))}
          </ul>
        </section>

        {/* Anular cobro (admin/encargado) */}
        {(role === "admin" || role === "encargado") && totalPaid > 0 && (
          <AnularCobroSection
            orderId={cuenta.order.id}
            slug={slug}
            onDone={() => router.push(`/${slug}/mozo`)}
          />
        )}

        {/* Mensaje al cerrar + facturación */}
        {allPaid && (
          <>
            <section className="flex items-center gap-3 rounded-2xl bg-emerald-50 p-4 ring-1 ring-emerald-200">
              <div className="flex size-10 items-center justify-center rounded-full bg-emerald-500 text-white">
                <CheckCircle2 className="size-5" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-emerald-900">
                  Mesa cobrada
                </p>
                <p className="text-xs text-emerald-700">
                  {afipConfigured
                    ? "Emití el comprobante o volvé al salón."
                    : "Volviendo al salón…"}
                </p>
              </div>
            </section>

            <FacturacionSection
              orderId={cuenta.order.id}
              totalCents={total}
              slug={slug}
              existingInvoice={existingInvoice}
            />

            {/* Sin auto-redirect (#136), la salida es explícita. */}
            {afipConfigured && (
              <Button
                variant="outline"
                className="h-12 w-full text-base"
                onClick={() => router.push(`/${slug}/mozo`)}
              >
                Listo, volver al salón
              </Button>
            )}
          </>
        )}
      </PageShell>

      {/* Sheet con métodos de pago */}
      {activeSplit && (
        <CobrarSplitSheet
          split={activeSplit}
          orderId={cuenta.order.id}
          cajaId={cajaId}
          slug={slug}
          isImplicit={init.hasImplicitSplit}
          methodConfigs={init.methodConfigs}
          orderTipCents={cuenta.order.tip_cents}
          onClose={() => setActiveSplitId(null)}
          onPaid={(result) => {
            setActiveSplitId(null);
            if (result) {
              // Efectivo/tarjeta: mergeamos la fila que el server persistió
              // (instantáneo, sin recargar). Nunca antes del `ok`.
              setMerge((prev) => applyPayment(prev, result, init.hasImplicitSplit));
            } else {
              // MP: lo registra el webhook, no hay fila local que mergear → refresh.
              router.refresh();
            }
          }}
        />
      )}
    </div>
  );
}

function implicitSplit(
  orderId: string,
  businessId: string,
  totalCents: number,
): OrderSplit {
  return {
    id: "__implicit__",
    order_id: orderId,
    business_id: businessId,
    split_mode: "por_personas",
    split_index: 0,
    expected_amount_cents: totalCents,
    paid_amount_cents: 0,
    status: "pending",
    label: null,
  };
}

// ── SplitRow: card grande con progreso por split ──────────────

function SplitRow({
  split,
  onCobrar,
  total,
}: {
  split: OrderSplit;
  onCobrar: () => void;
  total: number;
}) {
  const remaining = split.expected_amount_cents - split.paid_amount_cents;
  const done = split.status === "paid" || remaining <= 0;
  const cancelled = split.status === "cancelled";
  const pct =
    split.expected_amount_cents === 0
      ? 0
      : Math.min(
          100,
          (split.paid_amount_cents / split.expected_amount_cents) * 100,
        );

  return (
    <article
      className={cn(
        "flex items-center gap-3 rounded-2xl bg-white p-4 ring-1 transition",
        cancelled
          ? "opacity-50 ring-zinc-200/70"
          : done
            ? "ring-emerald-200 bg-emerald-50/40"
            : "ring-zinc-200/70",
      )}
    >
      <div
        className={cn(
          "flex size-10 flex-shrink-0 items-center justify-center rounded-full",
          done
            ? "bg-emerald-500 text-white"
            : cancelled
              ? "bg-zinc-100 text-zinc-400"
              : "bg-zinc-100 text-zinc-700",
        )}
      >
        {done ? (
          <Check className="size-5" />
        ) : (
          <span className="text-sm font-bold">
            {split.split_index === 0 ? "$" : split.split_index}
          </span>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-zinc-900">
          {split.split_index === 0
            ? "Mesa completa"
            : `Sub-cuenta ${split.split_index}`}
          <span className="ml-1 text-xs font-normal text-zinc-500 tabular-nums">
            · {formatCurrency(split.expected_amount_cents)}
          </span>
        </p>
        {!done && !cancelled && split.paid_amount_cents > 0 && (
          <>
            <p className="mt-0.5 text-xs text-zinc-500 tabular-nums">
              Pagado {formatCurrency(split.paid_amount_cents)} · falta{" "}
              <span className="font-semibold text-zinc-900">
                {formatCurrency(remaining)}
              </span>
            </p>
            <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-zinc-100">
              <div
                className="h-full rounded-full bg-zinc-900 transition-all"
                style={{ width: `${pct}%` }}
              />
            </div>
          </>
        )}
        {done && (
          <p className="mt-0.5 text-xs font-medium text-emerald-700">Cobrado</p>
        )}
        {cancelled && (
          <p className="mt-0.5 text-xs text-zinc-500">Cancelado</p>
        )}
      </div>
      {!done && !cancelled && (
        <button
          type="button"
          onClick={onCobrar}
          className="inline-flex items-center gap-1.5 rounded-full px-3 py-2 text-xs font-semibold transition hover:brightness-95 active:translate-y-px"
          style={{
            background: "var(--brand, #18181B)",
            color: "var(--brand-foreground, white)",
          }}
        >
          Cobrar
          <ArrowRight className="size-3.5" />
        </button>
      )}
    </article>
  );
}

// ── Sheet de cobro de un split ─────────────────────────────────

/**
 * Bottom-sheet de cobro del mozo. Es una cáscara sobre el `CobroForm`
 * compartido (spec 062): conserva el contenedor, el encabezado y la ergonomía
 * de una mano (`size="touch"`) — el formulario y las reglas de dinero salen del
 * componente común.
 *
 * Lo propio de este caller es el contrato de `onPaid`: con `result` se mergea
 * la fila que el server ya persistió (instantáneo, sin recargar la pantalla —
 * spec 41), y con `null` se refresca porque el pago lo registra el webhook de
 * MP. Esa diferencia es perf percibida deliberada, no una inconsistencia.
 */
function CobrarSplitSheet({
  split,
  orderId,
  cajaId,
  slug,
  isImplicit,
  methodConfigs,
  orderTipCents,
  onClose,
  onPaid,
}: {
  split: OrderSplit;
  orderId: string;
  cajaId: string;
  slug: string;
  isImplicit: boolean;
  methodConfigs: PaymentMethodConfig[];
  orderTipCents: number;
  onClose: () => void;
  /** `result` presente = efectivo/tarjeta (mergear); `null` = MP (refresh). */
  onPaid: (result: RegistrarPagoResult | null) => void;
}) {
  const remaining = split.expected_amount_cents - split.paid_amount_cents;

  return (
    <Sheet open onOpenChange={onClose}>
      <SheetContent
        side="right"
        className="!w-full !max-w-lg flex flex-col overflow-y-auto"
      >
        <SheetHeader className="border-b border-zinc-100 pb-4">
          <SheetTitle>
            Cobrar{" "}
            <span className="tabular-nums">{formatCurrency(remaining)}</span>
          </SheetTitle>
          <SheetDescription>
            {split.split_index === 0
              ? "Pago único de la mesa"
              : `Sub-cuenta ${split.split_index}`}
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 space-y-4 px-4 pb-6">
          {orderTipCents > 0 && (
            <div className="flex items-center justify-between rounded-xl bg-emerald-50 px-3 py-2.5 ring-1 ring-emerald-200/70">
              <span className="text-xs font-medium text-emerald-800">
                Propina incluida
              </span>
              <span className="text-sm font-bold tabular-nums text-emerald-700">
                {formatCurrency(orderTipCents)}
              </span>
            </div>
          )}

          <CobroForm
            amountDueCents={remaining}
            cajas={[]}
            cajaId={cajaId}
            methodConfigs={methodConfigs}
            size="touch"
            // La propina se carga en el paso Cuenta y viaja con la orden: acá
            // no se edita, sólo se muestra (hallazgo T002-2).
            tip={{ mode: "fixed", cents: orderTipCents }}
            onSubmit={(input) =>
              registrarPago({
                orderId,
                splitId: isImplicit ? null : split.id,
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
            onPaid={(data) => onPaid(data)}
            mp={{
              start: (input) =>
                iniciarPagoMp({
                  orderId,
                  splitId: isImplicit ? null : split.id,
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
              onConfirmed: () => onPaid(null),
            }}
          />
        </div>
      </SheetContent>
    </Sheet>
  );
}

// ── Anular cobro ──────────────────────────────────────────────

// ── Facturación AFIP (post-cobro) ─────────────────────────────

function FacturacionSection({
  orderId,
  totalCents,
  slug,
  existingInvoice,
}: {
  orderId: string;
  totalCents: number;
  slug: string;
  existingInvoice: Invoice | null;
}) {
  const [, startTransition] = useTransition();
  const [invoice, setInvoice] = useState<Invoice | null>(existingInvoice);
  const [tipoA, setTipoA] = useState(false);
  const [cuit, setCuit] = useState("");
  const [razonSocial, setRazonSocial] = useState("");
  // Condición de IVA del receptor (spec 053). Solo se envía cuando hay CUIT.
  const [condicionIva, setCondicionIva] = useState<CondicionIvaReceptor>(6);
  const [emitting, setEmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const tipo: TipoComprobante = tipoA ? "factura_a" : "factura_b";
  const cuitDigits = cuit.replace(/\D/g, "");
  const hasCuit = cuitDigits.length >= 11;
  // Los datos del receptor (CUIT, razón, condición) se piden en A siempre y en B
  // solo si el operador carga un CUIT (Factura B a un identificado).
  const showReceptor = tipoA || hasCuit;

  const handleEmit = () => {
    if (tipoA && !hasCuit) {
      toast.error("El CUIT debe tener 11 dígitos.");
      return;
    }
    // B con CUIT a medio cargar: exigir 11 dígitos o vaciarlo.
    if (!tipoA && cuitDigits.length > 0 && !hasCuit) {
      toast.error("El CUIT debe tener 11 dígitos (o dejalo vacío para consumidor final).");
      return;
    }
    setEmitting(true);
    setError(null);
    startTransition(async () => {
      const r = await emitInvoice({
        orderId,
        tipoComprobante: tipo,
        cuitReceptor: hasCuit ? cuitDigits : undefined,
        razonSocialReceptor: showReceptor && razonSocial ? razonSocial : undefined,
        condicionIvaReceptor: hasCuit ? condicionIva : undefined,
        slug,
      });
      if (!r.ok) {
        setEmitting(false);
        setError(r.error);
        toast.error(r.error);
        return;
      }
      await resolveInvoice(r.data.invoice);
    });
  };

  const handleRetry = (invoiceId: string) => {
    setEmitting(true);
    setError(null);
    startTransition(async () => {
      const r = await retryInvoice(invoiceId, slug);
      if (!r.ok) {
        setEmitting(false);
        setError(r.error);
        toast.error(r.error);
        return;
      }
      await resolveInvoice(r.data.invoice);
    });
  };

  // El gateway es asíncrono: `emit`/`retry` devuelven la factura `pending` y acá
  // la polleamos hasta el CAE (o el rechazo). El sandbox ya viene `authorized`.
  const resolveInvoice = async (initial: Invoice) => {
    setInvoice(initial);
    if (initial.status !== "pending") {
      setEmitting(false);
      if (initial.status === "authorized") toast.success("Factura emitida");
      return;
    }
    const terminal = await waitForInvoiceTerminal(initial.id, slug, {
      onUpdate: setInvoice,
    });
    setEmitting(false);
    if (!terminal || terminal.status === "pending") {
      toast.message("La factura sigue en proceso en ARCA. Reintentá en unos segundos.");
    } else if (terminal.status === "authorized") {
      toast.success("Factura emitida");
    } else {
      setError(terminal.error_message ?? "No se pudo emitir el comprobante");
      toast.error(terminal.error_message ?? "No se pudo emitir el comprobante");
    }
  };

  // Emisión en curso — el gateway está resolviendo el CAE (polling).
  if (invoice && invoice.status === "pending") {
    return (
      <section className="rounded-2xl bg-white p-4 ring-1 ring-amber-200">
        <div className="flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-full bg-amber-100 text-amber-700">
            <Loader2 className="size-5 animate-spin" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-zinc-900">
              Emitiendo comprobante…
            </p>
            <p className="text-xs text-zinc-500">
              ARCA está autorizando la factura. No cierres esta pantalla.
            </p>
          </div>
        </div>
      </section>
    );
  }

  // Ya facturada OK
  if (invoice && invoice.status === "authorized") {
    return (
      <section className="rounded-2xl bg-white p-4 ring-1 ring-zinc-200/70">
        <div className="flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
            <FileText className="size-5" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-zinc-900">
              {invoice.tipo_comprobante === "factura_a" ? "Factura A" : "Factura B"}{" "}
              <span className="font-normal text-zinc-500">
                #{String(invoice.punto_venta).padStart(4, "0")}-
                {String(invoice.numero).padStart(8, "0")}
              </span>
            </p>
            <p className="text-xs text-zinc-500">
              CAE: {invoice.cae} · {formatCurrency(invoice.total_cents)}
            </p>
          </div>
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[0.65rem] font-semibold text-emerald-800">
            <span className="size-1.5 rounded-full bg-emerald-500" />
            Emitida
          </span>
        </div>
        {invoice.pdf_url && (
          <a
            href={invoice.pdf_url}
            target="_blank"
            rel="noreferrer"
            className="mt-3 inline-flex items-center gap-1.5 text-xs font-semibold text-zinc-600 transition hover:text-zinc-900"
          >
            <FileText className="size-3" /> Ver PDF
          </a>
        )}
      </section>
    );
  }

  // Factura fallida — retry
  if (invoice && invoice.status === "failed") {
    return (
      <section className="rounded-2xl bg-white p-4 ring-1 ring-rose-200">
        <div className="flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-full bg-rose-100 text-rose-700">
            <FileText className="size-5" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-zinc-900">
              Factura no emitida
            </p>
            <p className="text-xs text-rose-600">
              {invoice.error_message ?? "Error al emitir el comprobante"}
            </p>
          </div>
          <button
            type="button"
            disabled={emitting}
            onClick={() => handleRetry(invoice.id)}
            className="inline-flex items-center gap-1.5 rounded-full bg-zinc-900 px-3 py-1.5 text-xs font-semibold text-white transition hover:brightness-95 disabled:opacity-50"
          >
            {emitting ? (
              <Loader2 className="size-3 animate-spin" />
            ) : (
              <RotateCcw className="size-3" />
            )}
            Reintentar
          </button>
        </div>
      </section>
    );
  }

  // Sin factura — formulario de emisión
  return (
    <section className="rounded-2xl bg-white p-4 ring-1 ring-zinc-200/70 space-y-3">
      <div className="flex items-center gap-3">
        <div className="flex size-10 items-center justify-center rounded-full bg-zinc-100 text-zinc-700">
          <FileText className="size-5" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-zinc-900">
            Emitir comprobante
          </p>
          <p className="text-xs text-zinc-500">
            Opcional — {formatCurrency(totalCents)}
          </p>
        </div>
      </div>

      {/* Toggle A/B */}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => {
            setTipoA(false);
            setCondicionIva(6); // B con CUIT: Monotributo por defecto
          }}
          className={cn(
            "flex-1 rounded-xl px-3 py-2.5 text-center text-xs font-semibold transition ring-1",
            !tipoA
              ? "bg-zinc-900 text-white ring-zinc-900"
              : "bg-white text-zinc-700 ring-zinc-200 hover:bg-zinc-50",
          )}
        >
          Factura B
          <span className="block text-[0.6rem] font-normal opacity-70">
            Consumidor final / Monotributo
          </span>
        </button>
        <button
          type="button"
          onClick={() => {
            setTipoA(true);
            setCondicionIva(1); // A: Responsable Inscripto por defecto
          }}
          className={cn(
            "flex-1 rounded-xl px-3 py-2.5 text-center text-xs font-semibold transition ring-1",
            tipoA
              ? "bg-zinc-900 text-white ring-zinc-900"
              : "bg-white text-zinc-700 ring-zinc-200 hover:bg-zinc-50",
          )}
        >
          Factura A
          <span className="block text-[0.6rem] font-normal opacity-70">
            Con CUIT
          </span>
        </button>
      </div>

      {/* Datos del receptor: CUIT (obligatorio en A, opcional en B) + razón +
          condición de IVA (spec 053). El CUIT en B habilita facturar B a un
          identificado (Monotributo/Exento) declarando su condición real. */}
      <div className="space-y-2.5">
        <div className="grid gap-1">
          <Label className="text-xs text-zinc-600">
            CUIT del cliente{" "}
            {tipoA ? (
              <span className="text-rose-600">*</span>
            ) : (
              <span className="text-zinc-400">(opcional)</span>
            )}
          </Label>
          <Input
            value={cuit}
            onChange={(e) => setCuit(e.target.value.replace(/[^\d\-]/g, ""))}
            placeholder="20-12345678-9"
            maxLength={13}
            inputMode="numeric"
          />
        </div>

        {showReceptor && (
          <>
            <div className="grid gap-1">
              <Label className="text-xs text-zinc-600">Razón social</Label>
              <Input
                value={razonSocial}
                onChange={(e) => setRazonSocial(e.target.value)}
                placeholder="Nombre de la empresa"
              />
            </div>
            <div className="grid gap-1">
              <Label className="text-xs text-zinc-600">
                Condición de IVA <span className="text-rose-600">*</span>
              </Label>
              <div className="grid grid-cols-2 gap-2">
                {condicionesValidasPara(tipo).map((value) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setCondicionIva(value)}
                    className={cn(
                      "rounded-xl px-3 py-2 text-center text-xs font-semibold transition ring-1",
                      condicionIva === value
                        ? "bg-zinc-900 text-white ring-zinc-900"
                        : "bg-white text-zinc-700 ring-zinc-200 hover:bg-zinc-50",
                    )}
                  >
                    {CONDICION_IVA_LABEL[value]}
                  </button>
                ))}
              </div>
            </div>
          </>
        )}
      </div>

      {error && (
        <p className="text-xs text-rose-600">{error}</p>
      )}

      <button
        type="button"
        disabled={emitting}
        onClick={handleEmit}
        className="flex w-full items-center justify-center gap-2 rounded-full px-4 py-2.5 text-sm font-semibold transition hover:brightness-95 active:translate-y-px disabled:opacity-50"
        style={{
          background: "var(--brand, #18181B)",
          color: "var(--brand-foreground, white)",
        }}
      >
        {emitting ? (
          <>
            <Loader2 className="size-4 animate-spin" />
            Emitiendo…
          </>
        ) : (
          <>
            <FileText className="size-4" />
            Emitir {tipoA ? "Factura A" : "Factura B"}
          </>
        )}
      </button>
    </section>
  );
}

// ── Anular cobro ──────────────────────────────────────────────

function AnularCobroSection({
  orderId,
  slug,
  onDone,
}: {
  orderId: string;
  slug: string;
  onDone: () => void;
}) {
  const [, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [motivo, setMotivo] = useState("");

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex w-full items-center justify-center gap-1.5 rounded-full bg-rose-50 px-4 py-2 text-xs font-semibold text-rose-700 ring-1 ring-rose-200 transition hover:bg-rose-100"
      >
        <Trash2 className="size-3.5" />
        Anular cobro
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Anular cobro</DialogTitle>
          </DialogHeader>
          <p className="-mt-2 text-sm text-zinc-600">
            Los pagos cobrados se marcan como reembolsados (auditoría) y la
            mesa vuelve a esperando cuenta.
          </p>
          <div className="grid gap-1.5">
            <Label>
              Motivo<span className="ml-1 text-rose-600">*</span>
            </Label>
            <Textarea
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              rows={2}
              placeholder="Ej: cliente reclamó, pago doble, error de carga…"
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Volver
            </Button>
            <Button
              variant="destructive"
              disabled={motivo.trim() === ""}
              onClick={() =>
                startTransition(async () => {
                  const r = await anularCobro(orderId, motivo, slug);
                  if (!r.ok) toast.error(r.error);
                  else {
                    toast.success("Cobro anulado");
                    setOpen(false);
                    onDone();
                  }
                })
              }
            >
              Anular cobro
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

