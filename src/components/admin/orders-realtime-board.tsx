"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Bell, Clock, Plus } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import type { AdminOrder } from "@/lib/admin/orders-query";
import {
  aceptarPedidoProgramado,
  confirmarPedido,
} from "@/lib/orders/confirm-order";
import { isScheduledForLater } from "@/lib/orders/scheduled";
import type { OrderStatus } from "@/lib/orders/status";
import { updateOrderStatus } from "@/lib/orders/update-status";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

import { CancelledOrderRow } from "./cancelled-order-row";
import { CargarPedidoSheet } from "./cargar-pedido-sheet";
import { OrderCard } from "./order-card";

type Column = {
  key: string;
  label: string;
  statuses: OrderStatus[];
  accent: string;
  ring: string;
  countBg: string;
  countText: string;
  emptyHint: string;
};

const COLUMNS: Column[] = [
  {
    key: "new",
    label: "Nuevos",
    statuses: ["pending", "confirmed"],
    accent: "bg-blue-500",
    ring: "ring-blue-500/30",
    countBg: "bg-blue-50",
    countText: "text-blue-700",
    emptyHint: "Sin pedidos nuevos",
  },
  {
    key: "preparing",
    label: "Preparando",
    statuses: ["preparing"],
    accent: "bg-amber-500",
    ring: "ring-amber-500/30",
    countBg: "bg-amber-50",
    countText: "text-amber-800",
    emptyHint: "Cocina libre",
  },
  {
    key: "ready",
    label: "Listos",
    statuses: ["ready"],
    accent: "bg-emerald-500",
    ring: "ring-emerald-500/30",
    countBg: "bg-emerald-50",
    countText: "text-emerald-800",
    emptyHint: "Nada listo aún",
  },
  {
    key: "on_the_way",
    label: "En camino",
    statuses: ["on_the_way"],
    accent: "bg-indigo-500",
    ring: "ring-indigo-500/30",
    countBg: "bg-indigo-50",
    countText: "text-indigo-800",
    emptyHint: "Sin envíos activos",
  },
  {
    key: "delivered",
    label: "Entregados",
    statuses: ["delivered"],
    accent: "bg-zinc-300",
    ring: "ring-zinc-300/40",
    countBg: "bg-zinc-100",
    countText: "text-zinc-700",
    emptyHint: "Todavía no se entregó nada",
  },
];

function playBeep(): void {
  try {
    type AudioContextConstructor = new () => AudioContext;
    const Ctx: AudioContextConstructor | undefined =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: AudioContextConstructor })
        .webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = 880;
    osc.type = "sine";
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.3, ctx.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.5);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.5);
  } catch {
    // fail silently — sound is not critical
  }
}

export function OrdersRealtimeBoard({
  businessId,
  slug,
  timezone,
  initialOrders,
}: {
  businessId: string;
  slug: string;
  timezone: string;
  initialOrders: AdminOrder[];
}) {
  const [orders, setOrders] = useState<AdminOrder[]>(initialOrders);
  const [newlyArrived, setNewlyArrived] = useState<Set<string>>(new Set());
  const [soundUnlocked, setSoundUnlocked] = useState(false);
  // Spec 054 — sheet para cargar a mano un pedido para llevar/delivery.
  const [cargarOpen, setCargarOpen] = useState(false);

  // Keep a ref for realtime handler (avoids stale closure).
  const soundUnlockedRef = useRef(soundUnlocked);
  soundUnlockedRef.current = soundUnlocked;

  const fetchOrder = useCallback(
    async (orderId: string): Promise<AdminOrder | null> => {
      const supabase = createSupabaseBrowserClient();
      const { data } = await supabase
        .from("orders")
        .select(
          "id, order_number, created_at, customer_name, customer_phone, delivery_type, total_cents, status, payment_method, payment_status, cancelled_reason, scheduled_at, order_items(product_name, quantity)",
        )
        .eq("id", orderId)
        .maybeSingle();
      if (!data) return null;
      // Las orders dine_in viven en el flow de salón, no en el board de
      // pedidos online. Si el realtime nos trae una, la ignoramos.
      if (data.delivery_type === "dine_in") return null;
      return {
        id: data.id,
        order_number: data.order_number,
        created_at: data.created_at,
        customer_name: data.customer_name,
        customer_phone: data.customer_phone,
        delivery_type: data.delivery_type as AdminOrder["delivery_type"],
        total_cents: Number(data.total_cents),
        status: data.status as OrderStatus,
        payment_method: data.payment_method,
        payment_status: data.payment_status,
        cancelled_reason: data.cancelled_reason,
        scheduled_at: data.scheduled_at,
        items: (data.order_items ?? []).map((i) => ({
          product_name: i.product_name,
          quantity: i.quantity,
        })),
      };
    },
    [],
  );

  useEffect(() => {
    const supabase = createSupabaseBrowserClient();
    const topic = `orders:${businessId}:${Math.random().toString(36).slice(2, 10)}`;
    let channel: ReturnType<typeof supabase.channel> | null = null;
    let cancelled = false;

    (async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (cancelled) return;
      if (session?.access_token) {
        await supabase.realtime.setAuth(session.access_token);
      }
      if (cancelled) return;

      channel = supabase
        .channel(topic)
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "orders",
            filter: `business_id=eq.${businessId}`,
          },
          async (payload) => {
            if (payload.eventType === "INSERT") {
              const id = (payload.new as { id: string }).id;
              const full = await fetchOrder(id);
              if (!full) return;
              setOrders((prev) => [full, ...prev.filter((o) => o.id !== id)]);
              setNewlyArrived((prev) => new Set(prev).add(id));
              setTimeout(() => {
                setNewlyArrived((prev) => {
                  const next = new Set(prev);
                  next.delete(id);
                  return next;
                });
              }, 4000);
              if (soundUnlockedRef.current) playBeep();
            } else if (payload.eventType === "UPDATE") {
              const id = (payload.new as { id: string }).id;
              const full = await fetchOrder(id);
              if (!full) return;
              setOrders((prev) =>
                prev.map((o) => (o.id === id ? full : o)),
              );
            } else if (payload.eventType === "DELETE") {
              const id = (payload.old as { id: string }).id;
              setOrders((prev) => prev.filter((o) => o.id !== id));
            }
          },
        )
        .subscribe();
    })();

    return () => {
      cancelled = true;
      if (channel) supabase.removeChannel(channel);
    };
  }, [businessId, fetchOrder]);

  const handleAdvance = useCallback(
    async (order: AdminOrder, next: OrderStatus) => {
      setOrders((prev) =>
        prev.map((o) => (o.id === order.id ? { ...o, status: next } : o)),
      );
      const result = await updateOrderStatus({
        order_id: order.id,
        business_slug: slug,
        next_status: next,
      });
      if (!result.ok) {
        toast.error(result.error);
        setOrders((prev) =>
          prev.map((o) =>
            o.id === order.id ? { ...o, status: order.status } : o,
          ),
        );
      }
    },
    [slug],
  );

  const handleConfirm = useCallback(
    async (order: AdminOrder) => {
      // Optimistic: pasamos a "preparing" en local mientras la action corre.
      setOrders((prev) =>
        prev.map((o) =>
          o.id === order.id ? { ...o, status: "preparing" } : o,
        ),
      );
      const result = await confirmarPedido(order.id, slug);
      if (!result.ok) {
        toast.error(result.error);
        setOrders((prev) =>
          prev.map((o) =>
            o.id === order.id ? { ...o, status: order.status } : o,
          ),
        );
        return;
      }
      const { comanda_ids, items_without_station } = result.data;
      const cocinaPart =
        comanda_ids.length === 0
          ? "sin items para cocina"
          : `${comanda_ids.length} comanda${comanda_ids.length === 1 ? "" : "s"} a sectores`;
      const directPart =
        items_without_station > 0
          ? ` · ${items_without_station} ítem${items_without_station === 1 ? "" : "s"} va${items_without_station === 1 ? "" : "n"} directo (sin imprimir)`
          : "";
      toast.success(`Pedido #${order.order_number} confirmado · ${cocinaPart}${directPart}`);
    },
    [slug],
  );

  // Aceptar un programado (spec 061): lo avala sin marcharlo. Queda en
  // Próximos y la comanda sale sola cuando entra en ventana.
  const handleAceptarProgramado = useCallback(
    async (order: AdminOrder) => {
      setOrders((prev) =>
        prev.map((o) =>
          o.id === order.id ? { ...o, status: "confirmed" } : o,
        ),
      );
      const result = await aceptarPedidoProgramado(order.id, slug);
      if (!result.ok) {
        toast.error(result.error);
        setOrders((prev) =>
          prev.map((o) =>
            o.id === order.id ? { ...o, status: order.status } : o,
          ),
        );
        return;
      }
      toast.success(
        `Pedido #${order.order_number} aceptado · la comanda sale sola antes de la hora`,
      );
    },
    [slug],
  );

  const unlockSound = () => {
    playBeep();
    setSoundUnlocked(true);
  };

  // Agendados (spec 31 + 061): pedidos diferidos que todavía no marcharon.
  // Van a la sección "Próximos", NO al kanban — recién entran a las columnas
  // cuando marchan (status → preparing, por el cron con el lead del negocio o
  // por "marchar ahora"). Dos formas de estar acá:
  //  · `pending`   → pago (MP aprobado, listo) o impago (espera que el
  //                  encargado lo acepte; sin eso el cron no lo toma — 047).
  //  · `confirmed` → ya aceptado, esperando su ventana.
  const { agendados, byColumn } = useMemo(() => {
    const now = new Date();
    const isAgendado = (o: AdminOrder) =>
      !!o.scheduled_at &&
      (o.status === "pending" || o.status === "confirmed") &&
      isScheduledForLater(o.scheduled_at, now);

    const proximos = orders
      .filter(isAgendado)
      .sort((a, b) =>
        (a.scheduled_at ?? "").localeCompare(b.scheduled_at ?? ""),
      );

    const groups: Record<string, AdminOrder[]> = {};
    for (const col of COLUMNS) groups[col.key] = [];
    for (const order of orders) {
      // Un agendado no va al kanban aunque esté `confirmed`: su lugar es
      // Próximos hasta que marche (no ensucia la operación de hoy).
      if (isAgendado(order)) continue;
      const col = COLUMNS.find((c) => c.statuses.includes(order.status));
      if (col) groups[col.key].push(order);
    }
    // FIFO en las columnas activas: el pedido más viejo arriba (la query trae
    // created_at desc y el realtime hace prepend). "Entregados" queda como
    // historial —el más reciente arriba— igual que en el KDS de comandas.
    for (const col of COLUMNS) {
      const asc = col.key !== "delivered";
      groups[col.key].sort((a, b) =>
        asc
          ? a.created_at.localeCompare(b.created_at)
          : b.created_at.localeCompare(a.created_at),
      );
    }
    groups["delivered"] = groups["delivered"].slice(0, 20);
    return { agendados: proximos, byColumn: groups };
  }, [orders]);

  const cancelledOrders = useMemo(
    () => orders.filter((o) => o.status === "cancelled"),
    [orders],
  );

  return (
    <div className="flex flex-col gap-5">
      {/* Toolbar: cargar un pedido a mano (spec 054) + toggle de sonido. El
          contador total vive en la pill del tab. */}
      <div className="flex items-center justify-between gap-3">
        <Button size="sm" onClick={() => setCargarOpen(true)}>
          <Plus className="size-4" />
          Cargar pedido
        </Button>
        {!soundUnlocked && (
          <Button size="sm" variant="outline" onClick={unlockSound}>
            <Bell className="size-4" />
            Activar sonido
          </Button>
        )}
      </div>

      <CargarPedidoSheet
        slug={slug}
        open={cargarOpen}
        onClose={() => setCargarOpen(false)}
      />

      {/* Próximos / agendados (spec 31): diferidos pagados esperando su hora.
          Entran al kanban cuando marchan (cron ~40 min antes o "marchar ahora"). */}
      {agendados.length > 0 && (
        <section className="ring-border/60 rounded-2xl bg-violet-50/40 p-4 ring-1">
          <div className="mb-3 flex items-center gap-2">
            <Clock className="size-4 text-violet-600" />
            <h2 className="text-foreground text-base font-bold tracking-tight">
              Próximos
            </h2>
            <span className="inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-violet-100 px-2 text-xs font-bold tabular-nums text-violet-700">
              {agendados.length}
            </span>
            <span className="text-muted-foreground text-xs">
              esperando su hora
            </span>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {agendados.map((order) => (
              <ScheduledOrderCard
                key={order.id}
                order={order}
                timezone={timezone}
                onMarchNow={() => handleConfirm(order)}
                onAccept={() => handleAceptarProgramado(order)}
              />
            ))}
          </div>
        </section>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        {COLUMNS.map((col) => {
          const items = byColumn[col.key];
          return (
            <section
              key={col.key}
              className="bg-muted/30 ring-border/60 flex min-w-0 flex-col gap-3 overflow-hidden rounded-2xl p-3 ring-1"
            >
              <div className="flex flex-col gap-2">
                <div className={`h-1 w-10 rounded-full ${col.accent}`} />
                <div className="flex items-center justify-between gap-2">
                  <h2 className="text-foreground text-base font-bold tracking-tight">
                    {col.label}
                  </h2>
                  <span
                    className={`inline-flex h-6 min-w-6 items-center justify-center rounded-full px-2 text-xs font-bold tabular-nums ${col.countBg} ${col.countText}`}
                  >
                    {items.length}
                  </span>
                </div>
              </div>

              <div className="flex flex-col gap-3">
                {items.map((order) => (
                  <OrderCard
                    key={order.id}
                    order={order}
                    slug={slug}
                    timezone={timezone}
                    onAdvance={handleAdvance}
                    onConfirm={handleConfirm}
                    isNew={newlyArrived.has(order.id)}
                    columnRing={col.ring}
                  />
                ))}
                {items.length === 0 && (
                  <div className="border-border/60 text-muted-foreground/70 rounded-xl border border-dashed px-3 py-6 text-center text-xs">
                    {col.emptyHint}
                  </div>
                )}
              </div>
            </section>
          );
        })}
      </div>

      {cancelledOrders.length > 0 && (
        <details className="group mt-2">
          <summary className="text-muted-foreground hover:text-foreground flex cursor-pointer items-center gap-2 text-xs font-semibold uppercase tracking-wider transition-colors">
            <span>Cancelados</span>
            <span className="bg-rose-50 text-rose-700 inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[0.65rem] font-bold tabular-nums">
              {cancelledOrders.length}
            </span>
            <span className="text-muted-foreground/60 normal-case tracking-normal">
              · tocá para ver
            </span>
          </summary>
          <div className="mt-3 grid gap-2">
            {cancelledOrders.map((order) => (
              <CancelledOrderRow
                key={order.id}
                order={order}
                slug={slug}
                timezone={timezone}
              />
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

/** "vie 26/06 · 13:00 hs" en el TZ del negocio. */
function formatScheduled(iso: string, timezone: string): string {
  const d = new Date(iso);
  const date = new Intl.DateTimeFormat("es-AR", {
    timeZone: timezone,
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
  }).format(d);
  const time = new Intl.DateTimeFormat("es-AR", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d);
  return `${date} · ${time} hs`;
}

function ScheduledOrderCard({
  order,
  timezone,
  onMarchNow,
  onAccept,
}: {
  order: AdminOrder;
  timezone: string;
  onMarchNow: () => void;
  onAccept: () => void;
}) {
  const [marching, setMarching] = useState(false);
  const [accepting, setAccepting] = useState(false);
  const itemsLabel = order.items
    .map((i) => `${i.quantity}× ${i.product_name}`)
    .join(" · ");
  // Tres estados posibles (spec 061). El único que necesita un gesto es el
  // impago sin aceptar: hasta que el encargado lo avale, el cron no lo marcha.
  const paid = order.payment_status === "paid";
  const accepted = order.status === "confirmed";
  const needsAccept = !paid && !accepted;
  const estado = paid
    ? { label: "Pagado", className: "text-emerald-700" }
    : accepted
      ? { label: "Aceptado · paga al recibir", className: "text-violet-700" }
      : { label: "Esperando aceptación", className: "text-amber-700" };
  return (
    <div className="ring-border/60 flex flex-col gap-2 rounded-xl bg-white p-3 ring-1">
      <div className="flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1.5 text-sm font-bold text-violet-700">
          <Clock className="size-3.5" />
          {order.scheduled_at ? formatScheduled(order.scheduled_at, timezone) : ""}
        </span>
        <span className="text-muted-foreground text-xs font-medium tabular-nums">
          #{order.order_number}
        </span>
      </div>
      <div className="text-foreground text-sm font-semibold">
        {order.customer_name}
      </div>
      {itemsLabel && (
        <div className="text-muted-foreground line-clamp-2 text-xs">
          {itemsLabel}
        </div>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
        <span className={`text-xs font-medium ${estado.className}`}>
          {estado.label}
        </span>
        <div className="flex items-center gap-2">
          {needsAccept && (
            <Button
              size="sm"
              onClick={() => {
                setAccepting(true);
                onAccept();
              }}
              disabled={accepting || marching}
            >
              {accepting ? "Aceptando…" : "Aceptar"}
            </Button>
          )}
          <Button
            size="sm"
            variant={needsAccept ? "outline" : "default"}
            onClick={() => {
              setMarching(true);
              onMarchNow();
            }}
            disabled={marching || accepting}
          >
            {marching ? "Marchando…" : "Marchar ahora"}
          </Button>
        </div>
      </div>
    </div>
  );
}
