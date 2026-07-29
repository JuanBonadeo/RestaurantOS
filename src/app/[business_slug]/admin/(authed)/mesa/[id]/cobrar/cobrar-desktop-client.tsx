"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  Banknote,
  Check,
  CheckCircle2,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";

import {
  PageHeader,
  PageShell,
  Surface,
} from "@/components/admin/shell/page-shell";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { BusinessRole } from "@/lib/admin/context";
import {
  anularCobro,
  iniciarPagoMp,
  registrarPago,
  type IniciarCobroResult,
} from "@/lib/billing/cobro-actions";
import type { CuentaState, OrderSplit } from "@/lib/billing/types";
import { CobroForm } from "@/components/billing/cobro-form";
import type { PaymentMethodConfig } from "@/lib/caja/types";
import { formatCurrency } from "@/lib/currency";
import { cn } from "@/lib/utils";

type Props = {
  slug: string;
  tableId: string;
  tableLabel: string;
  role: BusinessRole;
  cuenta: CuentaState;
  init: IniciarCobroResult;
  /** Modo embebido: se renderiza dentro del panel del salón (no como página).
   *  Sin PageShell/PageHeader; header de panel con cerrar; layout en una
   *  columna; en vez de navegar a `/admin/operacion` usa los callbacks. */
  embedded?: boolean;
  /** Cerrar el panel manualmente (solo embebido). */
  onClose?: () => void;
  /** El cobro terminó (orden cerrada / anulada): el parent cierra y refresca. */
  onClosed?: () => void;
  /** Recargar los datos del cobro sin cerrar el panel (solo embebido). El
   *  parent re-corre `loadCobroForTable`. Necesario tras dividir/limpiar o un
   *  pago parcial, porque embebido el `init` viene de estado del cliente y
   *  `router.refresh()` no lo actualiza. */
  onReload?: () => void;
};

export function CobrarDesktopClient({
  slug,
  tableId: _tableId,
  tableLabel,
  role,
  cuenta,
  init,
  embedded = false,
  onClose,
  onClosed,
  onReload,
}: Props) {
  void _tableId;
  const router = useRouter();
  // Volver al salón: embebido cierra el panel via callback; página navega.
  const goHome = () => {
    if (embedded) onClosed?.();
    else router.push(`/${slug}/admin/operacion`);
  };
  // Refrescar los datos del cobro: embebido re-fetchea via parent; página
  // re-renderiza el server component.
  const reloadData = () => {
    if (embedded) onReload?.();
    else router.refresh();
  };
  const splits = init.hasImplicitSplit
    ? [
        implicitSplit(
          cuenta.order.id,
          cuenta.order.business_id,
          cuenta.totals.total_cents,
        ),
      ]
    : init.splits;

  const [activeSplitId, setActiveSplitId] = useState<string | null>(
    splits.find((s) => s.status !== "paid" && s.status !== "cancelled")?.id ??
      null,
  );
  const [cajaId, setCajaId] = useState<string>(init.cajas[0].id);
  const activeSplit = splits.find((s) => s.id === activeSplitId) ?? null;

  const total = cuenta.totals.total_cents;
  const splitsActivos = splits.filter((s) => s.status !== "cancelled");
  const totalPaid = splitsActivos.reduce(
    (acc, s) => acc + s.paid_amount_cents,
    0,
  );
  const totalPending = Math.max(0, total - totalPaid);
  const progressPct = total === 0 ? 0 : Math.min(100, (totalPaid / total) * 100);
  const allPaid = totalPending === 0;

  const body = (
    <div
      className={cn(
        embedded
          ? "space-y-4"
          : "grid gap-4 lg:grid-cols-[1fr_minmax(0,420px)]",
      )}
    >
      {/* ── Columna izquierda: KPI + caja + splits + anular ── */}
      <div className="space-y-4">
          {/* KPI principal */}
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
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/80">
              <div
                className="h-full rounded-full transition-all"
                style={{
                  width: `${progressPct}%`,
                  background: allPaid
                    ? "rgb(16 185 129)"
                    : "var(--brand, #18181B)",
                }}
              />
            </div>
          </section>

          {/* Selector de caja si hay >1 */}
          {init.cajas.length > 1 && (
            <Surface padding="compact">
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
            </Surface>
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
                    isActive={activeSplitId === s.id}
                    onSelect={() => setActiveSplitId(s.id)}
                  />
                </li>
              ))}
            </ul>
          </section>

          {/* Anular cobro (admin / encargado) */}
          {(role === "admin" || role === "encargado") && totalPaid > 0 && (
            <AnularCobroSection
              orderId={cuenta.order.id}
              slug={slug}
              onDone={goHome}
            />
          )}

          {allPaid && (
            <section className="flex items-center gap-3 rounded-2xl bg-emerald-50 p-4 ring-1 ring-emerald-200">
              <div className="flex size-10 items-center justify-center rounded-full bg-emerald-500 text-white">
                <CheckCircle2 className="size-5" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-emerald-900">
                  Mesa cobrada
                </p>
                <p className="text-xs text-emerald-700">
                  La mesa se va a marcar para limpiar.
                </p>
              </div>
              <button
                type="button"
                onClick={goHome}
                className="inline-flex items-center gap-1 rounded-full bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-emerald-700"
              >
                Volver al salón
                <ArrowRight className="size-3.5" />
              </button>
            </section>
          )}
        </div>

        {/* ── Columna derecha (página) / debajo (embebido): form de cobro ── */}
        <aside className={cn(!embedded && "lg:sticky lg:top-4 lg:self-start")}>
          {activeSplit ? (
            <CobrarSplitPanel
              key={activeSplit.id}
              split={activeSplit}
              orderId={cuenta.order.id}
              cajaId={cajaId}
              slug={slug}
              isImplicit={init.hasImplicitSplit}
              methodConfigs={init.methodConfigs}
              onPaid={({ orderClosed }) => {
                if (orderClosed) {
                  toast.success("Mesa cobrada");
                  goHome();
                  return;
                }
                setActiveSplitId(null);
                reloadData();
              }}
              onClear={() => setActiveSplitId(null)}
            />
          ) : (
            <EmptyPanel allPaid={allPaid} />
          )}
        </aside>
    </div>
  );

  // Embebido en el panel del salón: header de panel + cuerpo scrolleable.
  if (embedded) {
    return (
      <div className="flex h-full min-h-0 flex-col">
        <header className="border-border/60 flex items-center gap-3 border-b px-4 py-3">
          <div className="min-w-0 flex-1">
            <h3 className="text-foreground text-2xl font-extrabold leading-none tracking-tight">
              {tableLabel}
            </h3>
            <p className="text-muted-foreground mt-1 text-[11px] font-semibold uppercase tracking-wider">
              Cobrar mesa
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="hover:bg-muted/60 flex-shrink-0 rounded-full p-1.5 text-zinc-500"
            aria-label="Cerrar cobro"
          >
            <X className="h-4 w-4" />
          </button>
        </header>
        <div className="flex-1 overflow-y-auto p-4">{body}</div>
      </div>
    );
  }

  // Página completa (fallback / deep-link).
  return (
    <PageShell width="wide">
      <PageHeader
        eyebrow={tableLabel}
        title="Cobrar mesa"
        description="Registrá pagos por sub-cuenta o cobro completo. Cada confirmación queda asentada en la caja seleccionada."
        size="compact"
        back={{ href: `/${slug}/admin/operacion`, label: "Volver al salón" }}
      />
      {body}
    </PageShell>
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

// ── SplitRow ──────────────────────────────────────────────────────────────

function SplitRow({
  split,
  isActive,
  onSelect,
}: {
  split: OrderSplit;
  isActive: boolean;
  onSelect: () => void;
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
    <button
      type="button"
      onClick={onSelect}
      disabled={done || cancelled}
      className={cn(
        "flex w-full items-center gap-3 rounded-2xl bg-white p-4 text-left ring-1 transition",
        cancelled
          ? "cursor-not-allowed opacity-50 ring-zinc-200/70"
          : done
            ? "cursor-default ring-emerald-200 bg-emerald-50/40"
            : isActive
              ? "ring-2 ring-zinc-900"
              : "ring-zinc-200/70 hover:ring-zinc-300",
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
        <span
          className={cn(
            "inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-semibold",
            isActive
              ? "bg-zinc-900 text-white"
              : "bg-zinc-100 text-zinc-700",
          )}
        >
          {isActive ? "Cobrando" : "Cobrar"}
        </span>
      )}
    </button>
  );
}

// ── Panel de cobro (lado derecho) ─────────────────────────────────────────

function CobrarSplitPanel({
  split,
  orderId,
  cajaId,
  slug,
  isImplicit,
  methodConfigs,
  onPaid,
  onClear,
}: {
  split: OrderSplit;
  orderId: string;
  cajaId: string;
  slug: string;
  isImplicit: boolean;
  methodConfigs: PaymentMethodConfig[];
  onPaid: (result: { orderClosed: boolean }) => void;
  onClear: () => void;
}) {
  const remaining = split.expected_amount_cents - split.paid_amount_cents;

  return (
    <Surface padding="compact" className="space-y-4">
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[0.6rem] font-semibold uppercase tracking-[0.18em] text-zinc-500">
            {split.split_index === 0
              ? "Pago único"
              : `Sub-cuenta ${split.split_index}`}
          </p>
          <h2 className="mt-1 text-2xl font-bold tabular-nums tracking-tight text-zinc-900">
            {formatCurrency(remaining)}
          </h2>
        </div>
        <button
          type="button"
          onClick={onClear}
          className="text-xs font-semibold text-zinc-500 transition hover:text-zinc-900"
        >
          Cerrar
        </button>
      </header>

      <CobroForm
        subject={{ kind: "mesa", label: "" }}
        amountDueCents={remaining}
        cajas={[]}
        cajaId={cajaId}
        methodConfigs={methodConfigs}
        tip={{ mode: "editable" }}
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
        onPaid={(data) => onPaid({ orderClosed: data.orderClosed })}
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
                    data: { paymentId: r.data.paymentId, initPoint: r.data.initPoint },
                  }
                : r,
            ),
          // El webhook de MP cierra la orden si correspondía; no tenemos la flag
          // acá, así que dejamos que el refresh del parent lo resuelva.
          onConfirmed: () => onPaid({ orderClosed: false }),
        }}
      />
    </Surface>
  );
}

function EmptyPanel({ allPaid }: { allPaid: boolean }) {
  return (
    <Surface
      padding="compact"
      className="flex h-full flex-col items-center justify-center gap-2 text-center"
    >
      <div className="flex size-12 items-center justify-center rounded-full bg-zinc-100 text-zinc-500">
        {allPaid ? (
          <CheckCircle2 className="size-5" />
        ) : (
          <Banknote className="size-5" />
        )}
      </div>
      <p className="text-sm font-semibold text-zinc-900">
        {allPaid ? "Mesa cobrada" : "Elegí una sub-cuenta"}
      </p>
      <p className="max-w-xs text-xs text-zinc-500">
        {allPaid
          ? "Todos los pagos quedaron registrados. Podés volver al salón."
          : "Tocá una fila a la izquierda para registrar el pago."}
      </p>
    </Surface>
  );
}

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
