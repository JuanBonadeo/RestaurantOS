"use client";

import { useEffect, useState } from "react";
import { Bike, ShoppingBag, Sparkles, CreditCard, Banknote } from "lucide-react";

import { Button } from "@/components/ui/button";
import { formatCurrency } from "@/lib/currency";
import type { OrderStatus } from "@/lib/orders/status";

import type { AdminOrder } from "@/lib/admin/orders-query";

import { OrderDetailSheet } from "./order-detail-sheet";

const NEXT_LABEL: Partial<Record<OrderStatus, string>> = {
  pending: "Confirmar",
  confirmed: "Preparar",
  preparing: "Listo",
  ready: "En camino",
  on_the_way: "Entregar",
};

const NEXT_STATUS: Partial<Record<OrderStatus, OrderStatus>> = {
  pending: "confirmed",
  confirmed: "preparing",
  preparing: "ready",
  ready: "on_the_way",
  on_the_way: "delivered",
};

function useElapsedMinutes(iso: string): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const i = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(i);
  }, []);
  return Math.max(0, Math.floor((now - new Date(iso).getTime()) / 60_000));
}

/**
 * Mismo formato que el salón ("ahora", "5 min", "1h 20", "2h", "3 d") para
 * unificar el lenguaje de tiempos en todas las tabs del Local en vivo.
 */
function formatElapsed(minutes: number): string {
  if (minutes < 1) return "ahora";
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    const rest = minutes % 60;
    return rest === 0 ? `${hours} h` : `${hours}h ${rest}`;
  }
  const days = Math.floor(hours / 24);
  return `${days} d`;
}

function elapsedTone(min: number, isTerminal: boolean): string {
  if (isTerminal) return "text-muted-foreground";
  if (min >= 30) return "text-rose-700";
  if (min >= 15) return "text-amber-700";
  return "text-muted-foreground";
}

export function OrderCard({
  order,
  slug,
  timezone,
  onAdvance,
  onConfirm,
  isNew = false,
  columnRing = "ring-border",
}: {
  order: AdminOrder;
  slug: string;
  timezone: string;
  onAdvance: (order: AdminOrder, next: OrderStatus) => void;
  /** Si está presente y la order está en `pending` (delivery/take-away), el
   *  botón "Confirmar" llama acá en lugar de pasar a `confirmed`. La action
   *  resuelve sectores y crea las comandas para cocina. */
  onConfirm?: (order: AdminOrder) => void;
  isNew?: boolean;
  columnRing?: string;
}) {
  const [sheetOpen, setSheetOpen] = useState(false);
  const elapsed = useElapsedMinutes(order.created_at);

  // Decide qué botón mostrar.
  // Caso 1 · pending + delivery/take-away → "Confirmar pedido" (crea comandas).
  // Caso 2 · pending + dine-in → SIN botón en este UI (lo gestiona el mozo).
  // Caso 3 · pickup + ready → "Entregar" (saltea on_the_way).
  // Caso 4 · resto → siguiente estado vía updateOrderStatus.
  const isPendingOnline =
    order.status === "pending" && order.delivery_type !== "dine_in";
  const isPendingDineIn =
    order.status === "pending" && order.delivery_type === "dine_in";

  const nextForDelivery =
    order.delivery_type === "pickup" && order.status === "ready"
      ? "delivered"
      : NEXT_STATUS[order.status];

  const advanceLabel =
    order.delivery_type === "pickup" && order.status === "ready"
      ? "Entregar"
      : NEXT_LABEL[order.status];

  const isTerminal =
    order.status === "delivered" || order.status === "cancelled";

  const ringClass = isNew
    ? "ring-2 ring-emerald-500 shadow-[0_8px_24px_-8px_rgba(16,185,129,0.35)]"
    : `ring-1 ${columnRing}`;

  const ChannelIcon = order.delivery_type === "delivery" ? Bike : ShoppingBag;
  const firstItem = order.items[0];
  const moreItems = order.items.length - 1;

  // El estado del pago manda sobre el método elegido en el checkout: un pedido
  // en efectivo ya cobrado decía "Paga en efectivo" para siempre — el board no
  // distinguía lo cobrado de lo que falta cobrar, que es lo único que el
  // encargado necesita saber de un vistazo.
  const paymentBadge = (() => {
    if (order.payment_status === "paid")
      return {
        label: "Cobrado",
        className: "bg-emerald-100 text-emerald-800",
        Icon: order.payment_method === "mp" ? CreditCard : Banknote,
      };
    if (order.payment_method === "cash")
      return { label: "Paga en efectivo", className: "bg-amber-100 text-amber-800", Icon: Banknote };
    if (order.payment_method === "mp" && order.payment_status === "pending")
      return { label: "Pago pendiente", className: "bg-orange-100 text-orange-800", Icon: CreditCard };
    if (order.payment_method === "mp" && order.payment_status === "failed")
      return { label: "Pago fallido", className: "bg-red-100 text-red-800", Icon: CreditCard };
    return null;
  })();

  return (
    <>
      <article
        role="button"
        tabIndex={0}
        onClick={() => setSheetOpen(true)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setSheetOpen(true);
          }
        }}
        className={[
          "bg-card group relative flex cursor-pointer flex-col gap-2 rounded-xl p-3 text-left transition-all",
          "shadow-[0_1px_2px_rgba(19,27,46,0.04)]",
          "hover:-translate-y-px hover:shadow-[0_8px_20px_-8px_rgba(19,27,46,0.14)]",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2",
          ringClass,
          isNew ? "animate-[fadeIn_0.3s_ease-out]" : "",
        ].join(" ")}
      >
        {isNew && (
          <span className="absolute -top-2 left-3 inline-flex items-center gap-1 rounded-full bg-emerald-500 px-2 py-0.5 text-[0.6rem] font-bold uppercase tracking-wider text-white shadow-sm">
            <Sparkles className="size-3" />
            Nuevo
          </span>
        )}

        <header className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <span className="text-foreground text-xl font-extrabold leading-none tracking-tight tabular-nums">
              #{order.order_number}
            </span>
            <span
              className={`text-xs font-medium tabular-nums ${elapsedTone(elapsed, isTerminal)}`}
            >
              {formatElapsed(elapsed)}
            </span>
          </div>
          <ChannelIcon
            className="text-muted-foreground size-4 shrink-0"
            aria-label={
              order.delivery_type === "delivery" ? "Delivery" : "Retiro"
            }
          />
        </header>

        <p className="text-foreground truncate text-sm font-semibold leading-tight">
          {order.customer_name}
        </p>

        {paymentBadge && (
          <span
            className={`inline-flex w-fit items-center gap-1 rounded-full px-2 py-0.5 text-[0.65rem] font-semibold leading-none ${paymentBadge.className}`}
          >
            <paymentBadge.Icon className="size-3" />
            {paymentBadge.label}
          </span>
        )}

        {firstItem && (
          <p className="text-muted-foreground truncate text-xs">
            <span className="text-foreground/70 font-semibold tabular-nums">
              {firstItem.quantity}×
            </span>{" "}
            {firstItem.product_name}
            {moreItems > 0 && (
              <span className="text-muted-foreground/70">
                {" "}
                · +{moreItems}
              </span>
            )}
          </p>
        )}

        <div className="flex items-center justify-between gap-2 pt-0.5">
          <span className="text-foreground text-base font-bold tabular-nums">
            {formatCurrency(order.total_cents)}
          </span>
          {isPendingDineIn ? (
            <span className="text-muted-foreground/70 text-[11px] italic">
              Lo carga el mozo
            </span>
          ) : isPendingOnline && onConfirm ? (
            <Button
              size="sm"
              className="h-8 font-semibold"
              onClick={(e) => {
                e.stopPropagation();
                onConfirm(order);
              }}
            >
              Confirmar
            </Button>
          ) : (
            advanceLabel &&
            nextForDelivery && (
              <Button
                size="sm"
                className="h-8 font-semibold"
                onClick={(e) => {
                  e.stopPropagation();
                  onAdvance(order, nextForDelivery);
                }}
              >
                {advanceLabel}
              </Button>
            )
          )}
        </div>
      </article>

      <OrderDetailSheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        order={order}
        slug={slug}
        timezone={timezone}
        onAdvance={onAdvance}
        onConfirm={onConfirm}
      />
    </>
  );
}
