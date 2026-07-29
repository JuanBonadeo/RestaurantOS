"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import {
  Banknote,
  Check,
  CreditCard,
  Link as LinkIcon,
  MoreHorizontal,
  QrCode,
  Wallet,
} from "lucide-react";
import { toast } from "sonner";

import type { ActionResult } from "@/lib/actions";
import { calculateAdjustment } from "@/lib/billing/adjustment";
import { isCashShortPayment } from "@/lib/billing/totals";
import type { Caja, PaymentMethod, PaymentMethodConfig } from "@/lib/caja/types";
import { formatCurrency } from "@/lib/currency";
import { cn } from "@/lib/utils";

// ============================================================================
// El formulario de cobro, una sola vez (spec 062).
//
// No sabe qué está cobrando: recibe **cuánto falta** y **qué hacer al
// confirmar**. Por eso sirve igual para una mesa abierta, para un pedido del
// board y para la venta de mostrador — donde la orden nace recién al cobrar.
//
// Adentro viven las reglas de dinero, una sola vez: ajuste por método, la
// guarda de efectivo, el vuelto, los últimos 4 dígitos, la nota obligatoria, el
// bloqueo mientras el pago está en vuelo y la idempotencia por `requestId`.
//
// Afuera queda todo lo que depende del contexto: qué orden/split se cobra,
// cerrar la orden, liberar la mesa, facturar, refrescar.
// ============================================================================

export type CobroSubject =
  | { kind: "mesa"; label: string }
  | { kind: "pedido"; orderNumber: number }
  | { kind: "mostrador" };

export type CobroSubmit = {
  method: PaymentMethod;
  /** Con el ajuste del método ya aplicado — es lo que paga el cliente. */
  amountCents: number;
  tipCents: number;
  cajaId: string;
  lastFour?: string;
  cardBrand?: "visa" | "mastercard" | "amex" | "otro";
  notes?: string;
  adjustmentPercent: number;
  adjustmentCents: number;
  /** Estable entre taps del mismo intento; nuevo después de un cobro OK. */
  requestId: string;
};

/**
 * La propina no es un booleano (hallazgo T002-2): el mozo la trae de la orden
 * —se carga en el paso Cuenta y no se toca al cobrar— y el encargado la edita
 * acá mismo.
 */
export type CobroTip =
  | { mode: "none" }
  | { mode: "fixed"; cents: number }
  | { mode: "editable"; initialCents?: number };

export type CobroFormProps = {
  subject: CobroSubject;
  /** Lo que falta cobrar, SIN ajuste de método. */
  amountDueCents: number;
  cajas: Caja[];
  cajaId: string;
  onCajaChange?: (cajaId: string) => void;
  methodConfigs: PaymentMethodConfig[];
  /** Mostrador no ofrece MP; el pedido sí. */
  allowedMethods?: PaymentMethod[];
  tip?: CobroTip;
  /** Ergonomía. `touch` = mozo en el celular; `compact` = paneles del admin. */
  size?: "touch" | "compact";
  /** Se llama al confirmar. El caller elige el action — el form no importa
   *  server actions. Devuelve el resultado completo: el mozo lo usa para
   *  mergear la fila ya persistida sin refrescar (spec 41). */
  onSubmit: (input: CobroSubmit) => Promise<ActionResult<unknown>>;
  /** Corre después de un cobro OK. */
  onPaid?: () => void;
  /** Volver atrás (deseleccionar el método). */
  onCancel?: () => void;
  /** MP: preference + link/QR + polling. Sin esto, no se ofrece MP. */
  mp?: {
    start: (input: {
      method: "mp_link" | "mp_qr";
      amountCents: number;
      tipCents: number;
      cajaId: string;
    }) => Promise<ActionResult<{ paymentId: string; initPoint: string }>>;
    onConfirmed: () => void;
  };
};

const METHODS: Array<{
  value: PaymentMethod;
  label: string;
  icon: typeof Banknote;
}> = [
  { value: "cash", label: "Efectivo", icon: Banknote },
  { value: "card_manual", label: "Tarjeta", icon: CreditCard },
  { value: "mp_link", label: "Link Mercado Pago", icon: LinkIcon },
  { value: "mp_qr", label: "QR Mercado Pago", icon: QrCode },
  { value: "transfer", label: "Transferencia", icon: Wallet },
  { value: "other", label: "Otro", icon: MoreHorizontal },
];

const CARD_BRANDS: Array<{ value: "visa" | "mastercard" | "amex" | "otro"; label: string }> = [
  { value: "visa", label: "Visa" },
  { value: "mastercard", label: "Mastercard" },
  { value: "amex", label: "Amex" },
  { value: "otro", label: "Otro" },
];

function isMpMethod(m: PaymentMethod | null): m is "mp_link" | "mp_qr" {
  return m === "mp_link" || m === "mp_qr";
}

export function CobroForm({
  subject,
  amountDueCents,
  cajas,
  cajaId,
  onCajaChange,
  methodConfigs,
  allowedMethods,
  tip: tipConfig = { mode: "none" },
  size = "compact",
  onSubmit,
  onPaid,
  onCancel,
  mp,
}: CobroFormProps) {
  // Bloquea el botón mientras el pago está en vuelo: sin esto, tocar
  // "Confirmar" varias veces registra N pagos e infla la caja (bug crítico
  // cobro-doble-submit, reproducido en datos reales — spec 41 / #58).
  const [isRegistering, startTransition] = useTransition();
  // Idempotency key por intento (spec 42): estable entre taps, se regenera tras
  // un cobro OK. El server dedup por (business_id, request_id).
  const requestIdRef = useRef<string | null>(null);

  const [method, setMethod] = useState<PaymentMethod | null>(null);
  const adjustmentPercent =
    methodConfigs.find((c) => c.method === method)?.adjustment_percent ?? 0;
  const { adjustmentCents, finalCents } = calculateAdjustment(
    amountDueCents,
    adjustmentPercent,
  );

  const [amount, setAmount] = useState(amountDueCents);
  const [hasSetAmount, setHasSetAmount] = useState(false);
  const [tip, setTip] = useState(
    tipConfig.mode === "editable" ? (tipConfig.initialCents ?? 0) : 0,
  );
  const [lastFour, setLastFour] = useState("");
  const [cardBrand, setCardBrand] = useState<
    "visa" | "mastercard" | "amex" | "otro"
  >("visa");
  const [notes, setNotes] = useState("");
  const [mpInitPoint, setMpInitPoint] = useState<string | null>(null);
  const [mpPaymentId, setMpPaymentId] = useState<string | null>(null);

  const effectiveTip = tipConfig.mode === "fixed" ? tipConfig.cents : tip;

  // En efectivo no se cobra de menos (de más es vuelto). La misma regla que el
  // server aplica en `registrarPago`; acá sólo para no dejar tocar Confirmar.
  const cashShort = isCashShortPayment({
    method: method ?? "",
    amount_cents: amount,
    adjustment_cents: adjustmentCents,
    remaining_cents: amountDueCents,
  });

  const methods = METHODS.filter((m) => {
    if (allowedMethods && !allowedMethods.includes(m.value)) return false;
    if (isMpMethod(m.value) && !mp) return false;
    return true;
  });

  // Al elegir método, el monto arranca en lo que hay que pagar con su ajuste.
  // Si el usuario ya lo tocó a mano, se respeta.
  useEffect(() => {
    if (method && !hasSetAmount) setAmount(finalCents);
  }, [method, finalCents, hasSetAmount]);

  useEffect(() => {
    if (!mpPaymentId || !mp) return;
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/billing/payment-status?id=${mpPaymentId}`);
        const data = await res.json();
        if (data?.payment_status === "paid") {
          toast.success("Pago MP confirmado");
          clearInterval(interval);
          mp.onConfirmed();
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
  }, [mpPaymentId, mp]);

  const notesRequired = method === "other" || method === "transfer";
  const showNotes =
    method === "other" || method === "transfer" || method === "card_manual";

  const confirmDisabled =
    isRegistering ||
    amount <= 0 ||
    cashShort ||
    (notesRequired && notes.trim() === "") ||
    (method === "card_manual" && lastFour !== "" && lastFour.length !== 4);

  const handleConfirm = () => {
    if (!method) return;

    if (isMpMethod(method)) {
      if (!mp) return;
      startTransition(async () => {
        const r = await mp.start({
          method,
          amountCents: amount,
          tipCents: effectiveTip,
          cajaId,
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
      const r = await onSubmit({
        method,
        amountCents: amount,
        tipCents: effectiveTip,
        cajaId,
        lastFour:
          method === "card_manual" && lastFour.length === 4 ? lastFour : undefined,
        cardBrand: method === "card_manual" ? cardBrand : undefined,
        notes: showNotes ? notes : undefined,
        adjustmentPercent,
        adjustmentCents,
        requestId: (requestIdRef.current ??= crypto.randomUUID()),
      });
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      // Cobro OK → el próximo intento usa una clave nueva.
      requestIdRef.current = null;
      toast.success("Pago registrado");
      onPaid?.();
    });
  };

  const touch = size === "touch";

  // ── Sub-vista MP: link / QR + polling ─────────────────────────────────
  if (mpInitPoint) {
    return (
      <div className="space-y-3">
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
            <p className="text-xs font-semibold text-zinc-600">Link de pago</p>
            <input
              value={mpInitPoint}
              readOnly
              className="h-10 w-full rounded-xl border border-zinc-200 px-3 text-xs"
            />
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
          className="text-xs font-semibold text-zinc-500 underline"
        >
          Cancelar y elegir otro método
        </button>
      </div>
    );
  }

  // ── Paso 1: elegir método ─────────────────────────────────────────────
  if (!method) {
    return (
      <div className="space-y-3">
        <CajaPicker cajas={cajas} cajaId={cajaId} onChange={onCajaChange} />
        <div className="grid grid-cols-2 gap-2">
          {methods.map((m) => {
            const adj =
              methodConfigs.find((c) => c.method === m.value)
                ?.adjustment_percent ?? 0;
            const { finalCents: adjFinal } = calculateAdjustment(
              amountDueCents,
              adj,
            );
            const Icon = m.icon;
            return (
              <button
                key={m.value}
                type="button"
                onClick={() => setMethod(m.value)}
                className={cn(
                  "flex flex-col items-start gap-1 rounded-2xl bg-white p-3 text-left ring-1 ring-zinc-200 transition hover:ring-zinc-300 active:scale-[0.98]",
                  touch && "p-4",
                )}
              >
                <Icon className={cn("size-4 text-zinc-500", touch && "size-5")} />
                <span
                  className={cn(
                    "text-sm font-semibold text-zinc-900",
                    touch && "text-base",
                  )}
                >
                  {m.label}
                </span>
                {adj !== 0 && (
                  <span
                    className={cn(
                      "text-xs font-medium",
                      adj < 0 ? "text-emerald-700" : "text-rose-600",
                    )}
                  >
                    {adj > 0 ? "+" : ""}
                    {adj}% · {formatCurrency(adjFinal)}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  // ── Paso 2: datos del pago ────────────────────────────────────────────
  const meta = METHODS.find((m) => m.value === method)!;
  const MetaIcon = meta.icon;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <MetaIcon className="size-4 text-zinc-500" />
          <p className="text-sm font-semibold text-zinc-900">{meta.label}</p>
        </div>
        <button
          type="button"
          onClick={() => {
            setMethod(null);
            setHasSetAmount(false);
            onCancel?.();
          }}
          className="text-xs font-semibold text-zinc-500 underline"
        >
          Cambiar
        </button>
      </div>

      <div className="grid gap-1.5">
        <label htmlFor="cobro-monto" className="text-xs font-semibold text-zinc-600">
          Monto
        </label>
        <input
          id="cobro-monto"
          type="number"
          inputMode="decimal"
          value={amount / 100}
          onChange={(e) => {
            setAmount(Math.max(0, Math.round(Number(e.target.value) * 100)));
            setHasSetAmount(true);
          }}
          className={cn(
            "h-11 w-full rounded-xl border border-zinc-200 px-3 text-base font-semibold tabular-nums focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-100",
            touch && "h-14 text-lg",
          )}
        />
        {adjustmentPercent !== 0 && (
          <p
            className={cn(
              "text-xs font-medium",
              adjustmentPercent < 0 ? "text-emerald-700" : "text-rose-600",
            )}
          >
            {adjustmentPercent < 0 ? "Descuento" : "Recargo"}{" "}
            {adjustmentPercent > 0 ? "+" : ""}
            {adjustmentPercent}%: {formatCurrency(adjustmentCents)}
            <span className="ml-1 text-zinc-500">
              (base {formatCurrency(amountDueCents)})
            </span>
          </p>
        )}
        {method === "cash" && amount > finalCents && (
          <p className="text-xs font-semibold text-emerald-700">
            Vuelto: {formatCurrency(amount - finalCents)}
          </p>
        )}
        {cashShort && (
          <p className="text-xs font-semibold text-rose-600">
            En efectivo no se puede cobrar menos de {formatCurrency(finalCents)}.
            Si van a pagar en partes, dividí la cuenta por monto.
          </p>
        )}
      </div>

      {tipConfig.mode === "editable" && (
        <div className="grid gap-1.5">
          <label
            htmlFor="cobro-propina"
            className="text-xs font-semibold text-zinc-600"
          >
            Propina (opcional)
          </label>
          <input
            id="cobro-propina"
            type="number"
            inputMode="decimal"
            value={tip / 100}
            onChange={(e) =>
              setTip(Math.max(0, Math.round(Number(e.target.value) * 100)))
            }
            className={cn(
              "h-11 w-full rounded-xl border border-zinc-200 px-3 text-base tabular-nums focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-100",
              touch && "h-14 text-lg",
            )}
          />
        </div>
      )}
      {tipConfig.mode === "fixed" && tipConfig.cents > 0 && (
        <p className="text-xs text-zinc-500">
          Incluye propina de {formatCurrency(tipConfig.cents)}.
        </p>
      )}

      {method === "card_manual" && (
        <div className="grid gap-2">
          <div className="grid gap-1.5">
            <label
              htmlFor="cobro-last-four"
              className="text-xs font-semibold text-zinc-600"
            >
              Últimos 4 dígitos (opcional)
            </label>
            <input
              id="cobro-last-four"
              type="text"
              inputMode="numeric"
              maxLength={4}
              value={lastFour}
              onChange={(e) =>
                setLastFour(e.target.value.replace(/\D/g, "").slice(0, 4))
              }
              className="h-11 w-full rounded-xl border border-zinc-200 px-3 text-base tabular-nums focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-100"
            />
          </div>
          <div className="flex flex-wrap gap-1.5">
            {CARD_BRANDS.map((b) => (
              <button
                key={b.value}
                type="button"
                onClick={() => setCardBrand(b.value)}
                className={cn(
                  "rounded-full px-3 py-1.5 text-xs font-semibold transition",
                  cardBrand === b.value
                    ? "bg-zinc-900 text-white"
                    : "bg-white text-zinc-700 ring-1 ring-zinc-200",
                )}
              >
                {b.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {showNotes && (
        <div className="grid gap-1.5">
          <label
            htmlFor="cobro-notas"
            className="text-xs font-semibold text-zinc-600"
          >
            Notas{notesRequired && <span className="text-rose-600"> *</span>}
          </label>
          <textarea
            id="cobro-notas"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            placeholder={
              method === "transfer"
                ? "Alias o referencia…"
                : method === "other"
                  ? "Cheque #1234, cortesía…"
                  : "Opcional"
            }
            className="w-full rounded-xl border border-zinc-200 px-3 py-2 text-sm focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-100"
          />
        </div>
      )}

      <button
        type="button"
        disabled={confirmDisabled}
        onClick={handleConfirm}
        className={cn(
          "flex h-14 w-full items-center justify-center gap-2 rounded-2xl bg-emerald-600 text-base font-semibold text-white shadow-sm transition hover:brightness-105 active:scale-[0.98] disabled:opacity-50",
          touch && "h-16 text-lg font-bold",
        )}
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
  );
}

function CajaPicker({
  cajas,
  cajaId,
  onChange,
}: {
  cajas: Caja[];
  cajaId: string;
  onChange?: (id: string) => void;
}) {
  if (cajas.length <= 1 || !onChange) return null;
  return (
    <div>
      <p className="mb-1.5 text-xs font-semibold text-zinc-600">Caja</p>
      <div className="flex flex-wrap gap-2">
        {cajas.map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => onChange(c.id)}
            className={cn(
              "rounded-full px-3 py-1.5 text-sm font-semibold transition",
              cajaId === c.id
                ? "bg-zinc-900 text-white"
                : "bg-white text-zinc-700 ring-1 ring-zinc-200",
            )}
          >
            {c.name}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Título legible del cobro según qué se esté cobrando. */
export function cobroTitle(subject: CobroSubject): string {
  switch (subject.kind) {
    case "mesa":
      return `Cobrar ${subject.label}`;
    case "pedido":
      return `Cobrar pedido #${subject.orderNumber}`;
    case "mostrador":
      return "Venta rápida";
  }
}
