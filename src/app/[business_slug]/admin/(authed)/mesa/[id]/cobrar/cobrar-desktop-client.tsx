"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  Banknote,
  Check,
  CheckCircle2,
  CreditCard,
  Link as LinkIcon,
  MoreHorizontal,
  QrCode,
  Trash2,
  Wallet,
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
import { Input } from "@/components/ui/input";
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
import type {
  CuentaState,
  OrderSplit,
  PaymentMethod,
} from "@/lib/billing/types";
import { calculateAdjustment } from "@/lib/billing/adjustment";
import { isCashShortPayment } from "@/lib/billing/totals";
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

const METHODS: Array<{
  value: PaymentMethod;
  label: string;
  description: string;
  icon: typeof Banknote;
}> = [
  {
    value: "cash",
    label: "Efectivo",
    description: "Cobrá en mano. El sistema calcula el vuelto.",
    icon: Banknote,
  },
  {
    value: "card_manual",
    label: "Tarjeta",
    description: "Posnet físico. Anotá los últimos 4 dígitos.",
    icon: CreditCard,
  },
  {
    value: "mp_link",
    label: "Link Mercado Pago",
    description: "Generá un link para enviar al cliente.",
    icon: LinkIcon,
  },
  {
    value: "mp_qr",
    label: "QR Mercado Pago",
    description: "Mostrá un QR para que el cliente escanee.",
    icon: QrCode,
  },
  {
    value: "transfer",
    label: "Transferencia",
    description: "CBU/CVU o alias. Anotá la referencia.",
    icon: Wallet,
  },
  {
    value: "other",
    label: "Otro",
    description: "Cheque, cortesía, etc.",
    icon: MoreHorizontal,
  },
];

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
  // `isRegistering` bloquea el botón mientras el pago está en vuelo: sin esto,
  // tocar "Confirmar" varias veces registra N pagos e infla la caja (bug
  // crítico cobro-doble-submit, reproducido en datos reales). spec 41 · FR-007.
  const [isRegistering, startTransition] = useTransition();
  // Idempotency key por intento de cobro (spec 42): estable entre taps del
  // mismo pago, se regenera tras un cobro OK. El server dedup por
  // (business_id, request_id) → un retry/tab/tap no duplica el pago (issue #58).
  const requestIdRef = useRef<string | null>(null);
  const remaining = split.expected_amount_cents - split.paid_amount_cents;
  const [method, setMethod] = useState<PaymentMethod | null>(null);
  const configForMethod = methodConfigs.find((c) => c.method === method);
  const adjustmentPercent = configForMethod?.adjustment_percent ?? 0;
  const { adjustmentCents, finalCents } = calculateAdjustment(remaining, adjustmentPercent);
  const [amount, setAmount] = useState(remaining);
  // En efectivo no se cobra de menos (de más es vuelto). Misma regla que el
  // server aplica en `registrarPago` — acá sólo para no dejar tocar Confirmar.
  const cashShort = isCashShortPayment({
    method: method ?? "",
    amount_cents: amount,
    adjustment_cents: adjustmentCents,
    remaining_cents: remaining,
  });
  const [hasSetAmount, setHasSetAmount] = useState(false);
  const [tip, setTip] = useState(0);
  const [lastFour, setLastFour] = useState("");
  const [cardBrand, setCardBrand] = useState<
    "visa" | "mastercard" | "amex" | "otro"
  >("visa");
  const [notes, setNotes] = useState("");
  const [mpInitPoint, setMpInitPoint] = useState<string | null>(null);
  const [mpPaymentId, setMpPaymentId] = useState<string | null>(null);

  useEffect(() => {
    if (method && !hasSetAmount) {
      setAmount(finalCents);
    }
  }, [method, finalCents, hasSetAmount]);

  useEffect(() => {
    if (!mpPaymentId) return;
    const interval = setInterval(async () => {
      try {
        const res = await fetch(
          `/api/billing/payment-status?id=${mpPaymentId}`,
        );
        const data = await res.json();
        if (data?.payment_status === "paid") {
          toast.success("Pago MP confirmado");
          clearInterval(interval);
          // El webhook MP cierra la orden si correspondía. No tenemos la flag
          // acá, así que dejamos que el refresh decida (server-side render).
          onPaid({ orderClosed: false });
        } else if (data?.payment_status === "failed") {
          toast.error("MP rechazó el pago");
          clearInterval(interval);
          setMpPaymentId(null);
          setMpInitPoint(null);
          setMethod(null);
        }
      } catch {
        // ignore polling errors
      }
    }, 4_000);
    return () => clearInterval(interval);
  }, [mpPaymentId, onPaid]);

  const handleConfirm = () => {
    if (!method) return;
    if (method === "mp_link" || method === "mp_qr") {
      startTransition(async () => {
        const r = await iniciarPagoMp({
          orderId,
          splitId: isImplicit ? null : split.id,
          method,
          amount_cents: amount,
          tip_cents: tip,
          caja_id: cajaId,
          slug,
        });
        if (!r.ok) {
          toast.error(r.error);
          return;
        }
        setMpInitPoint(r.data.initPoint);
        setMpPaymentId(r.data.paymentId);
      });
      return;
    }
    startTransition(async () => {
      const r = await registrarPago({
        orderId,
        splitId: isImplicit ? null : split.id,
        method,
        amount_cents: amount,
        tip_cents: tip,
        caja_id: cajaId,
        last_four:
          method === "card_manual" && lastFour.length === 4
            ? lastFour
            : undefined,
        card_brand: method === "card_manual" ? cardBrand : undefined,
        notes:
          method === "other" || method === "card_manual" || method === "transfer" ? notes : undefined,
        adjustment_percent: adjustmentPercent,
        adjustment_cents: adjustmentCents,
        slug,
        requestId: (requestIdRef.current ??= crypto.randomUUID()),
      });
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      requestIdRef.current = null; // pago OK → el próximo cobro usa una clave nueva
      toast.success("Pago registrado");
      onPaid({ orderClosed: r.data.orderClosed });
    });
  };

  if (mpInitPoint) {
    return (
      <Surface padding="compact" className="space-y-3">
        <div>
          <p className="text-[0.6rem] font-semibold uppercase tracking-[0.18em] text-zinc-500">
            {method === "mp_qr" ? "QR Mercado Pago" : "Link Mercado Pago"}
          </p>
          <h3 className="mt-1 text-base font-semibold text-zinc-900">
            Esperando confirmación
          </h3>
        </div>
        {method === "mp_qr" ? (
          <a
            href={mpInitPoint}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 rounded-full bg-zinc-900 px-4 py-2 text-sm font-semibold text-white"
          >
            <QrCode className="size-4" />
            Abrir QR de checkout
          </a>
        ) : (
          <div className="space-y-1.5">
            <Label>Link de pago</Label>
            <Input value={mpInitPoint} readOnly className="text-xs" />
            <button
              type="button"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(mpInitPoint);
                  toast.success("Link copiado");
                } catch {
                  toast.error("No se pudo copiar");
                }
              }}
              className="inline-flex items-center gap-1.5 rounded-full bg-zinc-100 px-3 py-1.5 text-xs font-semibold text-zinc-700 transition hover:bg-zinc-200"
            >
              Copiar link
            </button>
          </div>
        )}
        <p className="text-xs text-zinc-500">
          Auto-refresh cada 4 segundos. Si MP confirma, se cierra solo.
        </p>
        <button
          type="button"
          onClick={() => {
            setMpInitPoint(null);
            setMpPaymentId(null);
            setMethod(null);
          }}
          className="flex h-12 w-full items-center justify-center rounded-2xl text-sm font-semibold text-zinc-700 ring-1 ring-zinc-200 transition hover:bg-zinc-50"
        >
          Cancelar
        </button>
      </Surface>
    );
  }

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

      {!method && (
        <div className="space-y-2">
          {METHODS.map((m) => {
            const Icon = m.icon;
            const mc = methodConfigs.find((c) => c.method === m.value);
            const adj = mc?.adjustment_percent ?? 0;
            const { finalCents: adjFinal } = calculateAdjustment(remaining, adj);
            return (
              <button
                key={m.value}
                type="button"
                onClick={() => { setMethod(m.value); setHasSetAmount(false); }}
                className="flex w-full items-center gap-3 rounded-xl bg-white p-3 text-left ring-1 ring-zinc-200/70 transition hover:bg-zinc-50 hover:ring-zinc-300"
              >
                <div className="flex size-10 flex-shrink-0 items-center justify-center rounded-full bg-zinc-100 text-zinc-700">
                  <Icon className="size-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-zinc-900">
                    {mc?.label ?? m.label}
                    {adj !== 0 && (
                      <span className={cn("ml-1 text-xs font-medium", adj < 0 ? "text-emerald-600" : "text-rose-600")}>
                        {adj > 0 ? "+" : ""}{adj}%
                      </span>
                    )}
                  </p>
                  <p className="text-xs text-zinc-500">{m.description}</p>
                </div>
                <span className="text-sm font-semibold text-zinc-900 tabular-nums">
                  {formatCurrency(adjFinal)}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {method && (
        <div className="space-y-4">
          <button
            type="button"
            onClick={() => setMethod(null)}
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-zinc-600 transition hover:text-zinc-900"
          >
            <ArrowRight className="size-3 rotate-180" /> Cambiar método
          </button>

          <div className="rounded-xl bg-zinc-50 p-3 ring-1 ring-zinc-200/70">
            {(() => {
              const meta = METHODS.find((m) => m.value === method)!;
              const Icon = meta.icon;
              return (
                <div className="flex items-center gap-3">
                  <div className="flex size-9 items-center justify-center rounded-full bg-white">
                    <Icon className="size-4 text-zinc-700" />
                  </div>
                  <p className="text-sm font-semibold text-zinc-900">
                    {meta.label}
                  </p>
                </div>
              );
            })()}
          </div>

          <div className="grid gap-1.5">
            <Label>Monto</Label>
            <Input
              type="number"
              value={amount / 100}
              onChange={(e) => {
                setAmount(Math.max(0, Math.round(Number(e.target.value) * 100)));
                setHasSetAmount(true);
              }}
              inputMode="decimal"
            />
            {adjustmentPercent !== 0 && (
              <p className={cn("text-xs font-medium", adjustmentPercent < 0 ? "text-emerald-700" : "text-rose-600")}>
                {adjustmentPercent < 0 ? "Descuento" : "Recargo"} {adjustmentPercent > 0 ? "+" : ""}{adjustmentPercent}%: {formatCurrency(adjustmentCents)}
                <span className="ml-1 text-zinc-500">(base {formatCurrency(remaining)})</span>
              </p>
            )}
            {method === "cash" && amount > finalCents && (
              <p className="text-xs font-semibold text-emerald-700">
                Vuelto: {formatCurrency(amount - finalCents)}
              </p>
            )}
          </div>

          {(method === "cash" || method === "card_manual" || method === "transfer") && (
            <div className="grid gap-1.5">
              <Label>Propina (opcional)</Label>
              <Input
                type="number"
                value={tip / 100}
                onChange={(e) =>
                  setTip(
                    Math.max(0, Math.round(Number(e.target.value) * 100)),
                  )
                }
                inputMode="decimal"
              />
            </div>
          )}

          {method === "card_manual" && (
            <>
              <div className="grid gap-1.5">
                <Label>Últimos 4 dígitos</Label>
                <Input
                  value={lastFour}
                  onChange={(e) =>
                    setLastFour(
                      e.target.value.replace(/\D/g, "").slice(0, 4),
                    )
                  }
                  placeholder="1234"
                  maxLength={4}
                  inputMode="numeric"
                />
              </div>
              <div className="grid gap-1.5">
                <Label>Marca</Label>
                <Select
                  value={cardBrand}
                  onValueChange={(v) =>
                    v &&
                    setCardBrand(
                      v as "visa" | "mastercard" | "amex" | "otro",
                    )
                  }
                >
                  <SelectTrigger>
                    <SelectValue>
                      {{
                        visa: "Visa",
                        mastercard: "MasterCard",
                        amex: "Amex",
                        otro: "Otra",
                      }[cardBrand] ?? "Marca"}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="visa">Visa</SelectItem>
                    <SelectItem value="mastercard">MasterCard</SelectItem>
                    <SelectItem value="amex">Amex</SelectItem>
                    <SelectItem value="otro">Otra</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </>
          )}

          {(method === "other" || method === "card_manual" || method === "transfer") && (
            <div className="grid gap-1.5">
              <Label>
                Notas
                {(method === "other" || method === "transfer") && (
                  <span className="ml-1 text-rose-600">*</span>
                )}
              </Label>
              <Textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
                placeholder={
                  method === "transfer"
                    ? "Alias o referencia de la transferencia…"
                    : method === "other"
                      ? "Cheque #1234, cortesía…"
                      : "Opcional"
                }
              />
            </div>
          )}

          {cashShort && (
            <p className="text-xs font-semibold text-rose-600">
              En efectivo no se puede cobrar menos de {formatCurrency(finalCents)}.
              Si van a pagar en partes, volvé y dividí la cuenta por monto.
            </p>
          )}

          <button
            type="button"
            disabled={
              isRegistering ||
              amount <= 0 ||
              cashShort ||
              ((method === "other" || method === "transfer") && notes.trim() === "") ||
              (method === "card_manual" &&
                lastFour !== "" &&
                lastFour.length !== 4)
            }
            onClick={handleConfirm}
            className="flex h-14 w-full items-center justify-center gap-2 rounded-2xl bg-emerald-600 text-base font-semibold text-white shadow-sm transition hover:brightness-105 active:scale-[0.98] disabled:opacity-50"
          >
            {isRegistering ? (
              "Registrando…"
            ) : (
              <>
                <Check className="size-5" />
                Confirmar {formatCurrency(amount)}
              </>
            )}
          </button>
        </div>
      )}
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

// ── Anular cobro ──────────────────────────────────────────────────────────

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
