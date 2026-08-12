"use client";

import { Ban, Check, ClipboardList } from "lucide-react";

import type { ComandaConItems } from "@/lib/comandas/queries";
import type { KitchenItemStatus } from "@/lib/comandas/types";
import { formatCurrency } from "@/lib/currency";
import {
  agruparPorTanda,
  contarItemsVivos,
  estaAnulado,
  type LoPedido,
  type LoPedidoItem,
} from "@/lib/mozo/lo-pedido";

/**
 * «Lo pedido» — la columna izquierda del panel de carga (spec 111).
 *
 * Antes, de todo lo que la mesa ya tenía cargado, el panel mostraba **un
 * número** al lado de un ícono: para ver qué comió había que salir a Cuenta, o
 * sea salir del modo en el que estás cargando. Acá está entero y al lado:
 * cantidad, modificadores elegidos, nota, cubierto, sector, estado de cocina y
 * plata por línea, agrupado por tanda.
 *
 * Teclado (FR-009): los botones son focusables por Tab, pero la columna **no**
 * entra en la cadena de flechas buscador → resultados → carrito → enviar. El
 * camino feliz es cargar; mirar lo ya pedido es una consulta, y meterla en el
 * medio de las flechas alargaría el recorrido que las specs 055/075 acortaron.
 */

const KITCHEN_LABEL: Record<KitchenItemStatus, string> = {
  pending: "Pendiente",
  preparing: "En preparación",
  ready: "Listo",
  delivered: "Entregado",
};

const KITCHEN_PILL: Record<KitchenItemStatus, string> = {
  pending: "bg-zinc-100 text-zinc-600",
  preparing: "bg-sky-100 text-sky-800",
  ready: "bg-amber-100 text-amber-800",
  delivered: "bg-emerald-100 text-emerald-800",
};

/** Hora del envío, en la zona de la máquina del local. */
function horaDe(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" });
}

export function LoPedidoColumn({
  loPedido,
  comandas,
  stationNameById,
  userCanCancel,
  pending,
  onCancelItem,
  onAdvance,
}: {
  loPedido: LoPedido | null;
  /** Sólo para el estado de la comanda y el botón «Entregar»: los ítems salen
   *  de `loPedido`, que también trae los que no fueron a cocina. */
  comandas: ComandaConItems[];
  stationNameById: Record<string, string>;
  userCanCancel: boolean;
  pending: boolean;
  onCancelItem: (orderItemId: string, productName: string) => void;
  onAdvance: (comandaId: string) => void;
}) {
  const items = loPedido?.items ?? [];
  const tandas = agruparPorTanda(items);
  const vivos = contarItemsVivos(items);

  // Comandas de cada tanda que todavía no se entregaron: el botón «Entregar»
  // es por comanda (es lo que la cocina cierra), no por tanda ni por ítem.
  const comandaById = new Map(comandas.map((c) => [c.id, c]));

  return (
    <section
      aria-label="Lo pedido"
      className="flex min-h-0 flex-col border-zinc-200 @3xl:border-r"
    >
      <header className="flex shrink-0 items-baseline justify-between gap-2 border-b border-zinc-200 px-3 py-2.5">
        <p className="text-[10px] font-semibold tracking-[0.18em] text-zinc-500 uppercase">
          Lo pedido
        </p>
        <span className="text-[11px] font-semibold text-zinc-500 tabular-nums">
          {vivos > 0
            ? `${vivos} ${vivos === 1 ? "ítem" : "ítems"}`
            : "nada aún"}
        </span>
      </header>

      {tandas.length === 0 ? (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 px-4 py-8 text-center">
          <ClipboardList className="h-5 w-5 text-zinc-300" />
          <p className="text-xs text-zinc-500">
            La mesa todavía no tiene nada cargado.
          </p>
        </div>
      ) : (
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-3">
          {tandas.map((tanda) => {
            const hora = horaDe(tanda.emitted_at);
            // Comandas vivas de esta tanda, para ofrecer «Entregar».
            const comandasDeTanda = [
              ...new Set(
                tanda.items
                  .map((i) => i.comanda_id)
                  .filter((id): id is string => Boolean(id)),
              ),
            ]
              .map((id) => comandaById.get(id))
              .filter((c): c is ComandaConItems => Boolean(c))
              .filter((c) => c.status !== "entregado");

            return (
              <article
                key={tanda.batch ?? "sin-comanda"}
                className="overflow-hidden rounded-2xl bg-white ring-1 ring-zinc-200"
              >
                <header className="flex items-baseline justify-between gap-2 border-b border-zinc-100 bg-zinc-50/60 px-3 py-1.5">
                  <span className="text-[11px] font-semibold text-zinc-700">
                    {tanda.batch == null
                      ? "Sin comanda"
                      : `Tanda ${tanda.batch}`}
                  </span>
                  <span className="text-[11px] text-zinc-500">
                    {tanda.batch == null ? "no va a cocina" : (hora ?? "")}
                  </span>
                </header>

                <ul className="divide-y divide-zinc-100">
                  {tanda.items.map((item) => (
                    <ItemRow
                      key={item.order_item_id}
                      item={item}
                      sector={
                        item.station_id
                          ? (stationNameById[item.station_id] ?? null)
                          : null
                      }
                      userCanCancel={userCanCancel}
                      pending={pending}
                      onCancelItem={onCancelItem}
                    />
                  ))}
                </ul>

                {comandasDeTanda.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 border-t border-zinc-100 p-2">
                    {comandasDeTanda.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => onAdvance(c.id)}
                        disabled={pending}
                        className="inline-flex h-9 flex-1 items-center justify-center gap-1.5 rounded-xl bg-emerald-50 px-3 text-xs font-semibold text-emerald-700 ring-1 ring-emerald-200 active:scale-[0.98] disabled:opacity-60"
                      >
                        <Check className="h-3.5 w-3.5" />
                        Entregar
                        {comandasDeTanda.length > 1 && c.station_id && (
                          <span className="font-normal">
                            {stationNameById[c.station_id] ?? "sector"}
                          </span>
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}

      {loPedido && items.length > 0 && (
        <footer className="shrink-0 border-t border-zinc-200 bg-white px-3 py-2.5">
          {/* Los totales vienen de la orden (los recalcula el server en cada
              envío), así que ya traen descuento y propina si los hay. */}
          {loPedido.discount_cents > 0 && (
            <Linea
              label="Descuento"
              value={`− ${formatCurrency(loPedido.discount_cents)}`}
            />
          )}
          {loPedido.tip_cents > 0 && (
            <Linea
              label="Propina"
              value={`+ ${formatCurrency(loPedido.tip_cents)}`}
            />
          )}
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-[11px] text-zinc-500">Va la mesa</span>
            <span className="text-base font-bold text-zinc-900 tabular-nums">
              {formatCurrency(loPedido.total_cents)}
            </span>
          </div>
        </footer>
      )}
    </section>
  );
}

function Linea({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2 text-[11px] text-zinc-500">
      <span>{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}

function ItemRow({
  item,
  sector,
  userCanCancel,
  pending,
  onCancelItem,
}: {
  item: LoPedidoItem;
  sector: string | null;
  userCanCancel: boolean;
  pending: boolean;
  onCancelItem: (orderItemId: string, productName: string) => void;
}) {
  const anulado = estaAnulado(item);

  if (anulado) {
    return (
      <li className="flex items-start gap-2 bg-zinc-50 px-3 py-2 text-zinc-400">
        <span className="text-xs font-semibold tabular-nums line-through">
          {item.quantity}×
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold line-through">
            {item.product_name}
          </p>
          {item.cancelled_reason && (
            <p className="mt-0.5 text-[11px] text-red-500">
              Anulado: {item.cancelled_reason}
            </p>
          )}
        </div>
      </li>
    );
  }

  return (
    <li className="flex items-start gap-2 px-3 py-2">
      <span className="mt-0.5 text-sm font-bold text-zinc-700 tabular-nums">
        {item.quantity}×
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-zinc-900">
          {item.product_name}
        </p>
        {/* Los modificadores son la mitad del pedido en un restaurante: sin
            ellos «Milanesa» no dice si va con papas o con puré. */}
        {item.modifiers.length > 0 && (
          <p className="mt-0.5 text-xs text-zinc-600">
            {item.modifiers.join(" · ")}
          </p>
        )}
        {item.notes && (
          <p className="mt-0.5 text-xs text-zinc-500 italic">
            &ldquo;{item.notes}&rdquo;
          </p>
        )}
        <div className="mt-1 flex flex-wrap items-center gap-1">
          <span
            className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${KITCHEN_PILL[item.kitchen_status]}`}
          >
            {KITCHEN_LABEL[item.kitchen_status]}
          </span>
          {sector && (
            <span className="rounded-full bg-zinc-100 px-1.5 py-0.5 text-[10px] font-medium text-zinc-600">
              {sector}
            </span>
          )}
          {item.seat_number != null && (
            <span className="rounded-full bg-zinc-100 px-1.5 py-0.5 text-[10px] font-medium text-zinc-600">
              Cubierto {item.seat_number}
            </span>
          )}
        </div>
      </div>
      <span className="shrink-0 text-xs font-semibold text-zinc-700 tabular-nums">
        {formatCurrency(item.subtotal_cents)}
      </span>
      {userCanCancel && (
        <button
          type="button"
          onClick={() => onCancelItem(item.order_item_id, item.product_name)}
          disabled={pending}
          className="shrink-0 rounded-full p-1.5 text-zinc-400 active:bg-red-50 active:text-red-600 disabled:opacity-40"
          aria-label={`Anular ${item.product_name}`}
        >
          <Ban className="h-4 w-4" />
        </button>
      )}
    </li>
  );
}
