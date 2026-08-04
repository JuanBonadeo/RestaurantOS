"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Ban, Check, ChefHat, MoreVertical, Receipt } from "lucide-react";
import { toast } from "sonner";

import { AnularComandaModal } from "@/components/shared/anular-comanda-modal";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { marcarComandaEntregada } from "@/lib/comandas/actions";
import { formatCurrency } from "@/lib/currency";
import { cn } from "@/lib/utils";

export type ComandaSummary = {
  id: string;
  batch: number;
  status: "pendiente" | "en_preparacion" | "entregado";
  station_name: string;
  emitted_at: string;
  delivered_at: string | null;
  /** Anulada (spec 049). Sin esto la fila se dibujaba «Activa» y con Entregar. */
  cancelled_at: string | null;
  items: { product_name: string; quantity: number }[];
};

export type OrderSummaryData = {
  order_number: number;
  total_cents: number;
  items: { product_name: string; quantity: number; cancelled_at: string | null }[];
  comandas: ComandaSummary[];
};

type ComandaDisplayStatus = "activa" | "cerrada" | "anulada";

/**
 * La anulación es un flag lateral, no un estado de la máquina (spec 049): una
 * comanda anulada conserva su `status`, así que gana el `cancelled_at`.
 */
function getComandaDisplayStatus(
  comanda: Pick<ComandaSummary, "status" | "cancelled_at">,
): ComandaDisplayStatus {
  if (comanda.cancelled_at) return "anulada";
  return comanda.status === "entregado" ? "cerrada" : "activa";
}

/**
 * Card compartida entre la vista mozo y la vista admin del salón.
 * Muestra el resumen del pedido (items + total) y las comandas por sector
 * con su estado operativo (activa / cerrada / anulada).
 *
 * Un solo gesto: "Entregar" marca la comanda como cerrada (spec-05). El
 * encargado tiene además el atajo para anularla sin salir de la mesa (spec
 * 078) — el mismo modal y la misma acción que el tab Comandas.
 */
export function OrderSummaryCard({
  order,
  slug,
  hideComandasIfAllDelivered = false,
  canAnular = false,
  tableLabel,
}: {
  order: OrderSummaryData;
  slug: string;
  hideComandasIfAllDelivered?: boolean;
  /** Encargado/admin (`canCancelItem`). El server revalida el rol igual. */
  canAnular?: boolean;
  /** De qué mesa es, para que el modal diga qué se está anulando. */
  tableLabel?: string | null;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [anularTarget, setAnularTarget] = useState<ComandaSummary | null>(null);

  const active = order.items.filter((it) => it.cancelled_at === null);
  const cancelled = order.items.filter((it) => it.cancelled_at !== null);
  const totalQty = active.reduce((acc, it) => acc + it.quantity, 0);

  const handleMarcarEntregada = (comandaId: string) => {
    startTransition(async () => {
      const r = await marcarComandaEntregada(comandaId, slug);
      if (!r.ok) toast.error(r.error);
      else router.refresh();
    });
  };

  const activeComandasCount = order.comandas.filter(
    (c) => getComandaDisplayStatus(c) === "activa",
  ).length;

  // Las anuladas no cuentan: si la cocina entregó todo lo vivo, el bloque no
  // aporta y se puede ocultar aunque quede una anulada colgada.
  const vivas = order.comandas.filter((c) => !c.cancelled_at);
  const allComandasDelivered =
    vivas.length > 0 && vivas.every((c) => c.status === "entregado");
  const showComandas =
    order.comandas.length > 0 &&
    !(hideComandasIfAllDelivered && allComandasDelivered);

  return (
    <div className="space-y-3">
      {/* Resumen de items + total */}
      <div className="rounded-2xl border border-emerald-100 bg-emerald-50/40 p-4">
        <div className="flex items-baseline justify-between">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-emerald-700">
            Orden #{order.order_number}
          </p>
          <p className="inline-flex items-center gap-1.5 text-lg font-bold tabular-nums text-zinc-900">
            <Receipt className="h-4 w-4" />
            {formatCurrency(order.total_cents)}
          </p>
        </div>
        {active.length > 0 ? (
          <ul className="mt-3 space-y-1">
            {active.map((it, i) => (
              <li
                key={`a-${i}`}
                className="flex items-center gap-2 text-sm text-zinc-800"
              >
                <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-white px-1 text-[11px] font-bold tabular-nums text-zinc-700 ring-1 ring-zinc-200">
                  {it.quantity}
                </span>
                <span className="flex-1 truncate">{it.product_name}</span>
              </li>
            ))}
            {cancelled.length > 0 &&
              cancelled.map((it, i) => (
                <li
                  key={`c-${i}`}
                  className="flex items-center gap-2 text-xs text-zinc-400 line-through"
                >
                  <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-white px-1 text-[10px] font-bold tabular-nums">
                    {it.quantity}
                  </span>
                  <span className="flex-1 truncate">{it.product_name}</span>
                </li>
              ))}
          </ul>
        ) : (
          <p className="mt-3 text-sm text-zinc-500">
            Sin items cargados todavía.
          </p>
        )}
        {active.length > 0 && (
          <p className="mt-3 border-t border-emerald-100 pt-2 text-[11px] text-zinc-500 tabular-nums">
            {totalQty} items · {active.length}{" "}
            {active.length === 1 ? "producto" : "productos"}
          </p>
        )}
      </div>

      {/* Comandas por sector con su estado */}
      {showComandas && (
        <div className="rounded-2xl bg-white p-4 ring-1 ring-zinc-200">
          <div className="flex items-center justify-between gap-2">
            <p className="inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
              <ChefHat className="size-3" strokeWidth={2} />
              Comandas
            </p>
            <p className="text-[10px] font-semibold tabular-nums text-zinc-500">
              {activeComandasCount > 0
                ? `${activeComandasCount} activa${activeComandasCount === 1 ? "" : "s"} · ${order.comandas.length} total`
                : `${order.comandas.length} cerrada${order.comandas.length === 1 ? "" : "s"}`}
            </p>
          </div>
          <ul className="mt-3 space-y-2">
            {order.comandas
              .slice()
              .sort((a, b) =>
                a.batch === b.batch
                  ? a.station_name.localeCompare(b.station_name)
                  : a.batch - b.batch,
              )
              .map((c) => (
                <ComandaRow
                  key={c.id}
                  comanda={c}
                  isPending={isPending}
                  canAnular={canAnular}
                  onMarcarEntregada={() => handleMarcarEntregada(c.id)}
                  onAnular={() => setAnularTarget(c)}
                />
              ))}
          </ul>
        </div>
      )}

      {/* Atajo de anulación (spec 078): mismo modal que el tab Comandas. */}
      {anularTarget && (
        <AnularComandaModal
          slug={slug}
          comandaId={anularTarget.id}
          stationName={anularTarget.station_name}
          batch={anularTarget.batch}
          origen={tableLabel ? `Mesa ${tableLabel}` : null}
          onClose={() => setAnularTarget(null)}
          onDone={() => {
            setAnularTarget(null);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

function useElapsedMinutes(iso: string | null): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!iso) return;
    const i = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(i);
  }, [iso]);
  if (!iso) return 0;
  return Math.max(0, Math.floor((now - new Date(iso).getTime()) / 60_000));
}

function formatElapsed(min: number): string {
  if (min < 1) return "ahora";
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m === 0 ? `${h}h` : `${h}h${m}m`;
}

const DISPLAY_LABEL: Record<ComandaDisplayStatus, string> = {
  activa: "Activa",
  cerrada: "Cerrada",
  anulada: "Anulada",
};
const DISPLAY_CLASS: Record<ComandaDisplayStatus, string> = {
  activa: "bg-sky-100 text-sky-800",
  cerrada: "bg-emerald-100 text-emerald-800",
  anulada: "bg-rose-100 text-rose-800",
};
const DISPLAY_DOT: Record<ComandaDisplayStatus, string> = {
  activa: "bg-sky-500",
  cerrada: "bg-emerald-500",
  anulada: "bg-rose-500",
};

function ComandaRow({
  comanda,
  isPending,
  canAnular,
  onMarcarEntregada,
  onAnular,
}: {
  comanda: ComandaSummary;
  isPending: boolean;
  canAnular: boolean;
  onMarcarEntregada: () => void;
  onAnular: () => void;
}) {
  const displayStatus = getComandaDisplayStatus(comanda);

  const referenceIso =
    displayStatus === "anulada"
      ? comanda.cancelled_at
      : comanda.status === "entregado"
        ? comanda.delivered_at
        : comanda.emitted_at;
  const elapsed = useElapsedMinutes(referenceIso);
  const isUrgent = displayStatus === "activa" && elapsed >= 15;
  const isLate = displayStatus === "activa" && elapsed >= 8 && elapsed < 15;
  // Misma regla que el kanban (spec 049): ni entregada ni ya anulada.
  const showAnular = canAnular && displayStatus === "activa";

  return (
    <li
      className={cn(
        "overflow-hidden rounded-xl ring-1 transition",
        displayStatus === "activa"
          ? "bg-white ring-zinc-200"
          : "bg-zinc-50 ring-zinc-200",
        isUrgent && "ring-rose-300",
        isLate && "ring-amber-300",
      )}
    >
      {/* Row 1: sector + tanda + tiempo */}
      <div className="flex items-center justify-between gap-2 px-3 pt-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <span
            className={cn(
              "size-2 shrink-0 rounded-full",
              DISPLAY_DOT[displayStatus],
            )}
          />
          <span className="truncate text-sm font-bold text-zinc-900">
            {comanda.station_name}
          </span>
          <span className="shrink-0 text-[11px] font-medium text-zinc-500 tabular-nums">
            Tanda {comanda.batch}
          </span>
        </div>
        <span
          className={cn(
            "shrink-0 text-[11px] font-semibold tabular-nums",
            isUrgent ? "text-rose-700" : isLate ? "text-amber-700" : "text-zinc-500",
          )}
        >
          {formatElapsed(elapsed)}
          {displayStatus !== "activa" && " atrás"}
        </span>
      </div>

      {/* Row 2: items */}
      {comanda.items.length > 0 && (
        <ul
          className={cn(
            "mt-2 space-y-0.5 px-3 pb-2 text-xs",
            displayStatus === "activa" ? "text-zinc-700" : "text-zinc-500",
          )}
        >
          {comanda.items.slice(0, 4).map((it, i) => (
            <li
              key={`${comanda.id}-${i}`}
              className="flex items-baseline gap-1.5"
            >
              <span className="shrink-0 font-semibold tabular-nums text-zinc-500">
                {it.quantity}x
              </span>
              <span className="truncate font-medium">{it.product_name}</span>
            </li>
          ))}
          {comanda.items.length > 4 && (
            <li className="text-zinc-400">+{comanda.items.length - 4} mas</li>
          )}
        </ul>
      )}

      {/* Row 3: chip de estado + acción primaria */}
      <div
        className={cn(
          "flex items-center justify-between gap-2 border-t px-3 py-2",
          displayStatus === "activa"
            ? "border-zinc-100 bg-zinc-50/50"
            : "border-zinc-200/70 bg-zinc-50",
        )}
      >
        <span
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide",
            DISPLAY_CLASS[displayStatus],
          )}
        >
          <span className={cn("size-1.5 rounded-full", DISPLAY_DOT[displayStatus])} />
          {DISPLAY_LABEL[displayStatus]}
        </span>

        {displayStatus === "activa" && (
          <div className="flex shrink-0 items-center gap-1.5">
            <button
              type="button"
              onClick={onMarcarEntregada}
              disabled={isPending}
              className="inline-flex items-center gap-1 rounded-full bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white transition hover:bg-emerald-700 active:translate-y-px disabled:opacity-50"
            >
              <Check className="size-3.5" strokeWidth={2.5} />
              Entregar
            </button>
            {/* Anular vive en el ⋯ y no suelta al lado de Entregar: Entregar se
                toca todo el turno y esto cancela comida ya pedida. */}
            {showAnular && (
              <DropdownMenu>
                <DropdownMenuTrigger
                  aria-label="Opciones de la comanda"
                  disabled={isPending}
                  className="inline-flex size-8 items-center justify-center rounded-full text-zinc-500 ring-1 ring-zinc-200 transition hover:bg-white data-[popup-open]:bg-white disabled:opacity-50"
                >
                  <MoreVertical className="size-4" strokeWidth={2.5} />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-48">
                  <DropdownMenuItem variant="destructive" onClick={onAnular}>
                    <Ban />
                    Anular comanda
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        )}
      </div>
    </li>
  );
}
