"use client";

import { useEffect, useState, useTransition } from "react";
import { formatInTimeZone } from "date-fns-tz";
import {
  Bike,
  Phone,
  Receipt,
  ShoppingBag,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Sheet,
  SheetContent,
  SheetTitle,
} from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import type { AdminOrder } from "@/lib/admin/orders-query";
import { formatCurrency } from "@/lib/currency";
import type { OrderStatus } from "@/lib/orders/status";
import { updateOrderStatus } from "@/lib/orders/update-status";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

import { CobrarPedidoSheet } from "./cobrar-pedido-sheet";

type Detail = {
  delivery_address: string | null;
  delivery_notes: string | null;
  subtotal_cents: number;
  delivery_fee_cents: number;
  items: {
    id: string;
    product_name: string;
    quantity: number;
    subtotal_cents: number;
    notes: string | null;
    daily_menu_id: string | null;
    daily_menu_snapshot: { components?: { label: string }[] } | null;
    is_combo_component: boolean;
    parent_order_item_id: string | null;
    modifiers: { modifier_name: string }[];
  }[];
  history: { status: OrderStatus; notes: string | null; created_at: string }[];
};

const STATUS_LABEL: Record<OrderStatus, string> = {
  pending: "Pendiente",
  confirmed: "Confirmado",
  preparing: "Preparando",
  ready: "Listo",
  on_the_way: "En camino",
  delivered: "Entregado",
  cancelled: "Cancelado",
};

const STATUS_DOT: Record<OrderStatus, string> = {
  pending: "bg-amber-500",
  confirmed: "bg-blue-500",
  preparing: "bg-amber-500",
  ready: "bg-emerald-500",
  on_the_way: "bg-indigo-500",
  delivered: "bg-zinc-400",
  cancelled: "bg-rose-500",
};

const NEXT_LABEL: Partial<Record<OrderStatus, string>> = {
  pending: "Confirmar",
  confirmed: "Empezar a preparar",
  preparing: "Marcar listo",
  ready: "Salió en camino",
  on_the_way: "Marcar entregado",
};

const NEXT_STATUS: Partial<Record<OrderStatus, OrderStatus>> = {
  pending: "confirmed",
  confirmed: "preparing",
  preparing: "ready",
  ready: "on_the_way",
  on_the_way: "delivered",
};

/**
 * Mismo formato que el salón / kanban / cards ("ahora", "5 min", "1h 20",
 * "3 d"). Unifica el lenguaje de tiempos en todo el admin del local.
 */
function formatRelativeTime(minutes: number): string {
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

export function OrderDetailSheet({
  open,
  onOpenChange,
  order,
  slug,
  timezone,
  onAdvance,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  order: AdminOrder;
  slug: string;
  timezone: string;
  onAdvance: (order: AdminOrder, next: OrderStatus) => void;
  onConfirm?: (order: AdminOrder, kitchenNotes: string) => void;
}) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [loading, setLoading] = useState(false);
  const [showCancel, setShowCancel] = useState(false);
  const [reason, setReason] = useState("");
  const [cancelling, startCancel] = useTransition();
  // Spec 054 — cobrar/facturar el pedido sin mesa desde el detalle.
  const [cobrarOpen, setCobrarOpen] = useState(false);
  // Indicación para cocina que se escribe al marchar («ENTREGAR x»).
  const [kitchenNotes, setKitchenNotes] = useState("");

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    (async () => {
      const supabase = createSupabaseBrowserClient();
      const { data } = await supabase
        .from("orders")
        .select(
          `delivery_address, delivery_notes, subtotal_cents, delivery_fee_cents,
           order_items(id, product_name, quantity, subtotal_cents, notes,
             daily_menu_id, daily_menu_snapshot, is_combo_component, parent_order_item_id,
             order_item_modifiers(modifier_name)),
           order_status_history(status, notes, created_at)`,
        )
        .eq("id", order.id)
        .maybeSingle();
      if (cancelled || !data) {
        setLoading(false);
        return;
      }
      setDetail({
        delivery_address: data.delivery_address,
        delivery_notes: data.delivery_notes,
        subtotal_cents: Number(data.subtotal_cents),
        delivery_fee_cents: Number(data.delivery_fee_cents),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        items: (data.order_items ?? []).map((i: any) => ({
          id: i.id,
          product_name: i.product_name,
          quantity: i.quantity,
          subtotal_cents: Number(i.subtotal_cents),
          notes: i.notes,
          daily_menu_id: i.daily_menu_id,
          daily_menu_snapshot: i.daily_menu_snapshot as Detail["items"][number]["daily_menu_snapshot"],
          is_combo_component: !!i.is_combo_component,
          parent_order_item_id: i.parent_order_item_id ?? null,
          modifiers: (i.order_item_modifiers ?? []).map((m: any) => ({
            modifier_name: m.modifier_name,
          })),
        })),
        history: (data.order_status_history ?? [])
          .map((h) => ({
            status: h.status as OrderStatus,
            notes: h.notes,
            created_at: h.created_at,
          }))
          .sort(
            (a, b) =>
              new Date(a.created_at).getTime() -
              new Date(b.created_at).getTime(),
          ),
      });
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, order.id]);

  // Reset cancel form when sheet closes
  useEffect(() => {
    if (!open) {
      setShowCancel(false);
      setReason("");
      setKitchenNotes("");
    }
  }, [open]);

  const isTerminal =
    order.status === "delivered" || order.status === "cancelled";

  /**
   * Un pedido ENTREGADO puede seguir impago: el delivery que se marcó entregado
   * antes de que el repartidor volviera con la plata, el retiro que se cobra al
   * mostrador. El pie del detalle se escondía con `isTerminal`, así que esos
   * pedidos no se podían cobrar ni facturar desde ningún lado.
   *
   * El server nunca tuvo ese límite: `registrarPago` rechaza sólo el pedido
   * cancelado y la orden ya cerrada — `delivered` con la orden abierta se cobra
   * normal. Así que el pie se muestra salvo en cancelado, que sí es final.
   */
  const isCancelled = order.status === "cancelled";

  // spec 047 — un pedido online en `pending` se manda a cocina con "Confirmar"
  // (onConfirm → confirmarPedido → routeOrderToCocina: crea comandas + imprime),
  // igual que el botón inline de la card. Avanzarlo por `onAdvance`/updateOrderStatus
  // lo dejaría en preparing sin comanda ni impresión.
  const isPendingOnline =
    order.status === "pending" && order.delivery_type !== "dine_in";

  /** La orden está saldada: pagada online o cobrada por el encargado
   *  (`closeOrderIfFullyPaid` también pone `payment_status: paid`). */
  const isPaid = order.payment_status === "paid";

  const nextForDelivery =
    order.delivery_type === "pickup" && order.status === "ready"
      ? "delivered"
      : NEXT_STATUS[order.status];

  const advanceLabel =
    order.delivery_type === "pickup" && order.status === "ready"
      ? "Marcar entregado"
      : NEXT_LABEL[order.status];

  const handleCancel = () => {
    if (!reason.trim()) {
      toast.error("Ingresá un motivo.");
      return;
    }
    startCancel(async () => {
      const result = await updateOrderStatus({
        order_id: order.id,
        business_slug: slug,
        next_status: "cancelled",
        cancelled_reason: reason.trim(),
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Pedido cancelado.");
      onOpenChange(false);
    });
  };

  const ChannelIcon = order.delivery_type === "delivery" ? Bike : ShoppingBag;
  const elapsedMin = Math.max(
    0,
    Math.floor((Date.now() - new Date(order.created_at).getTime()) / 60_000),
  );

  return (
    <>
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        showCloseButton={false}
        className="flex w-full flex-col gap-0 p-0 sm:max-w-md"
      >
        <header className="border-border/60 flex items-center justify-between border-b px-5 py-4">
          <div className="flex items-center gap-3">
            <span
              className={`inline-flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-1 text-[0.65rem] font-bold uppercase tracking-wider`}
            >
              <span className={`size-1.5 rounded-full ${STATUS_DOT[order.status]}`} />
              {STATUS_LABEL[order.status]}
            </span>
          </div>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="hover:bg-muted -mr-2 inline-flex size-8 items-center justify-center rounded-md transition-colors"
            aria-label="Cerrar"
          >
            <X className="size-4" />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto">
          <SheetTitle className="sr-only">
            Pedido #{order.order_number}
          </SheetTitle>

          <section className="px-5 pt-5 pb-4">
            <div className="flex items-baseline gap-2">
              <h2 className="text-foreground text-3xl font-extrabold tracking-tight tabular-nums">
                #{order.order_number}
              </h2>
              <span className="text-muted-foreground text-sm tabular-nums">
                · {formatInTimeZone(order.created_at, timezone, "HH:mm")} ·{" "}
                hace {formatRelativeTime(elapsedMin)}
              </span>
            </div>
            <p className="text-foreground mt-1 text-base font-semibold">
              {order.customer_name}
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <a
                href={`tel:${order.customer_phone}`}
                className="bg-muted hover:bg-muted/80 inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-colors"
              >
                <Phone className="size-3.5" />
                {order.customer_phone}
              </a>
              <span className="bg-muted inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium">
                <ChannelIcon className="size-3.5" />
                {order.delivery_type === "delivery" ? "Delivery" : "Retiro"}
              </span>
              <PaymentChip
                method={order.payment_method}
                status={order.payment_status}
              />
            </div>
          </section>

          {detail?.delivery_address && order.delivery_type === "delivery" && (
            <section className="border-border/60 border-t px-5 py-4">
              <p className="text-muted-foreground text-[0.65rem] font-semibold uppercase tracking-wider">
                Dirección
              </p>
              <p className="text-foreground mt-1.5 text-sm">
                {detail.delivery_address}
              </p>
              {detail.delivery_notes && (
                <p className="text-muted-foreground mt-1 text-xs italic">
                  &quot;{detail.delivery_notes}&quot;
                </p>
              )}
            </section>
          )}

          <section className="border-border/60 border-t px-5 py-4">
            <p className="text-muted-foreground text-[0.65rem] font-semibold uppercase tracking-wider">
              {detail
                ? (() => {
                    const parentCount = detail.items.filter((i) => !i.is_combo_component).length;
                    return `${parentCount} ${parentCount === 1 ? "ítem" : "ítems"}`;
                  })()
                : "Ítems"}
            </p>
            {loading && !detail && (
              <p className="text-muted-foreground mt-3 text-sm">Cargando…</p>
            )}
            {detail && (
              <ul className="mt-3 flex flex-col gap-3">
                {detail.items
                  .filter((item) => !item.is_combo_component)
                  .map((item) => {
                    const children = detail.items.filter(
                      (c) => c.parent_order_item_id === item.id,
                    );
                    return (
                      <li key={item.id} className="flex flex-col gap-0.5">
                        <div className="flex items-baseline justify-between gap-2">
                          <span className="text-foreground text-sm font-semibold">
                            <span className="text-muted-foreground tabular-nums">
                              {item.quantity}×
                            </span>{" "}
                            {item.product_name}
                          </span>
                          <span className="text-foreground text-sm font-semibold tabular-nums">
                            {formatCurrency(item.subtotal_cents)}
                          </span>
                        </div>
                        {item.daily_menu_id &&
                          item.daily_menu_snapshot?.components && (
                            <ul className="text-muted-foreground ml-6 text-xs">
                              {item.daily_menu_snapshot.components.map(
                                (c, idx) => (
                                  <li key={idx}>· {c.label}</li>
                                ),
                              )}
                            </ul>
                          )}
                        {children.length > 0 && (
                          <ul className="ml-6 mt-1 flex flex-col gap-1">
                            {children.map((child) => (
                              <li
                                key={child.id}
                                className="text-muted-foreground flex items-baseline justify-between text-xs"
                              >
                                <span>
                                  ↳ {child.quantity}× {child.product_name}
                                </span>
                                {child.modifiers.length > 0 && (
                                  <span className="ml-2 text-[11px]">
                                    {child.modifiers
                                      .map((m) => m.modifier_name)
                                      .join(" · ")}
                                  </span>
                                )}
                              </li>
                            ))}
                          </ul>
                        )}
                        {item.modifiers.length > 0 && (
                          <p className="text-muted-foreground ml-6 text-xs">
                            {item.modifiers
                              .map((m) => m.modifier_name)
                              .join(" · ")}
                          </p>
                        )}
                        {item.notes && (
                          <p className="text-amber-700 ml-6 text-xs italic">
                            &quot;{item.notes}&quot;
                          </p>
                        )}
                      </li>
                    );
                  })}
              </ul>
            )}

            {detail && (
              <dl className="border-border/60 mt-4 space-y-1.5 border-t border-dashed pt-3 text-sm tabular-nums">
                <div className="text-muted-foreground flex justify-between">
                  <dt>Subtotal</dt>
                  <dd>{formatCurrency(detail.subtotal_cents)}</dd>
                </div>
                <div className="text-muted-foreground flex justify-between">
                  <dt>{order.delivery_type === "delivery" ? "Envío" : "Retiro"}</dt>
                  <dd>{formatCurrency(detail.delivery_fee_cents)}</dd>
                </div>
                <div className="text-foreground flex justify-between pt-1 text-base font-bold">
                  <dt>Total</dt>
                  <dd>{formatCurrency(order.total_cents)}</dd>
                </div>
              </dl>
            )}
          </section>

          {detail && detail.history.length > 0 && (
            <section className="border-border/60 border-t px-5 py-4">
              <p className="text-muted-foreground text-[0.65rem] font-semibold uppercase tracking-wider">
                Historial
              </p>
              <ol className="mt-3 flex flex-col gap-2.5">
                {detail.history.map((h, idx) => (
                  <li key={idx} className="flex items-baseline gap-2.5 text-sm">
                    <span
                      className={`mt-1 size-1.5 shrink-0 rounded-full ${STATUS_DOT[h.status]}`}
                    />
                    <span className="text-foreground flex-1 font-medium">
                      {STATUS_LABEL[h.status]}
                    </span>
                    <span className="text-muted-foreground text-xs tabular-nums">
                      {formatInTimeZone(h.created_at, timezone, "HH:mm")}
                    </span>
                  </li>
                ))}
              </ol>
            </section>
          )}

          {order.cancelled_reason && (
            <section className="bg-rose-50 mx-5 my-4 rounded-lg p-3 text-sm text-rose-900 ring-1 ring-rose-200">
              <p className="font-semibold">Motivo de cancelación</p>
              <p className="mt-0.5">{order.cancelled_reason}</p>
            </section>
          )}
        </div>

        {!isCancelled && !showCancel && (
          <footer className="border-border/60 flex flex-col gap-2 border-t px-5 py-4">
            {/* Un pedido ya saldado no se vuelve a cobrar: hasta ahora el botón
                miraba sólo el estado operativo (`isTerminal` = entregado /
                cancelado), así que un delivery pagado online ofrecía cobrarse
                otra vez y registraba un segundo pago contra la misma orden. */}
            {isPaid ? (
              <p className="flex items-center justify-center gap-2 rounded-lg bg-emerald-50 py-2.5 text-sm font-semibold text-emerald-800 ring-1 ring-emerald-200">
                <Receipt className="size-4" />
                Pedido cobrado
              </p>
            ) : (
              <Button
                variant="outline"
                size="lg"
                className="w-full font-semibold"
                onClick={() => setCobrarOpen(true)}
              >
                <Receipt className="size-4" />
                Cobrar / Facturar
              </Button>
            )}
            {isPendingOnline && onConfirm && (
              <div className="w-full">
                <Label
                  htmlFor="kitchen-notes"
                  className="text-muted-foreground text-[0.65rem] font-semibold uppercase tracking-wider"
                >
                  Entregar (sale en la comanda)
                </Label>
                <Input
                  id="kitchen-notes"
                  value={kitchenNotes}
                  onChange={(e) => setKitchenNotes(e.target.value)}
                  maxLength={120}
                  placeholder="21:30, junto con la mesa 5…"
                  className="mt-1.5"
                />
              </div>
            )}
            {isPendingOnline && onConfirm ? (
              <Button
                size="lg"
                className="w-full font-semibold"
                onClick={() => {
                  onConfirm(order, kitchenNotes);
                  onOpenChange(false);
                }}
              >
                Confirmar
              </Button>
            ) : (
              advanceLabel &&
              nextForDelivery && (
                <Button
                  size="lg"
                  className="w-full font-semibold"
                  onClick={() => {
                    onAdvance(order, nextForDelivery);
                    onOpenChange(false);
                  }}
                >
                  {advanceLabel}
                </Button>
              )
            )}
            {/* Un pedido ya entregado no se cancela: sólo queda cobrarlo. */}
            {!isTerminal && (
              <Button
                variant="ghost"
                size="sm"
                className="text-rose-700 hover:bg-rose-50 hover:text-rose-700"
                onClick={() => setShowCancel(true)}
              >
                Cancelar pedido
              </Button>
            )}
          </footer>
        )}

        {!isTerminal && showCancel && (
          <footer className="border-border/60 flex flex-col gap-3 border-t px-5 py-4">
            <div className="grid gap-1.5">
              <Label htmlFor={`sheet-cancel-reason-${order.id}`}>
                Motivo de cancelación
              </Label>
              <Textarea
                id={`sheet-cancel-reason-${order.id}`}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Sin stock, zona fuera de cobertura, etc."
                maxLength={500}
                rows={3}
              />
              <p className="text-muted-foreground text-xs">
                El cliente lo ve en el tracker del pedido.
              </p>
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => {
                  setShowCancel(false);
                  setReason("");
                }}
                disabled={cancelling}
              >
                Volver
              </Button>
              <Button
                variant="destructive"
                className="flex-1"
                onClick={handleCancel}
                disabled={cancelling}
              >
                {cancelling ? "Cancelando…" : "Confirmar"}
              </Button>
            </div>
          </footer>
        )}
      </SheetContent>
    </Sheet>

    <CobrarPedidoSheet
      order={order}
      slug={slug}
      open={cobrarOpen}
      onClose={() => setCobrarOpen(false)}
      onDone={() => {
        setCobrarOpen(false);
        onOpenChange(false);
      }}
    />
    </>
  );
}

function PaymentChip({
  method,
  status,
}: {
  method: string | null | undefined;
  status: string | null | undefined;
}) {
  // Antes sólo se renderizaba para MP, así que un pedido en efectivo no tenía
  // ningún indicador de pago en el detalle — ni antes ni después de cobrarlo.
  if (!method) return null;
  if (method !== "mp") {
    return status === "paid" ? (
      <span className="inline-flex items-center rounded-full bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-800">
        Efectivo · Cobrado
      </span>
    ) : (
      <span className="inline-flex items-center rounded-full bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-800">
        Efectivo · A cobrar
      </span>
    );
  }

  const styles: Record<string, { bg: string; text: string; label: string }> = {
    paid: { bg: "bg-emerald-50", text: "text-emerald-800", label: "MP · Pagado" },
    pending: { bg: "bg-amber-50", text: "text-amber-800", label: "MP · Pendiente" },
    failed: { bg: "bg-rose-50", text: "text-rose-800", label: "MP · Rechazado" },
    refunded: { bg: "bg-zinc-100", text: "text-zinc-700", label: "MP · Reembolsado" },
  };
  const s = styles[status ?? "pending"] ?? styles.pending;
  return (
    <span
      className={`inline-flex items-center rounded-full px-3 py-1.5 text-xs font-medium ${s.bg} ${s.text}`}
    >
      {s.label}
    </span>
  );
}
